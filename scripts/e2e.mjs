// End-to-end test of the main flows in the built app, plus an accessibility
// audit (axe-core) of the main screens in both themes. Runs with a throwaway
// profile and sketchbook. Requires `npm run build:renderer`; the compile and
// run steps need arduino-cli with the AVR core (they are skipped without it).
// Linux CI: run under xvfb (`xvfb-run -a node scripts/e2e.mjs`).

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electron = (await import('electron')).default;
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PORT = 9398;
const INSPECT_PORT = 9397;
await assertPortFree(PORT);
await assertPortFree(INSPECT_PORT);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'impulse-e2e-'));
const profile = path.join(temp, 'profile');
const sketchbook = path.join(temp, 'sketchbook');
fs.mkdirSync(sketchbook, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const problems = [];
const passed = [];
const skipped = [];

function hasAvrToolchain() {
  try {
    const out = execFileSync('arduino-cli', ['core', 'list'], { stdio: 'pipe' }).toString();
    return out.includes('arduino:avr');
  } catch {
    return false;
  }
}

/** Fail fast when a debugging port is taken: the test would drive whatever app holds it. */
async function assertPortFree(port) {
  const free = await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
  if (!free) {
    console.error(`Port ${port} is in use (another Impulse or Chrome debugging session?). Close it and run again.`);
    process.exit(2);
  }
}
const args = [root, `--remote-debugging-port=${PORT}`, `--inspect=${INSPECT_PORT}`, `--user-data-dir=${profile}`];
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
// The example is written into a throwaway sketchbook, never the real one.
// Git reads a throwaway config, so commits never use (or change) the user's own identity.
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ARDUINO_DIRECTORIES_USER: sketchbook,
  GIT_CONFIG_GLOBAL: path.join(temp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
const app = spawn(electron, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
let mainOutput = '';
app.stdout.on('data', d => { mainOutput += d; });
app.stderr.on('data', d => { mainOutput += d; });

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('App did not expose a debuggable window within 30 s');
}

/** Evaluate an expression in the main process. */
async function inMain(expression) {
  const list = await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const done = new Promise(r => { ws.onmessage = r; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }));
  await done;
  ws.close();
}

/** Choose an application-menu item, exactly as clicking it does. */
const menu = (action) => inMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.send('menu:action', ${JSON.stringify(action)})`);

/** Grant the app access to a folder, as choosing it in the open dialog does. */
const approve = (dir) => inMain(`process.mainModule.require(${JSON.stringify(path.join(root, 'src/main/utils/pathValidator.js'))}).approveDirectory(${JSON.stringify(dir)})`);

let exitCode = 1;
try {
  const ws = new WebSocket(await connect());
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluation failed');
    return r.result?.result?.value;
  };
  const waitFor = async (expression, timeoutMs, what) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const step = async (name, fn) => {
    try {
      await fn();
      passed.push(name);
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
    }
  };
  // Serious and critical axe findings fail the run. CodeMirror 5 scrolls
  // through its hidden input, so its scroller is excluded from that one rule.
  const audit = async (label) => {
    await evaluate(`if (!window.axe) { ${axeSource} }`);
    const found = await evaluate(`axe.run({ exclude: [['.CodeMirror-scroll']] }, { resultTypes: ['violations'] })
      .then(r => r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      .map(v => v.id + ' (' + v.nodes.length + '): ' + v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(', ')))`);
    if (found.length) throw new Error(`accessibility issues on ${label}: ${found.join('; ')}`);
  };

  await send('Runtime.enable');
  await waitFor(`!!document.querySelector('.app-footer .status-item') && !!window.simManager`, 30000, 'the UI');
  // A machine without the Arduino tools sees the setup dialog first.
  if (await evaluate(`!!document.querySelector('.setup-dialog')`)) await evaluate(`document.querySelector('.setup-dialog [data-act=later]').click()`);
  await sleep(1500);

  await step('main window is accessible (dark)', () => audit('the main window'));

  await step('examples gallery opens and is accessible', async () => {
    await evaluate(`window.impulse.showSimulator()`);
    await waitFor(`window.simManager.visible`, 5000, 'the simulator');
    await evaluate(`document.getElementById('simExamplesBtn').click()`);
    await waitFor(`document.querySelectorAll('.sim-gallery-card').length >= 30`, 5000, 'the examples');
    await audit('the examples gallery');
  });

  await step('part picker search works and is accessible', async () => {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await evaluate(`document.getElementById('simAddBtn').click()`);
    await evaluate(`(() => { const s = document.querySelector('.sim-picker-input'); s.value = 'servo'; s.dispatchEvent(new Event('input')); })()`);
    await waitFor(`!!document.querySelector('.sim-picker-input').getAttribute('aria-activedescendant')`, 3000, 'search results');
    await audit('the part picker');
    await evaluate(`document.querySelector('.sim-picker-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  });

  if (hasAvrToolchain()) {
    await step('an example opens, compiles, runs and reacts to its button', async () => {
      await evaluate(`document.getElementById('simExamplesBtn').click()`);
      await waitFor(`!!document.querySelector('.sim-gallery-card')`, 5000, 'the gallery');
      await evaluate(`(() => { const c = [...document.querySelectorAll('.sim-gallery-card')].find(c => /Button and LED/.test(c.textContent)); c.click(); [...document.querySelectorAll('.sim-overlay button')].find(b => /Open example/.test(b.textContent)).click(); })()`);
      await waitFor(`[...document.querySelectorAll('.tab')].some(t => /button\\.ino/.test(t.textContent))`, 15000, 'the example sketch');
      if (!fs.existsSync(path.join(sketchbook, 'Impulse Examples', 'button', 'diagram.json'))) throw new Error('the example was not written to the sketchbook');
      await evaluate(`window.impulse.showSimulator(); document.getElementById('simPlayBtn').click()`);
      await waitFor(`window.simManager.running`, 120000, 'the simulation to start');
      await sleep(500);
      await evaluate(`window.simManager.engine.behaviorOf('btn1').set(true)`);
      await waitFor(`/Pressed/.test(window.simManager.serialOut.textContent) && window.simManager.canvas.getPart('led1').el.value === true`, 5000, '"Pressed" and the LED on');
      await evaluate(`window.simManager.engine.behaviorOf('btn1').set(false)`);
      await waitFor(`/Released/.test(window.simManager.serialOut.textContent) && window.simManager.canvas.getPart('led1').el.value === false`, 5000, '"Released" and the LED off');
      await evaluate(`document.getElementById('simStopBtn').click()`);
      await evaluate(`document.querySelector('.sim-pane-tab[data-pane="checks"]').click()`);
      await waitFor(`/No wiring problems found/.test(document.getElementById('simChecksPane').textContent)`, 3000, 'a clean circuit check');
      await audit('the simulator with an example');
    });

    await step('the debugger stops at a breakpoint, steps and shows variables', async () => {
      const lineOf = async (text) => evaluate(`window.state.editor.getValue().split('\\n').findIndex(l => l.includes(${JSON.stringify(text)})) + 1`);
      const bpLine = await lineOf('wasPressed = pressed;');
      if (bpLine < 1) throw new Error('the example sketch is not in the editor');
      await evaluate(`window.impulse.breakpoints.toggle(${bpLine})`);
      await waitFor(`!!document.querySelector('.CodeMirror .bp-marker')`, 2000, 'the breakpoint marker');
      await evaluate(`window.simManager.debugStart()`);
      await waitFor(`!!window.simManager.debug && window.simManager.runner.running`, 120000, 'the debug build to start');
      await sleep(300);
      if (await evaluate(`window.simManager.debug.stopped`)) throw new Error('stopped before the button was pressed');
      await evaluate(`window.simManager.engine.behaviorOf('btn1').set(true)`);
      await waitFor(`window.simManager.debug?.stopped`, 5000, 'the breakpoint');
      const pane = () => evaluate(`document.getElementById('simDebugPane').innerText`);
      let text = await pane();
      if (!text.includes(`loop() · button.ino:${bpLine}`)) throw new Error(`stopped somewhere else: ${text.slice(0, 120)}`);
      if (!/Breakpoint/.test(text)) throw new Error('the stop reason is missing');
      const frames = await evaluate(`[...document.querySelectorAll('#simDebugPane .dbg-frame .dbg-name')].map(n => n.textContent).join(' < ')`);
      if (frames !== 'loop() < main()') throw new Error(`the call stack shows "${frames}"`);
      if (!await evaluate(`!!document.querySelector('.CodeMirror .cm-debug-current')`)) throw new Error('the current line is not highlighted');
      const row = (name) => evaluate(`(() => { const r = [...document.querySelectorAll('#simDebugPane .dbg-row')].find(r => r.querySelector('.dbg-name')?.firstChild?.textContent === ${JSON.stringify(name)}); return r ? r.querySelector('.dbg-value').textContent + (r.classList.contains('changed') ? ' (changed)' : '') : null; })()`);
      if (await row('pressed') !== 'true') throw new Error(`local "pressed" shows ${await row('pressed')}`);
      if (await row('wasPressed') !== 'false') throw new Error(`global "wasPressed" shows ${await row('wasPressed')}`);
      await audit('the debugger');
      await evaluate(`window.simManager.debugAction('stepOver')`);
      await waitFor(`window.simManager.debug?.stopped`, 5000, 'the step');
      if (await row('wasPressed') !== 'true (changed)') throw new Error(`after the step "wasPressed" shows ${await row('wasPressed')}`);
      text = await pane();
      if (!/Step/.test(text)) throw new Error('the step was not reported');
      await evaluate(`window.simManager.debugAction('continue')`);
      await sleep(200);
      if (await evaluate(`window.simManager.debug.stopped`)) throw new Error('stopped again without a change');
      await evaluate(`window.simManager.engine.behaviorOf('btn1').set(false)`);
      await waitFor(`window.simManager.debug?.stopped`, 5000, 'the breakpoint after the release');
      if (await row('pressed') !== 'false (changed)') throw new Error(`after the release "pressed" shows ${await row('pressed')}`);
      await evaluate(`window.simManager.stop()`);
      if (await evaluate(`!!document.querySelector('.CodeMirror .cm-debug-current') || !!window.simManager.debug`)) throw new Error('stopping left the debugger attached');
      await evaluate(`window.impulse.breakpoints.toggle(${bpLine})`);
    });
  } else {
    skipped.push('compile and run an example (arduino-cli with the AVR core is not installed)');
    skipped.push('debug an example (arduino-cli with the AVR core is not installed)');
  }

  await step('saving a multi-file sketch writes each tab to its own file', async () => {
    const dir = path.join(sketchbook, 'tabs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tabs.ino'), '#include "helper.h"\nvoid setup() {}\nvoid loop() {}\n');
    fs.writeFileSync(path.join(dir, 'helper.h'), 'int helper();\n');
    await approve(dir);
    const open = (file) => `window.impulse.openSketch(null, ${JSON.stringify(path.join(dir, file))})`;
    const type = (text) => `window.state.editor.replaceRange(${JSON.stringify(text)}, { line: 0, ch: 0 }, undefined, '+input')`;
    await evaluate(`(async () => { await ${open('tabs.ino')}; ${type('// sketch edit\n')}; await ${open('helper.h')}; ${type('// header edit\n')}; })()`);
    if (!await evaluate(`window.saveActiveFile()`)) throw new Error('saving failed');
    const ino = fs.readFileSync(path.join(dir, 'tabs.ino'), 'utf8');
    const header = fs.readFileSync(path.join(dir, 'helper.h'), 'utf8');
    if (ino !== '// sketch edit\n#include "helper.h"\nvoid setup() {}\nvoid loop() {}\n') throw new Error(`tabs.ino on disk: ${JSON.stringify(ino)}`);
    if (header !== '// header edit\nint helper();\n') throw new Error(`helper.h on disk: ${JSON.stringify(header)}`);
  });

  await step('source control starts a repository, commits and shows a diff', async () => {
    const dir = path.join(sketchbook, 'tabs');
    if (await evaluate(`document.getElementById('simView')?.style.display === 'flex'`)) await evaluate(`document.querySelector('.activity-icon[data-panel="simulate"]').click()`);
    await evaluate(`window.impulse.openSketch(${JSON.stringify(dir)}, ${JSON.stringify(path.join(dir, 'tabs.ino'))})`);
    await evaluate(`document.querySelector('.activity-icon[data-panel="scm"]').click()`);
    await waitFor(`/isn’t a Git repository yet/.test(document.getElementById('scmContent').textContent)`, 10000, 'the "not a repository" state');
    await audit('the Source Control panel (no repository)');
    await evaluate(`[...document.querySelectorAll('#scmContent button')].find(b => /Initialize repository/.test(b.textContent)).click()`);
    await waitFor(`[...document.querySelectorAll('#scmContent .scm-path')].map(p => p.textContent).join() === '.gitignore,helper.h,tabs.ino'`, 10000, 'the new files');
    await evaluate(`(() => { const t = document.getElementById('scmMessage'); t.value = 'First version'; t.dispatchEvent(new Event('input')); [...document.querySelectorAll('#scmContent button')].find(b => /^Commit all/.test(b.textContent)).click(); })()`);
    await waitFor(`!!document.querySelector('.impulse-dialog input[name=email]')`, 10000, 'the name and email dialog');
    await audit('the name and email dialog');
    await evaluate(`(() => { const f = document.querySelector('.impulse-dialog form'); f.name.value = 'Test Person'; f.email.value = 'test@example.com'; f.requestSubmit(); })()`);
    await waitFor(`/First version/.test(document.querySelector('#scmContent .scm-subject')?.textContent || '')`, 10000, 'the commit in the history');
    if (!/No changes since the last commit/.test(await evaluate(`document.getElementById('scmContent').textContent`))) throw new Error('changes left after committing');
    fs.appendFileSync(path.join(dir, 'tabs.ino'), '// changed outside\n');
    await evaluate(`window.dispatchEvent(new Event('focus'))`);
    await waitFor(`document.querySelector('#scmContent .scm-file.modified .scm-path')?.textContent === 'tabs.ino'`, 10000, 'the modified file');
    await audit('the Source Control panel');
    await evaluate(`document.querySelector('#scmContent .scm-file.modified').click()`);
    await waitFor(`/^\\+\\/\\/ changed outside$/m.test(document.querySelector('.diff-view')?.textContent || '')`, 10000, 'the diff');
    await audit('the diff');
    await evaluate(`document.querySelector('.diff-dialog [data-act=done]').click()`);
    await evaluate(`document.querySelector('.activity-icon[data-panel="explorer"]').click()`);
  });

  await step('the sidebar Debug panel lists breakpoints and is accessible', async () => {
    if (await evaluate(`document.getElementById('simView')?.style.display === 'flex'`)) await evaluate(`document.querySelector('.activity-icon[data-panel="simulate"]').click()`);
    await evaluate(`window.impulse.breakpoints.toggle(2)`);
    await evaluate(`document.querySelector('.activity-icon[data-panel="debug"]').click()`);
    await waitFor(`/:2$/.test(document.querySelector('#debugBreakpoints .debug-bp-open')?.textContent || '')`, 3000, 'the breakpoint in the Debug panel');
    await audit('the Debug panel');
    await evaluate(`document.querySelector('#debugBreakpoints .debug-bp-remove').click()`);
    await waitFor(`/No breakpoints/.test(document.getElementById('debugBreakpoints').textContent)`, 3000, 'the breakpoint to be removed');
    await evaluate(`document.querySelector('.activity-icon[data-panel="explorer"]').click()`);
  });

  await step('dialogs are accessible', async () => {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    for (const [action, selector, close] of [
      ['help-report-problem', '.impulse-dialog', '[data-act=cancel]'],
      ['help-about', '.impulse-dialog', '[data-act=done]'],
    ]) {
      await menu(action);
      await waitFor(`!!document.querySelector('${selector}')`, 3000, `the ${action} dialog`);
      await audit(`the ${action} dialog`);
      await evaluate(`document.querySelector('${selector} ${close}').click()`);
    }
  });

  await step('light theme is accessible', async () => {
    await evaluate(`document.getElementById('themeToggleBtn').click()`);
    await sleep(300);
    await audit('the simulator (light)');
    await evaluate(`document.getElementById('themeToggleBtn').click()`);
  });

  ws.close();
  if (/Uncaught|TypeError|ReferenceError/.test(mainOutput)) problems.push(`main process: ${mainOutput.split('\n').find(l => /Uncaught|TypeError|ReferenceError/.test(l))}`);
  exitCode = problems.length ? 1 : 0;
} catch (err) {
  problems.push(err.message);
} finally {
  app.kill();
  if (app.exitCode === null && app.signalCode === null) await Promise.race([new Promise(r => app.once('exit', r)), sleep(5000)]);
  // Windows keeps the profile locked for a moment after the app exits.
  try {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (err) {
    console.warn(`Could not remove ${temp}: ${err.message}`);
  }
}

for (const p of passed) console.log(`✓ ${p}`);
for (const s of skipped) console.log(`- skipped: ${s}`);
if (problems.length) console.error(`E2E failed:\n- ${problems.join('\n- ')}`);
else console.log('E2E passed.');
process.exit(exitCode);
