/**
 * First-run setup: report what the toolchain is missing and install it with
 * progress events ('toolchain:progress').
 * @module main/ipc/toolchainHandlers
 */

const { withDebugLog } = require('../utils/logger');

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ toolchain: import('../services/toolchain').Toolchain, arduinoService: object, mainWindow: import('electron').BrowserWindow|null }} ctx
 */
function register(ipcMain, ctx) {
  const { toolchain, arduinoService } = ctx;
  let running = null;

  toolchain.on('progress', (p) => {
    const win = ctx.mainWindow;
    if (win && !win.isDestroyed()) win.webContents.send('toolchain:progress', p);
  });

  ipcMain.handle('toolchain:status', withDebugLog('toolchain:status', async () => {
    try {
      return { success: true, data: await toolchain.status() };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Could not check the toolchain' };
    }
  }));

  ipcMain.handle('toolchain:setup', withDebugLog('toolchain:setup', async () => {
    if (running) return running; // one setup at a time
    running = (async () => {
      try {
        const status = await toolchain.setup();
        if (status.cli) arduinoService.cliPath = status.cli.path;
        arduinoService.coreIndexed = false;
        return { success: true, data: status };
      } catch (error) {
        return { success: false, error: error?.message ?? 'Setup failed' };
      } finally {
        running = null;
      }
    })();
    return running;
  }));
}

module.exports = { register };
