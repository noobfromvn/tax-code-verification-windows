const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const LOG_FILE_NAME = 'debug.log';
const DEBUG_ENABLED = process.env.TAX_APP_DEBUG === '1';

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return '[unserializable]';
  }
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || null,
    cause: error.cause ? serializeError(error.cause) : null,
    code: error.code || null,
  };
}

function createLogger() {
  const logDir = app.getPath('userData');
  const logPath = path.join(logDir, LOG_FILE_NAME);

  const writeLine = async (line) => {
    if (!DEBUG_ENABLED) return;
    try {
      await fsp.mkdir(logDir, { recursive: true });
      await fsp.appendFile(logPath, `${line}\n`, 'utf8');
    } catch (error) {
      console.error('[logger] failed to write debug log', error);
    }
  };

  const log = (tag, message, meta) => {
    if (!DEBUG_ENABLED) return;
    const timestamp = new Date().toISOString();
    const metaText = meta === undefined ? '' : ` ${safeJson(meta)}`;
    const line = `${timestamp} ${tag} ${message}${metaText}`;
    console.log(line);
    void writeLine(line);
  };

  const logError = (tag, message, error, meta) => {
    log(tag, message, {
      ...meta,
      error: serializeError(error),
    });
  };

  const resetSessionMarker = () => {
    if (!DEBUG_ENABLED) return;
    const line = `${new Date().toISOString()} [app] session-start ${process.pid}`;
    console.log(line);
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(logPath, `${line}\n`, 'utf8');
    } catch (error) {
      console.error('[logger] failed to initialize debug log', error);
    }
  };

  return {
    logPath,
    log,
    logError,
    serializeError,
    resetSessionMarker,
    debugEnabled: DEBUG_ENABLED,
  };
}

module.exports = { createLogger, serializeError };
