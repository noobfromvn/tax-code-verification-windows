const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { TaxVerifierService } = require('./verifier-service');
const { createLogger } = require('./logger');

const PROXY_SETTINGS_FILE = 'proxy-settings.json';

const logger = createLogger();
let mainWindow;
let service;
let isQuitting = false;
let shutdownPromise = null;
let forcedExitTimer = null;
let appState = createInitialState();

function createInitialState() {
  return {
    phase: 'idle',
    queue: [],
    current: null,
    results: [],
    progress: {
      total: 0,
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
    workbook: null,
    detectedColumns: {
      cccd: -1,
      mst: -1,
      dongBo: -1,
    },
    currentFilePath: '',
    proxySettings: createDefaultProxySettings(),
    debug: {
      enabled: logger.debugEnabled,
      logPath: logger.debugEnabled ? '' : '',
    },
  };
}

function createDefaultProxySettings() {
  return {
    mode: 'system',
    httpProxy: '',
    httpsProxy: '',
    socksProxy: '',
    bypassRules: 'localhost,127.0.0.1,::1',
    effectiveProxy: 'system',
    lastAppliedAt: null,
  };
}

function getProxySettingsPath() {
  return path.join(app.getPath('userData'), PROXY_SETTINGS_FILE);
}

function normalizeProxySettings(input = {}) {
  const next = {
    ...createDefaultProxySettings(),
    ...input,
  };
  next.mode = ['system', 'manual', 'direct'].includes(next.mode) ? next.mode : 'system';
  next.httpProxy = String(next.httpProxy || '').trim();
  next.httpsProxy = String(next.httpsProxy || '').trim();
  next.socksProxy = String(next.socksProxy || '').trim();
  next.bypassRules = String(next.bypassRules || '').trim();
  next.effectiveProxy = String(next.effectiveProxy || next.mode || 'system');
  next.lastAppliedAt = next.lastAppliedAt || null;
  return next;
}

async function loadProxySettings() {
  try {
    const raw = await fs.readFile(getProxySettingsPath(), 'utf8');
    return normalizeProxySettings(JSON.parse(raw));
  } catch (_error) {
    return createDefaultProxySettings();
  }
}

async function saveProxySettings(settings) {
  const normalized = normalizeProxySettings(settings);
  await fs.writeFile(getProxySettingsPath(), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function emitState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state:update', appState);
  }
}

function clearForcedExitTimer() {
  if (!forcedExitTimer) return;
  clearTimeout(forcedExitTimer);
  forcedExitTimer = null;
}

function scheduleForcedExit(reason) {
  if (forcedExitTimer || process.platform === 'darwin') return;
  forcedExitTimer = setTimeout(() => {
    logger.log('[app]', 'forced-exit-timeout', { reason, timeoutMs: 4000 });
    app.exit(0);
  }, 4000);
  forcedExitTimer.unref?.();
}

async function shutdownApp(reason = 'unknown') {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    isQuitting = true;
    logger.log('[app]', 'shutdown-start', { reason });
    scheduleForcedExit(reason);

    try {
      await service?.dispose();
    } catch (error) {
      logger.logError('[app]', 'shutdown-dispose-failed', error, { reason });
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeAllListeners('close');
      mainWindow.destroy();
    }

    logger.log('[app]', 'shutdown-finish', { reason });

    if (process.platform === 'darwin') {
      clearForcedExitTimer();
      app.quit();
      return;
    }

    app.exit(0);
  })();
  return shutdownPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 920,
    minWidth: 780,
    minHeight: 640,
    backgroundColor: '#f8f9fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (isQuitting || process.platform === 'darwin') return;
    event.preventDefault();
    void shutdownApp('main-window-close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

async function bootstrapService() {
  appState.proxySettings = await loadProxySettings();
  appState.debug = { enabled: logger.debugEnabled, logPath: logger.debugEnabled ? logger.logPath : '' };
  service = new TaxVerifierService({
    onStatePatch: (patch) => {
      appState = {
        ...appState,
        ...patch,
        progress: patch.progress ? patch.progress : appState.progress,
      };
      emitState();
    },
    onResult: (result, progress) => {
      appState.results = [...appState.results, result];
      appState.progress = progress;
      emitState();
    },
    getState: () => appState,
    getProxySettings: () => appState.proxySettings,
    onProxyApplied: async (proxySettings) => {
      appState.proxySettings = normalizeProxySettings(proxySettings);
      await saveProxySettings(appState.proxySettings);
      emitState();
    },
    logger,
  });
  await service.refreshProxyStatus();
  logger.log('[app]', 'service-bootstrapped', {
    logPath: logger.logPath,
    userData: app.getPath('userData'),
    proxyMode: appState.proxySettings.mode,
  });
}

app.whenReady().then(async () => {
  logger.resetSessionMarker();
  appState.debug = { enabled: logger.debugEnabled, logPath: logger.debugEnabled ? logger.logPath : '' };
  logger.log('[app]', 'ready-start', {
    userData: app.getPath('userData'),
    cwd: process.cwd(),
  });
  await bootstrapService();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  logger.logError('[app]', 'ready-failed', error);
  throw error;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    logger.log('[app]', 'window-all-closed');
    void shutdownApp('window-all-closed');
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  clearForcedExitTimer();
});

app.on('render-process-gone', (_event, webContents, details) => {
  logger.log('[app]', 'render-process-gone', {
    reason: details.reason,
    exitCode: details.exitCode,
    url: webContents.getURL(),
  });
});

app.on('child-process-gone', (_event, details) => {
  logger.log('[app]', 'child-process-gone', details);
});

ipcMain.handle('app:get-state', async () => appState);
ipcMain.handle('app:get-debug-log-path', async () => logger.logPath);

ipcMain.handle('dialog:pick-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('file:download-sample', async () => {
  logger.log('[app]', 'sample-download-start');
  const workbookBuffer = service.createSampleWorkbook();
  const defaultPath = path.join(app.getPath('downloads'), 'tax-code-verification-sample.xlsx');
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    logger.log('[app]', 'sample-download-canceled');
    return { canceled: true };
  }
  await fs.writeFile(saveResult.filePath, workbookBuffer);
  logger.log('[app]', 'sample-download-done', { filePath: saveResult.filePath });
  return { canceled: false, path: saveResult.filePath };
});

ipcMain.handle('file:load', async (_event, filePath) => {
  logger.log('[app]', 'file-load-start', { filePath });
  const buffer = await fs.readFile(filePath);
  const workbookData = service.loadWorkbook(buffer, filePath);
  appState.workbook = workbookData;
  appState.detectedColumns = workbookData.detectedColumns;
  appState.currentFilePath = filePath;
  emitState();
  logger.log('[app]', 'file-load-done', {
    filePath,
    rows: workbookData.rows.length,
    detectedColumns: workbookData.detectedColumns,
  });
  return workbookData;
});

ipcMain.handle('queue:prepare', async (_event, columns) => {
  const queueData = service.prepareQueue(appState.workbook, columns);
  appState.queue = queueData.queue;
  appState.results = [];
  appState.current = null;
  appState.phase = 'idle';
  appState.progress = queueData.progress;
  appState.detectedColumns = columns;
  emitState();
  logger.log('[app]', 'queue-prepared', {
    columns,
    total: queueData.progress.total,
  });
  return queueData;
});

ipcMain.handle('process:start', async () => {
  logger.log('[app]', 'process-start');
  appState.phase = 'running';
  appState.progress = { ...appState.progress, isPaused: false, isStopped: false };
  emitState();
  await service.start();
  return { ok: true };
});

ipcMain.handle('process:pause', async () => {
  logger.log('[app]', 'process-pause');
  appState.phase = 'paused';
  appState.progress = { ...appState.progress, isPaused: true };
  service.pause();
  emitState();
  return { ok: true };
});

ipcMain.handle('process:resume', async () => {
  logger.log('[app]', 'process-resume');
  appState.phase = 'running';
  appState.progress = { ...appState.progress, isPaused: false };
  emitState();
  await service.resume();
  return { ok: true };
});

ipcMain.handle('process:stop', async () => {
  logger.log('[app]', 'process-stop');
  appState.phase = 'idle';
  appState.current = null;
  appState.progress = { ...appState.progress, isStopped: true, currentCode: '', currentPhase: '' };
  emitState();
  await service.stop();
  return { ok: true };
});

ipcMain.handle('results:clear', async () => {
  logger.log('[app]', 'results-clear');
  appState.results = [];
  emitState();
  return { ok: true };
});

ipcMain.handle('file:export', async () => {
  logger.log('[app]', 'file-export-start');
  const result = await service.exportWorkbook(appState.workbook, appState.results, appState.currentFilePath);
  logger.log('[app]', 'file-export-done', result);
  return result;
});

ipcMain.handle('proxy:get-settings', async () => {
  await service.refreshProxyStatus();
  return appState.proxySettings;
});

ipcMain.handle('proxy:save-settings', async (_event, settings) => {
  const saved = normalizeProxySettings(settings);
  logger.log('[network]', 'proxy-save-settings', saved);
  appState.proxySettings = saved;
  await saveProxySettings(saved);
  await service.applyProxySettings(saved);
  return appState.proxySettings;
});

ipcMain.handle('proxy:refresh-status', async () => {
  await service.refreshProxyStatus();
  return appState.proxySettings;
});
