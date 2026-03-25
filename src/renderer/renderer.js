const $ = (id) => document.getElementById(id);

const dropzone = $('dropzone');
const btnChooseFileInline = $('btnChooseFileInline');
const fileInfo = $('fileInfo');
const fileName = $('fileName');
const btnClearFile = $('btnClearFile');
const columnSelector = $('columnSelector');
const colCccd = $('colCccd');
const colMst = $('colMst');
const colDongBo = $('colDongBo');
const btnLoad = $('btnLoad');
const statsBar = $('statsBar');
const statTotal = $('statTotal');
const statDone = $('statDone');
const statDongBo = $('statDongBo');
const statChuaDongBo = $('statChuaDongBo');
const statKhongTimThay = $('statKhongTimThay');
const statError = $('statError');
const currentCode = $('currentCode');
const codeDisplay = $('codeDisplay');
const phaseDisplay = $('phaseDisplay');
const progressWrap = $('progressWrap');
const progressBar = $('progressBar');
const progressPct = $('progressPct');
const controls = $('controls');
const btnStart = $('btnStart');
const btnPause = $('btnPause');
const btnStop = $('btnStop');
const btnExport = $('btnExport');
const resultsWrap = $('resultsWrap');
const resultsBody = $('resultsBody');
const btnClearResults = $('btnClearResults');
const manualProxyFields = $('manualProxyFields');
const httpProxy = $('httpProxy');
const httpsProxy = $('httpsProxy');
const socksProxy = $('socksProxy');
const bypassRules = $('bypassRules');
const proxyModeLabel = $('proxyModeLabel');
const proxyEffective = $('proxyEffective');
const proxyAppliedAt = $('proxyAppliedAt');
const btnSaveProxy = $('btnSaveProxy');
const btnRefreshProxy = $('btnRefreshProxy');

let currentState = null;
let loadedWorkbook = null;

function chooseFile() {
  return window.taxApp.pickFile();
}

dropzone.addEventListener('click', async (event) => {
  if (event.target.closest('.link-button')) return;
  await openWorkbookPicker();
});

btnChooseFileInline.addEventListener('click', async (event) => {
  event.stopPropagation();
  await openWorkbookPicker();
});

btnClearFile.addEventListener('click', () => {
  loadedWorkbook = null;
  fileInfo.hidden = true;
  dropzone.hidden = false;
  columnSelector.hidden = true;
  statsBar.hidden = true;
  currentCode.hidden = true;
  progressWrap.hidden = true;
  controls.hidden = true;
  resultsWrap.hidden = true;
  resultsBody.innerHTML = '';
  btnLoad.disabled = false;
});

btnLoad.addEventListener('click', async () => {
  if (!loadedWorkbook) return;
  const columns = readColumns();
  if (columns.dongBo < 0) {
    alert('Vui lòng chọn cột "Đồng bộ CCCD" để ghi kết quả.');
    return;
  }
  const data = await window.taxApp.prepareQueue(columns);
  statsBar.hidden = false;
  controls.hidden = false;
  renderProgress(data.progress);
  btnStart.disabled = false;
  btnPause.disabled = true;
  btnStop.disabled = true;
  btnExport.disabled = true;
});

btnStart.addEventListener('click', async () => {
  await window.taxApp.start();
  btnStart.disabled = true;
  btnPause.disabled = false;
  btnStop.disabled = false;
  progressWrap.hidden = false;
  currentCode.hidden = false;
});

btnPause.addEventListener('click', async () => {
  if (currentState?.phase === 'paused') {
    await window.taxApp.resume();
    btnPause.textContent = 'Tạm dừng';
    btnPause.classList.remove('btn-primary');
    btnPause.classList.add('btn-secondary');
  } else {
    await window.taxApp.pause();
    btnPause.textContent = 'Tiếp tục';
    btnPause.classList.remove('btn-secondary');
    btnPause.classList.add('btn-primary');
  }
});

btnStop.addEventListener('click', async () => {
  if (!confirm('Dừng quá trình tra cứu?')) return;
  await window.taxApp.stop();
  btnStart.disabled = false;
  btnPause.disabled = true;
  btnStop.disabled = true;
  btnPause.textContent = 'Tạm dừng';
  btnPause.classList.remove('btn-primary');
  btnPause.classList.add('btn-secondary');
  currentCode.hidden = true;
});

btnClearResults.addEventListener('click', async () => {
  await window.taxApp.clearResults();
  resultsBody.innerHTML = '';
  resultsWrap.hidden = true;
});

btnExport.addEventListener('click', async () => {
  const result = await window.taxApp.exportFile();
  if (result && !result.canceled) {
    alert(`Đã lưu file: ${result.path}`);
  }
});

for (const radio of document.querySelectorAll('input[name="proxyMode"]')) {
  radio.addEventListener('change', () => {
    syncProxyModeVisibility(getSelectedProxyMode());
  });
}

btnSaveProxy.addEventListener('click', async () => {
  const payload = collectProxySettings();
  btnSaveProxy.disabled = true;
  try {
    const result = await window.taxApp.saveProxySettings(payload);
    applyProxySettingsToForm(result);
    alert('Đã lưu và áp dụng cấu hình proxy runtime.');
  } finally {
    btnSaveProxy.disabled = false;
  }
});

btnRefreshProxy.addEventListener('click', async () => {
  btnRefreshProxy.disabled = true;
  try {
    const result = await window.taxApp.refreshProxyStatus();
    applyProxySettingsToForm(result);
  } finally {
    btnRefreshProxy.disabled = false;
  }
});

window.taxApp.onStateUpdate((state) => {
  currentState = state;
  syncState(state);
});

(async function init() {
  currentState = await window.taxApp.getState();
  syncState(currentState);
  const proxySettings = await window.taxApp.getProxySettings();
  applyProxySettingsToForm(proxySettings);
})();

async function openWorkbookPicker() {
  const filePath = await chooseFile();
  if (!filePath) return;
  const workbook = await window.taxApp.loadFile(filePath);
  loadedWorkbook = workbook;
  renderWorkbook(workbook);
}

function renderWorkbook(workbook) {
  fileName.textContent = workbook.fileName;
  fileInfo.hidden = false;
  dropzone.hidden = true;
  columnSelector.hidden = false;
  populateSelect(colCccd, workbook.header, workbook.detectedColumns.cccd);
  populateSelect(colMst, workbook.header, workbook.detectedColumns.mst);
  populateSelect(colDongBo, workbook.header, workbook.detectedColumns.dongBo);
}

function populateSelect(select, headers, selectedIndex) {
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '-1';
  none.textContent = '-- không chọn --';
  select.appendChild(none);
  headers.forEach((header, idx) => {
    const option = document.createElement('option');
    option.value = String(idx);
    option.textContent = `Cột ${idx + 1}: ${String(header).slice(0, 45)}`;
    select.appendChild(option);
  });
  if (typeof selectedIndex === 'number' && selectedIndex >= 0) {
    select.value = String(selectedIndex);
  } else {
    select.value = '-1';
  }
}

function readColumns() {
  return {
    cccd: parseInt(colCccd.value, 10),
    mst: parseInt(colMst.value, 10),
    dongBo: parseInt(colDongBo.value, 10),
  };
}

function syncState(state) {
  if (!state) return;
  if (state.workbook && !loadedWorkbook) {
    loadedWorkbook = state.workbook;
    renderWorkbook(state.workbook);
  }
  renderProgress(state.progress || {});
  renderResults(state.results || []);
  applyProxySettingsToForm(state.proxySettings || {});
  handlePhaseChange(state.phase);
}

function renderProgress(progress) {
  statTotal.textContent = progress.total || 0;
  statDone.textContent = progress.done || 0;
  statDongBo.textContent = progress.dongBo || 0;
  statChuaDongBo.textContent = progress.chuaDongBo || 0;
  statKhongTimThay.textContent = progress.khongTimThay || 0;
  statError.textContent = progress.errors || 0;

  if (progress.currentCode) {
    codeDisplay.textContent = progress.currentCode;
    currentCode.hidden = false;
    phaseDisplay.textContent = progress.currentPhase ? `(giai đoạn ${progress.currentPhase})` : '';
  }

  const pct = Math.round(((progress.done || 0) / (progress.total || 1)) * 100);
  progressBar.value = pct;
  progressPct.textContent = `${pct}%`;
  progressWrap.hidden = false;
  statsBar.hidden = false;
}

const STATUS_CLASS = {
  DONG_BO: 'status-dongbo',
  CHUA_DONG_BO: 'status-chuadb',
  KHONG_TIM_THAY: 'status-khong',
  ERROR_CAPTCHA: 'status-error',
  ERROR_NETWORK: 'status-error',
};

const STATUS_LABEL = {
  DONG_BO: 'Đồng bộ',
  CHUA_DONG_BO: 'Chưa đồng bộ',
  KHONG_TIM_THAY: 'Không tìm thấy',
  ERROR_CAPTCHA: 'Lỗi CAPTCHA',
  ERROR_NETWORK: 'Lỗi mạng',
};

function renderResults(results) {
  if (!results || results.length === 0) return;
  resultsWrap.hidden = false;

  const recent = results.slice(-15).reverse();
  resultsBody.innerHTML = '';
  for (const r of recent) {
    const tr = document.createElement('tr');
    const displayCode = r.cccdCode || r.mstCode || '';
    const statusCls = STATUS_CLASS[r.status] || 'status-pending';
    const statusLbl = STATUS_LABEL[r.status] || r.status || 'Chưa xử lý';

    tr.innerHTML = `
      <td title="${escapeHtml(displayCode)}">${escapeHtml(displayCode)}</td>
      <td title="${escapeHtml(r.dongBoValue || '')}">${escapeHtml(r.dongBoValue || '—')}</td>
      <td title="${escapeHtml(r.name || '')}">${escapeHtml(r.name || '—')}</td>
      <td title="${escapeHtml(r.foundMst || '')}">${escapeHtml(r.foundMst || '—')}</td>
      <td class="${statusCls}">${escapeHtml(statusLbl)}</td>
    `;
    resultsBody.appendChild(tr);
  }
}

function handlePhaseChange(phase) {
  if (phase === 'done') {
    currentCode.hidden = true;
    codeDisplay.textContent = '';
    phaseDisplay.textContent = '';
    btnStart.disabled = true;
    btnPause.disabled = true;
    btnStop.disabled = true;
    btnExport.disabled = false;
  } else if (phase === 'running') {
    controls.hidden = false;
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnStop.disabled = false;
    progressWrap.hidden = false;
    currentCode.hidden = false;
  } else if (phase === 'paused') {
    controls.hidden = false;
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnStop.disabled = false;
    btnPause.textContent = 'Tiếp tục';
    btnPause.classList.remove('btn-secondary');
    btnPause.classList.add('btn-primary');
  } else if (phase === 'idle' && (currentState?.progress?.total || 0) > 0) {
    controls.hidden = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled = true;
  }
}

function collectProxySettings() {
  return {
    mode: getSelectedProxyMode(),
    httpProxy: httpProxy.value.trim(),
    httpsProxy: httpsProxy.value.trim(),
    socksProxy: socksProxy.value.trim(),
    bypassRules: bypassRules.value.trim(),
  };
}

function getSelectedProxyMode() {
  const selected = document.querySelector('input[name="proxyMode"]:checked');
  return selected?.value || 'system';
}

function applyProxySettingsToForm(settings) {
  const proxySettings = {
    mode: settings.mode || 'system',
    httpProxy: settings.httpProxy || '',
    httpsProxy: settings.httpsProxy || '',
    socksProxy: settings.socksProxy || '',
    bypassRules: settings.bypassRules || 'localhost,127.0.0.1,::1',
    effectiveProxy: settings.effectiveProxy || settings.mode || 'system',
    lastAppliedAt: settings.lastAppliedAt || null,
  };

  const radio = document.querySelector(`input[name="proxyMode"][value="${proxySettings.mode}"]`);
  if (radio) radio.checked = true;
  httpProxy.value = proxySettings.httpProxy;
  httpsProxy.value = proxySettings.httpsProxy;
  socksProxy.value = proxySettings.socksProxy;
  bypassRules.value = proxySettings.bypassRules;
  proxyModeLabel.textContent = proxySettings.mode;
  proxyEffective.textContent = proxySettings.effectiveProxy;
  proxyAppliedAt.textContent = proxySettings.lastAppliedAt ? new Date(proxySettings.lastAppliedAt).toLocaleString('vi-VN') : '—';
  syncProxyModeVisibility(proxySettings.mode);
}

function syncProxyModeVisibility(mode) {
  manualProxyFields.hidden = mode !== 'manual';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
