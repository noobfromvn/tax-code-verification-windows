const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const XLSX = require('xlsx');
const { createWorker } = require('tesseract.js');

const TARGET_URL = 'https://tracuunnt.gdt.gov.vn/tcnnt/mstcn.jsp';
const LOOKUP_PARTITION = 'persist:tax-code-verifier-lookup';
const MAX_RETRIES = 20;
const DELAY_MS = 2000;
const WATCHDOG_MS = 45000;

const CCCD_KEYWORDS = ['cccd', 'thông tin cccd', 'thong tin cccd', 'thongtin'];
const MST_KEYWORDS = ['mst', 'mã số thuế', 'ma so thue', 'msttncn', 'taxcode'];
const DONGBO_KEYWORDS = ['đồng bộ cccd', 'dong bo cccd', 'đồng bộ', 'dong bo', 'dongbo'];

class TaxVerifierService {
  constructor({ onStatePatch, onResult, getState, getProxySettings, onProxyApplied, logger }) {
    this.onStatePatch = onStatePatch;
    this.onResult = onResult;
    this.getState = getState;
    this.getProxySettings = getProxySettings;
    this.onProxyApplied = onProxyApplied;
    this.lookupWindow = null;
    this.lookupSession = session.fromPartition(LOOKUP_PARTITION, { cache: true });
    this.isPaused = false;
    this.isStopped = false;
    this.isRunning = false;
    this.workerPromise = null;
    this.logger = logger;
    this.didAttachSessionLogging = false;
    this.attachLookupSessionLogging();
  }

  loadWorkbook(buffer, filePath) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const header = rows[0] || [];

    return {
      fileName: path.basename(filePath),
      filePath,
      workbookBufferBase64: Buffer.from(buffer).toString('base64'),
      sheetName,
      rows,
      header,
      detectedColumns: {
        cccd: autoDetect(header, CCCD_KEYWORDS),
        mst: autoDetect(header, MST_KEYWORDS),
        dongBo: autoDetect(header, DONGBO_KEYWORDS),
      },
    };
  }

  prepareQueue(workbookData, columns) {
    const queue = workbookData.rows.slice(1).map((row, idx) => ({
      rowIdx: idx + 1,
      cccdCode: columns.cccd >= 0 ? String(row[columns.cccd] || '').trim() : '',
      mstCode: columns.mst >= 0 ? String(row[columns.mst] || '').trim() : '',
    })).filter((item) => item.cccdCode || item.mstCode);

    return {
      queue,
      progress: {
        total: queue.length,
        done: 0,
        dongBo: 0,
        chuaDongBo: 0,
        khongTimThay: 0,
        errors: 0,
        currentCode: '',
        currentPhase: '',
        isPaused: false,
        isStopped: false,
      },
    };
  }

  async start() {
    if (this.isRunning) return;
    this.isStopped = false;
    this.isPaused = false;
    this.isRunning = true;

    await this.ensureLookupWindow();

    while (!this.isStopped && this.getState().queue.length > 0) {
      if (this.isPaused) {
        await delay(250);
        continue;
      }
      const currentState = this.getState();
      const [current, ...rest] = currentState.queue;
      this.onStatePatch({
        queue: rest,
        current: {
          ...current,
          lookupPhase: current.cccdCode ? 'CCCD' : 'MST',
          activeCode: current.cccdCode || current.mstCode,
          retryCount: 0,
        },
        progress: {
          ...currentState.progress,
          currentCode: current.cccdCode || current.mstCode,
          currentPhase: current.cccdCode ? 'CCCD' : 'MST',
        },
      });
      await this.processCurrent();
      await delay(DELAY_MS);
    }

    const finalState = this.getState();
    if (!this.isStopped && finalState.phase === 'running') {
      this.onStatePatch({
        phase: 'done',
        current: null,
        progress: {
          ...finalState.progress,
          currentCode: '',
          currentPhase: '',
        },
      });
    }
    this.isRunning = false;
  }

  pause() {
    this.isPaused = true;
  }

  async resume() {
    this.isPaused = false;
    if (!this.isRunning) {
      await this.start();
    }
  }

  async stop() {
    this.isStopped = true;
    this.isPaused = false;
    this.isRunning = false;
    await this.disposeLookupWindow();
    await this.disposeLookupSession();
  }

  async dispose() {
    this.isStopped = true;
    this.isPaused = false;
    this.isRunning = false;
    await this.disposeLookupWindow();
    await this.disposeLookupSession();
    const worker = await this.workerPromise?.catch(() => null);
    this.workerPromise = null;
    if (worker) await worker.terminate();
  }

  createSampleWorkbook() {
    const rows = [
      ['Thông tin CCCD', 'MST', 'Đồng bộ CCCD', 'Ghi chú'],
      ['079203001234', '', '', 'Test bằng CCCD'],
      ['', '0123456789', '', 'Test bằng MST fallback'],
      ['079203009999', '0312345678', '', 'Có cả CCCD và MST để kiểm tra mapping'],
    ];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 24 },
      { wch: 18 },
      { wch: 18 },
      { wch: 34 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'MauTraCuu');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  async exportWorkbook(workbookData, results, originalPath) {
    const workbook = XLSX.read(Buffer.from(workbookData.workbookBufferBase64, 'base64'), { type: 'buffer' });
    const sheetName = workbookData.sheetName || workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const header = rows[0] || [];
    const resultByRow = Object.fromEntries(results.map((r) => [r.rowIdx, r]));

    const colDongBo = ensureColumn(header, 'Đồng bộ CCCD', ['đồng bộ cccd', 'dong bo cccd']);
    const colName = ensureColumn(header, 'Tên NNT', ['tên nnt', 'ten nnt', 'tên người nộp thuế', 'ten nguoi nop thue']);
    const colTax = ensureColumn(header, 'Cơ quan thuế', ['cơ quan thuế', 'co quan thue']);
    const colFoundMst = ensureColumn(header, 'MST Tìm thấy', ['mst tìm thấy', 'mst tim thay']);
    const colMstStatus = ensureColumn(header, 'Trạng thái MST', ['trạng thái mst', 'trang thai mst']);

    const newRows = [header];
    for (let i = 1; i < rows.length; i++) {
      const originalRow = [...rows[i]];
      const result = resultByRow[i];
      if (!result) {
        newRows.push(originalRow);
        continue;
      }
      const firstRow = fillResultColumns(originalRow, result, { colDongBo, colName, colTax, colFoundMst, colMstStatus });
      newRows.push(firstRow);
      for (const extraRow of result.extraRows || []) {
        const blank = [];
        fillCell(blank, colName, extraRow.name || '');
        fillCell(blank, colTax, extraRow.taxAuthority || '');
        fillCell(blank, colFoundMst, extraRow.taxCode || '');
        fillCell(blank, colMstStatus, extraRow.mstStatus || '');
        newRows.push(blank);
      }
    }

    workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(newRows);
    const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const defaultPath = path.join(path.dirname(originalPath), `dong-bo-cccd-${Date.now()}.xlsx`);
    const saveResult = await dialog.showSaveDialog({ defaultPath, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (saveResult.canceled || !saveResult.filePath) return { canceled: true };
    await fs.writeFile(saveResult.filePath, outputBuffer);
    return { canceled: false, path: saveResult.filePath };
  }

  async refreshProxyStatus() {
    const currentSettings = this.getProxySettings();
    const nextSettings = await this.describeProxy(currentSettings);
    await this.onProxyApplied(nextSettings);
    return nextSettings;
  }

  async applyProxySettings(proxySettings) {
    const config = buildElectronProxyConfig(proxySettings);
    this.logger.log('[network]', 'apply-proxy-settings', { proxySettings, config });
    await this.lookupSession.setProxy(config);
    await this.lookupSession.closeAllConnections();
    const nextSettings = await this.describeProxy(proxySettings);
    await this.onProxyApplied(nextSettings);
    return nextSettings;
  }

  attachLookupSessionLogging() {
    if (this.didAttachSessionLogging) return;
    this.didAttachSessionLogging = true;

    this.lookupSession.webRequest.onBeforeRequest((details, callback) => {
      this.logger.log('[network]', 'before-request', summarizeRequest(details));
      callback({});
    });

    this.lookupSession.webRequest.onCompleted((details) => {
      this.logger.log('[network]', 'request-completed', summarizeRequest(details));
    });

    this.lookupSession.webRequest.onErrorOccurred((details) => {
      this.logger.log('[network]', 'request-error', summarizeRequest(details));
    });
  }

  async ensureLookupWindow() {
    await this.applyProxySettings(this.getProxySettings());
    if (this.lookupWindow && !this.lookupWindow.isDestroyed()) return this.lookupWindow;
    this.lookupWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        session: this.lookupSession,
      },
    });
    this.lookupWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.logger.log('[network]', 'did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    });
    this.lookupWindow.webContents.on('did-finish-load', () => {
      this.logger.log('[network]', 'did-finish-load', {
        url: this.lookupWindow?.webContents.getURL(),
      });
    });
    this.lookupWindow.on('closed', () => {
      this.lookupWindow = null;
    });
    return this.lookupWindow;
  }

  async disposeLookupWindow() {
    if (this.lookupWindow && !this.lookupWindow.isDestroyed()) {
      this.lookupWindow.destroy();
    }
    this.lookupWindow = null;
  }

  async disposeLookupSession() {
    try {
      await this.lookupSession.closeAllConnections();
    } catch (error) {
      this.logger.logError('[network]', 'lookup-session-close-failed', error);
    }
  }

  async lookupCode(code) {
    this.logger.log('[network]', 'lookup-start', { code, targetUrl: TARGET_URL });
    try {
      await this.ensureLookupWindow();
      await withTimeout(this.lookupWindow.loadURL(TARGET_URL), WATCHDOG_MS, 'load_url_timeout');
      await delay(DELAY_MS);
      const pageState = await withTimeout(
        this.lookupWindow.webContents.executeJavaScript(`(${readPageState.toString()})()`),
        WATCHDOG_MS,
        'read_page_state_timeout',
      );
      if (pageState.type === 'RESULT') {
        return pageState.data.status === 'FOUND' ? { type: 'FOUND', data: pageState.data } : { type: 'NOT_FOUND' };
      }
      const imageData = await withTimeout(
        this.lookupWindow.webContents.executeJavaScript(`(${getCaptchaBase64.toString()})()`),
        WATCHDOG_MS,
        'captcha_capture_timeout',
      );
      const ocr = await withTimeout(this.solveCaptcha(imageData), WATCHDOG_MS, 'ocr_timeout');
      if (!ocr.text || ocr.text.length < 3 || ocr.confidence < 0.1) {
        this.logger.log('[tesseract]', 'ocr-low-confidence', {
          code,
          text: ocr.text,
          confidence: ocr.confidence,
        });
        return { type: 'RETRY', reason: 'low_confidence' };
      }
      await withTimeout(
        this.lookupWindow.webContents.executeJavaScript(`(${fillAndSubmit.toString()})(${JSON.stringify(code)}, ${JSON.stringify(ocr.text)})`),
        WATCHDOG_MS,
        'submit_timeout',
      );
      await delay(DELAY_MS);
      const finalState = await withTimeout(
        this.lookupWindow.webContents.executeJavaScript(`(${readPageState.toString()})()`),
        WATCHDOG_MS,
        'result_read_timeout',
      );
      this.logger.log('[network]', 'lookup-finish', { code, finalType: finalState.type });
      if (finalState.type === 'CAPTCHA_ERROR') return { type: 'RETRY', reason: 'captcha_error' };
      if (finalState.type === 'RESULT') {
        return finalState.data.status === 'FOUND' ? { type: 'FOUND', data: finalState.data } : { type: 'NOT_FOUND' };
      }
      return { type: 'RETRY', reason: 'unexpected_fresh_form' };
    } catch (error) {
      this.logger.logError('[network]', 'lookup-failed', error, { code, targetUrl: TARGET_URL });
      const text = String(error && error.message ? error.message : error);
      if (text.includes('ERR_INTERNET_DISCONNECTED') || text.includes('ERR_NAME_NOT_RESOLVED') || text.includes('timeout') || text.includes('ERR_PROXY')) {
        return { type: 'ERROR_NETWORK', error: text };
      }
      return { type: 'RETRY', error: text };
    }
  }

  async solveCaptcha(imageData) {
    const worker = await this.getWorker();
    this.logger.log('[tesseract]', 'recognize-start', {
      imageType: typeof imageData,
      imagePreview: typeof imageData === 'string' ? imageData.slice(0, 80) : null,
    });
    try {
      const { data } = await worker.recognize(imageData);
      const normalizedText = data.text.replace(/\s+/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase().trim();
      this.logger.log('[tesseract]', 'recognize-done', {
        rawText: data.text,
        normalizedText,
        confidence: data.confidence,
      });
      return {
        text: normalizedText,
        confidence: data.confidence / 100,
      };
    } catch (error) {
      this.logger.logError('[tesseract]', 'recognize-failed', error, {
        imagePreview: typeof imageData === 'string' ? imageData.slice(0, 120) : null,
      });
      throw error;
    }
  }

  getTesseractOptions() {
    const workerPath = require.resolve('tesseract.js/src/worker-script/node/index.js');
    const corePath = require.resolve('tesseract.js-core/tesseract-core-simd-lstm.wasm.js');
    const langPath = resolveBundledTesseractLangPath();
    const expectedLangResource = path.join(langPath, 'eng.traineddata.gz');

    this.logger.log('[tesseract]', 'resolve-local-traineddata', {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
      langPath,
      expectedLangResource,
      langFileExists: fsSync.existsSync(expectedLangResource),
      workerPath,
      corePath,
    });

    return {
      workerPath,
      corePath,
      langPath,
      logger: (message) => {
        this.logger.log('[tesseract]', 'worker-log', message);
      },
    };
  }

  async getWorker() {
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const options = this.getTesseractOptions();
        const expectedResources = {
          workerPath: options.workerPath,
          corePath: options.corePath,
          langPath: options.langPath,
          expectedLangResource: `${options.langPath.replace(/\/$/, '')}/eng.traineddata.gz`,
        };
        this.logger.log('[tesseract]', 'init-worker-start', {
          language: 'eng',
          oem: 1,
          options: expectedResources,
        });
        try {
          const worker = await createWorker('eng', 1, options);
          await worker.setParameters({ tessedit_pageseg_mode: '7' });
          this.logger.log('[tesseract]', 'init-worker-done', expectedResources);
          return worker;
        } catch (error) {
          this.logger.logError('[tesseract]', 'init-worker-failed', error, expectedResources);
          throw error;
        }
      })();
    }
    return this.workerPromise;
  }

  async processCurrent() {
    let current = this.getState().current;
    while (current && !this.isStopped) {
      if (this.isPaused) {
        await delay(250);
        current = this.getState().current;
        continue;
      }

      const pageState = await this.lookupCode(current.activeCode);
      if (pageState.type === 'ERROR_NETWORK') {
        await this.recordFinalResult(current, 'ERROR_NETWORK', 'Lỗi mạng', {});
        return;
      }

      if (pageState.type === 'FOUND') {
        if (current.lookupPhase === 'CCCD') {
          await this.recordFinalResult(current, 'DONG_BO', pageState.data.taxCode === current.cccdCode ? 'ĐỒNG BỘ' : 'KHÔNG KHỚP', pageState.data);
        } else {
          await this.recordFinalResult(current, 'CHUA_DONG_BO', 'Chưa đồng bộ', pageState.data);
        }
        return;
      }

      if (pageState.type === 'NOT_FOUND') {
        if (current.lookupPhase === 'CCCD' && current.mstCode) {
          const nextState = {
            ...current,
            lookupPhase: 'MST',
            activeCode: current.mstCode,
            retryCount: 0,
          };
          this.onStatePatch({
            current: nextState,
            progress: {
              ...this.getState().progress,
              currentCode: current.mstCode,
              currentPhase: 'MST',
            },
          });
          current = nextState;
          continue;
        }
        await this.recordFinalResult(current, 'KHONG_TIM_THAY', 'Không tìm thấy', {});
        return;
      }

      current = {
        ...current,
        retryCount: current.retryCount + 1,
      };
      this.onStatePatch({ current });
      if (current.retryCount >= MAX_RETRIES) {
        if (current.lookupPhase === 'CCCD' && current.mstCode) {
          current = {
            ...current,
            lookupPhase: 'MST',
            activeCode: current.mstCode,
            retryCount: 0,
          };
          this.onStatePatch({
            current,
            progress: {
              ...this.getState().progress,
              currentCode: current.mstCode,
              currentPhase: 'MST',
            },
          });
          continue;
        }
        await this.recordFinalResult(current, 'ERROR_CAPTCHA', 'Lỗi CAPTCHA', {});
        return;
      }
    }
  }

  async recordFinalResult(current, status, dongBoValue, pageData) {
    const progress = this.getState().progress;
    const nextProgress = {
      ...progress,
      done: (progress.done || 0) + 1,
      dongBo: (progress.dongBo || 0) + (status === 'DONG_BO' ? 1 : 0),
      chuaDongBo: (progress.chuaDongBo || 0) + (status === 'CHUA_DONG_BO' ? 1 : 0),
      khongTimThay: (progress.khongTimThay || 0) + (status === 'KHONG_TIM_THAY' ? 1 : 0),
      errors: (progress.errors || 0) + (status.startsWith('ERROR') ? 1 : 0),
      currentCode: '',
      currentPhase: '',
    };
    this.onStatePatch({ current: null, progress: nextProgress });
    this.onResult({
      rowIdx: current.rowIdx,
      cccdCode: current.cccdCode || '',
      mstCode: current.mstCode || '',
      status,
      dongBoValue,
      name: pageData.name || '',
      taxAuthority: pageData.taxAuthority || '',
      mstStatus: pageData.mstStatus || '',
      foundMst: pageData.taxCode || '',
      extraRows: pageData.extraRows || [],
    }, nextProgress);
  }

  async describeProxy(proxySettings) {
    const normalized = normalizeProxySettings(proxySettings);
    let effectiveProxy = normalized.mode;
    try {
      effectiveProxy = await this.lookupSession.resolveProxy(TARGET_URL);
    } catch (_error) {
      effectiveProxy = normalized.mode;
    }
    return {
      ...normalized,
      effectiveProxy,
      lastAppliedAt: new Date().toISOString(),
    };
  }
}

function normalizeProxySettings(input = {}) {
  return {
    mode: ['system', 'manual', 'direct'].includes(input.mode) ? input.mode : 'system',
    httpProxy: String(input.httpProxy || '').trim(),
    httpsProxy: String(input.httpsProxy || '').trim(),
    socksProxy: String(input.socksProxy || '').trim(),
    bypassRules: String(input.bypassRules || '').trim(),
    effectiveProxy: String(input.effectiveProxy || input.mode || 'system'),
    lastAppliedAt: input.lastAppliedAt || null,
  };
}

function buildElectronProxyConfig(proxySettings) {
  const normalized = normalizeProxySettings(proxySettings);
  if (normalized.mode === 'direct') {
    return { mode: 'direct' };
  }
  if (normalized.mode === 'manual') {
    const rules = [];
    if (normalized.httpProxy) rules.push(`http=${normalized.httpProxy}`);
    if (normalized.httpsProxy) rules.push(`https=${normalized.httpsProxy}`);
    if (normalized.socksProxy) rules.push(`socks=${normalized.socksProxy}`);
    const proxyRules = rules.join(';') || normalized.httpProxy || normalized.httpsProxy || normalized.socksProxy || '';
    return {
      mode: proxyRules ? 'fixed_servers' : 'system',
      proxyRules,
      proxyBypassRules: normalized.bypassRules || undefined,
    };
  }
  return { mode: 'system' };
}

function autoDetect(headerRow, keywords) {
  return headerRow.findIndex((h) => keywords.some((k) => String(h).toLowerCase().includes(k)));
}

function ensureColumn(header, label, keywords) {
  let idx = header.findIndex((value) => keywords.some((keyword) => String(value).toLowerCase().includes(keyword)));
  if (idx < 0) {
    idx = header.length;
    header[idx] = label;
  }
  return idx;
}

function fillCell(row, index, value) {
  while (row.length <= index) row.push('');
  row[index] = value;
}

function fillResultColumns(row, result, columns) {
  fillCell(row, columns.colDongBo, result.dongBoValue || '');
  fillCell(row, columns.colName, result.name || '');
  fillCell(row, columns.colTax, result.taxAuthority || '');
  fillCell(row, columns.colFoundMst, result.foundMst || '');
  fillCell(row, columns.colMstStatus, result.mstStatus || '');
  return row;
}

function resolveBundledTesseractLangPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'tesseract');
  }
  return path.join(app.getAppPath(), 'assets', 'tesseract');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function summarizeRequest(details = {}) {
  return {
    method: details.method,
    statusCode: details.statusCode,
    error: details.error,
    resourceType: details.resourceType,
    url: details.url,
    fromCache: details.fromCache,
    ip: details.ip,
  };
}

function getCaptchaBase64() {
  return new Promise((resolve, reject) => {
    const img = document.querySelector('img[src*="captcha.png"]');
    if (!img) return reject(new Error('CAPTCHA image not found'));
    const drawAndReturn = () => {
      try {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = (img.naturalWidth || img.width || 130) * scale;
        canvas.height = (img.naturalHeight || img.height || 35) * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    if (img.complete && img.naturalWidth > 0) drawAndReturn();
    else {
      img.onload = drawAndReturn;
      img.onerror = () => reject(new Error('CAPTCHA image load error'));
    }
  });
}

function fillAndSubmit(taxCode, captchaText) {
  const mstInput = document.querySelector('input[name="mst"]');
  const captchaInput = document.querySelector('#captcha');
  const submitBtn = document.querySelector('input.subBtn');
  if (!mstInput || !captchaInput || !submitBtn) {
    throw new Error('Lookup form elements not found');
  }
  mstInput.value = String(taxCode);
  captchaInput.value = String(captchaText);
  submitBtn.click();
  return true;
}

function readPageState() {
  const redPs = document.querySelectorAll('p[style*="color:red"], p[style*="color: red"]');
  for (const p of redPs) {
    if (p.textContent.includes('nhập đúng mã')) return { type: 'CAPTCHA_ERROR' };
  }
  const rc = document.querySelector('#resultContainer');
  if (!rc) return { type: 'FRESH_FORM' };
  const allTds = rc.querySelectorAll('td');
  for (const td of allTds) {
    if (td.textContent.includes('Không tìm thấy người nộp thuế')) {
      return { type: 'RESULT', data: { status: 'NOT_FOUND' } };
    }
  }
  const allRows = rc.querySelectorAll('table tbody tr, table tr');
  const dataRows = Array.from(allRows).filter((r) => !r.querySelector('th'));
  if (dataRows.length === 0) return { type: 'FRESH_FORM' };
  const cells = dataRows[0].querySelectorAll('td');
  if (cells.length < 5) return { type: 'FRESH_FORM' };
  const taxCode = (cells[1]?.textContent || '').trim();
  const name = (cells[2]?.textContent || '').trim();
  const taxAuthority = (cells[3]?.textContent || '').trim();
  const mstStatus = (cells[4]?.textContent || '').trim();
  const extraRows = [];
  for (let i = 1; i < dataRows.length; i++) {
    const rowCells = dataRows[i].querySelectorAll('td');
    if (rowCells.length >= 5) {
      extraRows.push({
        taxCode: (rowCells[1]?.textContent || '').trim(),
        name: (rowCells[2]?.textContent || '').trim(),
        taxAuthority: (rowCells[3]?.textContent || '').trim(),
        mstStatus: (rowCells[4]?.textContent || '').trim(),
      });
    }
  }
  return { type: 'RESULT', data: { status: 'FOUND', taxCode, name, taxAuthority, mstStatus, extraRows } };
}

module.exports = { TaxVerifierService };
