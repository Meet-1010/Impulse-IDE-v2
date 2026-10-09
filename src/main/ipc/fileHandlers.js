/**
 * File and folder IPC handlers (read, save, list directory).
 * All paths are validated against user-approved directories.
 * @module main/ipc/fileHandlers
 */

const path = require('path');
const { parseOrDefault, schemas } = require('./schemas');
const { withDebugLog } = require('../utils/logger');
const { validatePath } = require('../utils/pathValidator');

const defaultFail = { success: false, error: 'Invalid input' };

/**
 * Register file/folder IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ fsp: import('fs').promises, path: typeof path }} ctx
 */
function register(ipcMain, ctx) {
  const { fsp } = ctx;

  ipcMain.handle('folder:list', withDebugLog('folder:list', async (event, dirPath) => {
    const parsed = parseOrDefault(schemas.folderList, { dirPath: dirPath ?? '' }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;

    const pathCheck = validatePath(parsed.data.dirPath);
    if (!pathCheck.valid) return { success: false, error: pathCheck.error };

    try {
      const entries = await fsp.readdir(pathCheck.resolved, { withFileTypes: true });
      const list = entries
        .filter(e => !e.name.startsWith('.'))
        .map(e => ({
          name: e.name,
          path: path.join(pathCheck.resolved, e.name),
          isDirectory: e.isDirectory()
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
      return { success: true, entries: list };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Failed to list folder' };
    }
  }));

  ipcMain.handle('file:read', withDebugLog('file:read', async (event, filePath) => {
    const parsed = parseOrDefault(schemas.fileRead, { filePath: filePath ?? '' }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;

    const pathCheck = validatePath(parsed.data.filePath);
    if (!pathCheck.valid) return { success: false, error: pathCheck.error };

    try {
      const content = await fsp.readFile(pathCheck.resolved, 'utf8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Failed to read file' };
    }
  }));

  ipcMain.handle('file:save', withDebugLog('file:save', async (event, filePath, content) => {
    const parsed = parseOrDefault(schemas.fileSave, { filePath: filePath ?? '', content: content ?? '' }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;

    const pathCheck = validatePath(parsed.data.filePath, { write: true });
    if (!pathCheck.valid) return { success: false, error: pathCheck.error };

    try {
      await fsp.writeFile(pathCheck.resolved, parsed.data.content, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Failed to save file' };
    }
  }));
}

module.exports = { register };
