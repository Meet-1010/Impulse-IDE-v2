// End-to-end test of the main flows in the built app, plus an accessibility
// audit (axe-core) of the main screens in both themes. Runs with a throwaway
// profile and sketchbook. Requires `npm run build:renderer`; the compile and
// run steps need arduino-cli with the AVR core (they are skipped without it).
// Linux CI: run under xvfb (`xvfb-run -a node scripts/e2e.mjs`).

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

const args = [root, `--remote-debugging-port=${PORT}`, `--inspect=${INSPECT_PORT}`, `--user-data-dir=${profile}`];
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
// The example is written into a throwaway sketchbook, never the real one.
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ARDUINO_DIRECTORIES_USER: sketchbook };
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

/** Choose an application-menu item, exactly as clicking it does. */
async function menu(action) {
  const list = await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const done = new Promise(r => { ws.onmessage = r; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
    expression: `process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.send('menu:action', ${JSON.stringify(action)})`,
  } }));
  await done;
  ws.close();
}

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
  } else {
    skipped.push('compile and run an example (arduino-cli with the AVR core is not installed)');
  }

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
  fs.rmSync(temp, { recursive: true, force: true });
}

for (const p of passed) console.log(`✓ ${p}`);
for (const s of skipped) console.log(`- skipped: ${s}`);
if (problems.length) console.error(`E2E failed:\n- ${problems.join('\n- ')}`);
else console.log('E2E passed.');
process.exit(exitCode);
