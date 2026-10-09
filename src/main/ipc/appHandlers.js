/**
 * App-level IPC handlers (quit, clipboard).
 * @module main/ipc/appHandlers
 */

const { clipboard } = require('electron');
const logger = require('../utils/logger');

/**
 * Register app IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ app: import('electron').App } } ctx
 */
function register(ipcMain, ctx) {
  const { app } = ctx;
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.on('app:log-renderer-error', (event, entry) => {
    if (!entry || typeof entry !== 'object') return;
    const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    logger.error('renderer', { message: clip(entry.message, 2000), source: clip(entry.source, 300), stack: clip(entry.stack, 4000) });
  });

  // Clipboard bridge — renderer text fields need real paste (execCommand('paste')
  // is a no-op in Electron renderers, and the Edit-menu accelerator swallows Cmd+V).
  ipcMain.handle('clipboard:read-text', () => clipboard.readText());
  ipcMain.handle('clipboard:write-text', (event, text) => {
    if (typeof text === 'string' && text.length <= 1_000_000) clipboard.writeText(text);
    return true;
  });
}

module.exports = { register };
