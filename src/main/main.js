/**
 * Impulse IDE - Electron main process.
 * Creates window, initializes services, and registers IPC handlers.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

// Data lives in "Impulse IDE". Development builds before 2.0 ran as
// "arduino-ide-cursor": while only that folder holds app data, keep using it
// so settings, sessions and approved folders survive. (Electron creates the
// new folder before this runs, so look for real data, not the folder.)
// Runs before any service module asks for the userData path.
const legacyUserData = path.join(app.getPath('appData'), 'arduino-ide-cursor');
const hasAppData = (dir) => fs.existsSync(path.join(dir, 'Local Storage'));
const explicitProfile = app.commandLine.hasSwitch('user-data-dir');
if (!explicitProfile && !hasAppData(app.getPath('userData')) && hasAppData(legacyUserData)) app.setPath('userData', legacyUserData);

const ArduinoService = require('./services/arduinoService');
const SerialMonitor = require('./services/serialMonitor');
const ErrorMemory = require('./services/errorMemory');
const AIAgent = require('./services/ai/agent');
const APIKeyManager = require('./services/ai/config/apiKeyManager');
const { registerAllIpc } = require('./ipc');
const { debug } = require('./utils/logger');
const notifications = require('./utils/notifications');
const WorkspaceStore = require('./services/workspaceStore');
const { Toolchain } = require('./services/toolchain');
const { Esp32Simulator, bundledQemuDir } = require('./services/esp32sim');
const { validatePath } = require('./utils/pathValidator');

const logger = require('./utils/logger');
const { ProblemReporter } = require('./services/problemReporter');

// Where problem reports go: the GitHub repository in package.json.
const pkg = require('../../package.json');
const reportRepo = /github\.com\/([^/]+\/[^/#]+)/.exec(pkg.bugs?.url || '')?.[1]?.replace(/\/issues$/, '') || 'Meet-1010/Impulse-IDE-v2';
const problemReporter = new ProblemReporter({
  userDataDir: app.getPath('userData'),
  logFile: path.join(app.getPath('logs'), 'impulse.log'),
  version: app.getVersion(),
  repo: reportRepo
});

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { error: err?.message, stack: err?.stack });
  problemReporter.recordCrash('main', err);
});
process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { error: reason?.message ?? String(reason) }));
app.on('render-process-gone', (event, webContents, details) => {
  if (details.reason === 'clean-exit') return;
  logger.error('render-process-gone', details);
  problemReporter.recordCrash('renderer', { message: `The window's renderer stopped (${details.reason}, exit code ${details.exitCode}).` });
});

let mainWindow;
let arduinoService;
let serialMonitor;
let errorMemory;
let aiAgent;
let apiKeyManager;
let workspace;
let esp32sim;

const uiState = {
  currentBaudRate: 115200,
  currentSketchPath: null,
  selectedBoard: null,
  selectedPort: null,
  editorCode: ''
};

/**
 * Create the main application window and menu.
 */
function createWindow() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // Enhances isolation by running renderer in OS sandbox
      disableBlinkFeatures: 'Auxclick', // Prevent middle-click vulnerabilities
      preload: path.join(__dirname, 'preload.js')
    },
    icon: iconPath
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  // A crashed renderer leaves a blank window: offer to reload it.
  mainWindow.webContents.on('render-process-gone', async (event, details) => {
    if (details.reason === 'clean-exit' || !mainWindow || mainWindow.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'error',
      buttons: ['Reload', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      title: 'Impulse stopped responding',
      message: 'The Impulse window stopped working.',
      detail: 'Reload to continue where you left off. Your files are saved on disk; after reloading you can report what happened.'
    });
    if (response === 0 && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    else app.quit();
  });

  // Electron shows no menu on right-click: offer the text edits where they
  // apply (fields, the editor, selected text such as a chat answer). Parts of
  // the UI with their own menus (the simulator canvas) cancel the event first.
  mainWindow.webContents.on('context-menu', (event, params) => {
    const flags = params.editFlags || {};
    const hasSelection = !!params.selectionText?.trim();
    let template;
    if (params.isEditable) {
      template = [
        { role: 'undo', enabled: flags.canUndo },
        { role: 'redo', enabled: flags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: flags.canCut },
        { role: 'copy', enabled: flags.canCopy },
        { role: 'paste', enabled: flags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: flags.canSelectAll },
      ];
    } else if (hasSelection) {
      template = [{ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' }];
    } else {
      return;
    }
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // SECURITY: Prevent navigation to external websites within the app
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // Only allow local file loads or the Vite Dev server
    if (parsedUrl.protocol !== 'file:' && !navigationUrl.startsWith('http://localhost:5173')) {
      event.preventDefault();
      console.warn(`[Security] Blocked navigation attempt to: ${navigationUrl}`);
    }
  });

  // SECURITY: Intercept all new window requests (e.g., target="_blank" links)
  // and securely route them to the user's default OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      shell.openExternal(url);
    } else {
      console.warn(`[Security] Blocked unsafe link open attempt to: ${url}`);
    }
    return { action: 'deny' }; // Never open a new Electron BrowserWindow
  });

  const isDev = process.argv.includes('--dev');
  // Only open DevTools when explicitly requested (IMPULSE_IDE_DEVTOOLS=1),
  // not on every dev launch. Users can always toggle with F12 / Ctrl+Shift+I.
  if (isDev && process.env.IMPULSE_IDE_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }

  // Preserve a manual DevTools toggle (the custom app menu replaces Electron's
  // default View menu, which normally provides this).
  // Dev builds only, and not on Ctrl+Shift+I (that's Manage Libraries).
  if (isDev || process.env.IMPULSE_IDE_DEVTOOLS === '1') {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const isF12 = input.key === 'F12';
      const isAltModI = input.alt && (input.meta || input.control) && input.key.toLowerCase() === 'i';
      if (isF12 || isAltModI) mainWindow.webContents.toggleDevTools();
    });
  }

  // Load the renderer:
  // - Dev mode (--dev): connect to Vite dev server for HMR
  // - Production / start: load from Vite-built output (dist-renderer/)
  const distRenderer = path.join(__dirname, '../../dist-renderer/index.html');

  if (isDev) {
    // In dev mode, Vite dev server must be running (npm run dev:renderer)
    const VITE_DEV_URL = process.env.VITE_DEV_URL || 'http://localhost:5173';
    mainWindow.loadURL(VITE_DEV_URL).catch(() => {
      // Fallback: if Vite dev server isn't running, load the built version
      if (fs.existsSync(distRenderer)) {
        mainWindow.loadFile(distRenderer);
      } else {
        // Last resort: show an error instead of a white screen
        mainWindow.loadURL(`data:text/html,<h2 style="font-family:sans-serif;padding:40px">Renderer not built.</h2><p style="font-family:sans-serif;padding:0 40px">Run <code>npm run build:renderer</code> first, or start the Vite dev server with <code>npm run dev:renderer</code>.</p>`);
      }
    });
  } else if (fs.existsSync(distRenderer)) {
    mainWindow.loadFile(distRenderer);
  } else {
    // Production but dist missing -- show actionable error
    mainWindow.loadURL(`data:text/html,<h2 style="font-family:sans-serif;padding:40px">Renderer not built.</h2><p style="font-family:sans-serif;padding:0 40px">Run <code>npm run build:renderer</code> to build the UI.</p>`);
  }

  // --- Content Security Policy ---
  // Block eval, inline scripts, and restrict origins to what the app actually needs.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            isDev ? "connect-src 'self' ws://localhost:5173 http://localhost:5173" : "connect-src 'self'",
            "img-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'"
          ].join('; ')
        ]
      }
    });
  });

  buildMenu();

}

function sendMenuAction(action, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:action', action, payload);
  }
}

/**
 * Application menu. It is the single source of keyboard shortcuts: the
 * renderer must not also bind these keys, or they fire twice.
 */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const recent = workspace ? workspace.getRecent() : [];
  const recentItems = recent.length
    ? [
      ...recent.map(folder => ({
        label: folder.replace(require('os').homedir(), '~'),
        click: () => sendMenuAction('file-open-recent', folder)
      })),
      { type: 'separator' },
      { label: 'Clear Recent', click: () => workspace && workspace.clearRecent() }
    ]
    : [{ label: 'No recent folders', enabled: false }];

  const template = [
    ...(isMac ? [{
      label: 'Impulse',
      submenu: [
        { label: 'About Impulse', click: () => sendMenuAction('help-about') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendMenuAction('file-preferences') },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Impulse' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Impulse' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Sketch', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('file-new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('file-open') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenuAction('file-open-folder') },
        { label: 'Open Recent', submenu: recentItems },
        { label: 'Examples', click: () => sendMenuAction('file-examples') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('file-save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('file-save-as') },
        { type: 'separator' },
        ...(isMac ? [] : [
          { label: 'Preferences…', accelerator: 'Ctrl+,', click: () => sendMenuAction('file-preferences') },
          { type: 'separator' }
        ]),
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendMenuAction('file-close') },
        ...(isMac ? [] : [{ label: 'Quit', accelerator: 'Ctrl+Q', click: () => sendMenuAction('file-quit') }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('edit-undo') },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => sendMenuAction('edit-redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => sendMenuAction('edit-cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => sendMenuAction('edit-copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => sendMenuAction('edit-paste') },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => sendMenuAction('edit-select-all') },
        { type: 'separator' },
        { label: 'Go to Line…', accelerator: 'CmdOrCtrl+L', click: () => sendMenuAction('edit-goto-line') },
        { label: 'Comment/Uncomment', accelerator: 'CmdOrCtrl+/', click: () => sendMenuAction('edit-comment') },
        { label: 'Increase Indent', accelerator: 'CmdOrCtrl+]', click: () => sendMenuAction('edit-increase-indent') },
        { label: 'Decrease Indent', accelerator: 'CmdOrCtrl+[', click: () => sendMenuAction('edit-decrease-indent') },
        { label: 'Auto Format', accelerator: 'CmdOrCtrl+T', click: () => sendMenuAction('edit-format') },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => sendMenuAction('edit-find') },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => sendMenuAction('edit-find-next') },
        { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: () => sendMenuAction('edit-find-prev') },
        { label: 'Replace', accelerator: isMac ? 'Cmd+Alt+F' : 'Ctrl+H', click: () => sendMenuAction('edit-replace') },
        { type: 'separator' },
        { label: 'Increase Font Size', accelerator: 'CmdOrCtrl+=', click: () => sendMenuAction('edit-font-increase') },
        { label: 'Decrease Font Size', accelerator: 'CmdOrCtrl+-', click: () => sendMenuAction('edit-font-decrease') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Sketchbook', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenuAction('view-explorer') },
        { label: 'Source Control', accelerator: 'CmdOrCtrl+Shift+G', click: () => sendMenuAction('view-scm') },
        { label: 'Board Manager', accelerator: 'CmdOrCtrl+Shift+B', click: () => sendMenuAction('view-boards') },
        { label: 'Library Manager', accelerator: 'CmdOrCtrl+Shift+I', click: () => sendMenuAction('tools-manage-libs') },
        { label: '2D Simulator', accelerator: 'CmdOrCtrl+Shift+D', click: () => sendMenuAction('view-simulator') },
        { label: 'AI Assistant', accelerator: 'CmdOrCtrl+Shift+A', click: () => sendMenuAction('view-ai') },
        { type: 'separator' },
        { label: 'Toggle Light/Dark', click: () => sendMenuAction('view-toggle-theme') }
      ]
    },
    {
      label: 'Sketch',
      submenu: [
        { label: 'Verify/Compile', accelerator: 'CmdOrCtrl+R', click: () => sendMenuAction('sketch-verify') },
        { label: 'Upload', accelerator: 'CmdOrCtrl+U', click: () => sendMenuAction('sketch-upload') },
        { label: 'Upload Using Programmer…', accelerator: 'CmdOrCtrl+Shift+U', click: () => sendMenuAction('sketch-upload-programmer') },
        { type: 'separator' },
        { label: 'Run Hardware Tests', accelerator: 'CmdOrCtrl+Shift+T', click: () => sendMenuAction('sketch-run-tests') },
        { label: 'Compare Simulator with Board…', click: () => sendMenuAction('sketch-compare-board') },
        { type: 'separator' },
        { label: 'Export Compiled Binary', accelerator: 'CmdOrCtrl+Alt+S', click: () => sendMenuAction('sketch-export-binary') },
        { label: 'Show Sketch Folder', accelerator: 'CmdOrCtrl+Alt+K', click: () => sendMenuAction('sketch-show-folder') },
        { type: 'separator' },
        { label: 'Include Library', click: () => sendMenuAction('sketch-include-library') },
        { label: 'Add Tab…', click: () => sendMenuAction('sketch-add-tab') },
        { label: 'Add File…', click: () => sendMenuAction('sketch-add-file') }
      ]
    },
    {
      label: 'Debug',
      submenu: [
        { label: 'Start Debugging / Continue', accelerator: 'F5', click: () => sendMenuAction('debug-start') },
        { label: 'Stop Debugging', accelerator: 'Shift+F5', click: () => sendMenuAction('debug-stop') },
        { type: 'separator' },
        { label: 'Step Over', accelerator: 'F10', click: () => sendMenuAction('debug-step-over') },
        { label: 'Step Into', accelerator: 'F11', click: () => sendMenuAction('debug-step-into') },
        { label: 'Step Out', accelerator: 'Shift+F11', click: () => sendMenuAction('debug-step-out') },
        { label: 'Run to Cursor', accelerator: 'CmdOrCtrl+F10', click: () => sendMenuAction('debug-run-to-cursor') },
        { type: 'separator' },
        { label: 'Toggle Breakpoint', accelerator: 'F9', click: () => sendMenuAction('debug-toggle-breakpoint') },
        { label: 'Remove All Breakpoints', click: () => sendMenuAction('debug-clear-breakpoints') }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Auto Format', click: () => sendMenuAction('tools-format') },
        { label: 'Archive Sketch…', click: () => sendMenuAction('tools-archive') },
        { type: 'separator' },
        { label: 'Serial Monitor', accelerator: 'CmdOrCtrl+Shift+M', click: () => sendMenuAction('tools-serial-monitor') },
        { label: 'Serial Plotter', accelerator: 'CmdOrCtrl+Shift+L', click: () => sendMenuAction('tools-serial-plotter') },
        { type: 'separator' },
        { label: 'Board…', click: () => sendMenuAction('tools-board') },
        { label: 'Port…', click: () => sendMenuAction('tools-port') },
        { label: 'Board Options…', click: () => sendMenuAction('tools-board-options') },
        { label: 'PlatformIO Environment…', click: () => sendMenuAction('tools-pio-env') },
        { label: 'Reload Board Data', click: () => sendMenuAction('tools-reload-boards') },
        { label: 'Set Up Arduino Tools…', click: () => sendMenuAction('tools-setup') },
        { label: 'Get Board Info', click: () => sendMenuAction('tools-get-board-info') }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Getting Started', click: () => sendMenuAction('help-getting-started') },
        { label: 'Environment', click: () => sendMenuAction('help-environment') },
        { label: 'Troubleshooting', click: () => sendMenuAction('help-troubleshooting') },
        { label: 'Reference', click: () => sendMenuAction('help-reference') },
        { label: 'Find in Reference', accelerator: 'CmdOrCtrl+Shift+F', click: () => sendMenuAction('help-find-reference') },
        { type: 'separator' },
        { label: 'Frequently Asked Questions', click: () => sendMenuAction('help-faq') },
        { label: 'Visit Arduino.cc', click: () => sendMenuAction('help-visit-arduino') },
        { type: 'separator' },
        { label: 'Report a Problem…', click: () => sendMenuAction('help-report-problem') },
        ...(isMac ? [] : [
          { type: 'separator' },
          { label: 'About Impulse', click: () => sendMenuAction('help-about') }
        ])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  debug('app.whenReady', {});
  // Test and automation copies (smoke, e2e, live checks) stay out of the macOS
  // Dock, so the installed Impulse is the only one people see there.
  if (process.platform === 'darwin' && process.env.IMPULSE_HIDE_DOCK === '1') app.dock?.hide();
  workspace = new WorkspaceStore();
  workspace.restore();
  workspace.on('recent-changed', () => buildMenu());
  // IMPULSE_TOOLCHAIN_ISOLATED=1 ignores system installs (testing first-run setup).
  const toolchain = new Toolchain({
    managedDir: path.join(app.getPath('userData'), 'toolchain'),
    ignoreSystem: process.env.IMPULSE_TOOLCHAIN_ISOLATED === '1'
  });
  arduinoService = new ArduinoService({ cliPath: toolchain.findCli()?.path || null });
  esp32sim = new Esp32Simulator({
    runCli: (args, opts) => arduinoService.runCommand(args, opts),
    dataDir: path.join(app.getPath('userData'), 'emulators'),
    bundledDir: app.isPackaged ? bundledQemuDir() : bundledQemuDir(path.join(__dirname, '..', '..', 'build')),
  });
  arduinoService.esp32sim = esp32sim;
  serialMonitor = new SerialMonitor();
  errorMemory = new ErrorMemory();
  apiKeyManager = new APIKeyManager();
  aiAgent = new AIAgent(arduinoService, serialMonitor, errorMemory);
  aiAgent.initializeProviders();

  if (aiAgent.toolExecutor) {
    aiAgent.toolExecutor.setUICallbacks({
      getBaudRate: async () => uiState.currentBaudRate,
      setBaudRate: async (baudRate) => {
        uiState.currentBaudRate = baudRate;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ui:set-baud-rate', baudRate);
        }
      },
      getEditorCode: async () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          return new Promise((resolve) => {
            let done = false;
            const finish = (code) => { if (!done) { done = true; resolve(code ?? ''); } };
            // Use ipcMain.once (event listener) instead of handleOnce (handler)
            // to avoid deadlock when multiple AI requests run concurrently.
            ipcMain.once('ui:editor-code-response', (_event, code) => finish(code));
            mainWindow.webContents.send('ui:get-editor-code');
            setTimeout(() => finish(uiState.editorCode), 1000);
          });
        }
        return uiState.editorCode || '';
      },
      setEditorCode: async (code) => {
        uiState.editorCode = code;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ui:set-editor-code', code);
        }
      },
      getCurrentSketchPath: async () => uiState.currentSketchPath,
      saveSketch: async (filePath) => {
        const p = filePath || uiState.currentSketchPath;
        if (!p) throw new Error('No sketch is open to save.');
        const check = validatePath(p, { write: true });
        if (!check.valid) throw new Error(check.error);
        if (uiState.editorCode) await fsp.writeFile(check.resolved, uiState.editorCode, 'utf8');
        return check.resolved;
      },
      confirmUpload: async ({ sketchPath, boardFQBN, port }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Upload', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Allow upload to board?',
          message: 'The AI agent wants to upload to your board.',
          detail: `Sketch: ${path.basename(sketchPath)}\nBoard: ${boardFQBN}\nPort: ${port}\n\nAnything wired to the board (motors, relays, heaters) will run the new code.`
        });
        return response === 0;
      },
      getSelectedBoard: async () => uiState.selectedBoard,
      getSelectedPort: async () => uiState.selectedPort,
      getLastCompileResult: async () => uiState.lastCompileResult ?? null,
      setPlayground: async (content, append) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('playground:update', content, append);
        }
      }
    });
  }

  serialMonitor.on('data', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('serial:data', data);
  });
  serialMonitor.on('error', (error) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('serial:error', error?.message ?? '');
  });
  serialMonitor.on('connected', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('serial:connected');
  });
  serialMonitor.on('disconnected', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('serial:disconnected');
  });
  serialMonitor.on('reconnecting', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('serial:reconnecting', info);
  });
  serialMonitor.on('reconnected', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('serial:reconnected', info);
  });
  serialMonitor.on('reconnect-failed', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('serial:reconnect-failed', info);
  });

  createWindow();

  // Set up notification manager
  notifications.setMainWindow(mainWindow);

  // Auto-updater (check for updates 5s after launch, then every 4 hours)
  let updaterService = null;
  try {
    const AutoUpdaterService = require('./services/autoUpdater');
    updaterService = new AutoUpdaterService(mainWindow);
    setTimeout(() => updaterService.checkForUpdates(), 5000);
    setInterval(() => updaterService.checkForUpdates(), 4 * 60 * 60 * 1000);

    ipcMain.handle('updater:check', async () => updaterService.checkForUpdates());
    ipcMain.handle('updater:download', async () => updaterService.downloadUpdate());
    ipcMain.handle('updater:install', () => updaterService.quitAndInstall());
  } catch (err) {
    // Auto-updater may not work in dev mode — register safe no-op handlers
    // so the renderer doesn't crash with "No handler registered" errors.
    console.warn('Auto-updater not available:', err.message);
    ipcMain.handle('updater:check', async () => ({ available: false }));
    ipcMain.handle('updater:download', async () => ({ success: false, error: 'Updater not available' }));
    ipcMain.handle('updater:install', () => ({ success: false, error: 'Updater not available' }));
  }

  const ctx = {
    mainWindow,
    arduinoService,
    serialMonitor,
    errorMemory,
    aiAgent,
    apiKeyManager,
    uiState,
    fsp,
    path,
    dialog,
    shell,
    app,
    workspace,
    problemReporter,
    toolchain,
    esp32sim
  };
  registerAllIpc(ipcMain, ctx);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  esp32sim?.stopAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

