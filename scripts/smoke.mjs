// Smoke test: launch the built app, open every panel, and fail on any
// uncaught exception or console error. Requires `npm run build:renderer`.
// Linux CI: run under xvfb (`xvfb-run -a node scripts/smoke.mjs`).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9399;
await assertPortFree(PORT);
const electron = (await import('electron')).default;
// A throwaway profile: the simulator steps add parts, which must not touch real sketches.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'impulse-smoke-'));

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
const args = [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`];
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
const app = spawn(electron, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
let mainOutput = '';
app.stdout.on('data', d => { mainOutput += d; });
app.stderr.on('data', d => { mainOutput += d; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = [];

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

let exitCode = 1;
try {
  const ws = new WebSocket(await connect());
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push(`console.error: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
    }
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send('Runtime.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(5000);

  const ready = await evaluate(`!!document.querySelector('.app-footer .status-item') && !!document.getElementById('aiMessages')`);
  if (!ready) problems.push('UI did not finish initialising (status bar / AI panel missing)');

  const steps = [
    ...['explorer', 'boards', 'libraries', 'debug', 'search', 'serial', 'simulate', 'explorer']
      .map(p => `document.querySelector('.activity-icon[data-panel="${p}"]')?.click()`),
    ...['console', 'serial', 'plotter', 'problems', 'tests', 'playground', 'console']
      .map(t => `document.querySelector('.output-tab[data-tab="${t}"]')?.click()`),
    `document.getElementById('aiAgentTab').click()`,
    `document.querySelector('.ai-starter')?.click()`,
    `document.getElementById('aiAgentTab').click()`,
    `document.getElementById('themeToggleBtn').click()`,
    `document.getElementById('themeToggleBtn').click()`,
    `document.getElementById('boardPortDropdown').click()`,
    `document.body.click()`,
  ];
  for (const step of steps) {
    await evaluate(step);
    await sleep(250);
  }

  // Simulator: part picker, examples gallery, inspector, board switching,
  // undo/redo and the bottom pane tabs.
  const sim = 'window.simManager';
  const simSteps = [
    [`window.impulse.showSimulator(); ${sim}.visible`, true],
    [`document.getElementById('simAddBtn').click(); !document.querySelector('.sim-picker').hidden`, true],
    [`(() => { const s = document.querySelector('.sim-picker-input'); s.value = 'oled'; s.dispatchEvent(new Event('input')); return document.querySelectorAll('.sim-picker-results .sim-tile').length > 0; })()`, true],
    [`document.querySelector('.sim-picker-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); ${sim}.canvas.parts.some(p => p.type === 'wokwi-ssd1306')`, true],
    [`document.getElementById('simAddBtn').click(); (() => { const s = document.querySelector('.sim-picker-input'); s.value = 'flux capacitor'; s.dispatchEvent(new Event('input')); return !!document.querySelector('.sim-picker-empty'); })()`, true],
    [`document.querySelector('.sim-picker-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('.sim-picker').hidden`, true],
    [`(() => { const p = ${sim}.canvas.parts.find(q => q.type === 'wokwi-ssd1306'); ${sim}.canvas.select([p]); return !document.querySelector('.sim-inspector').hidden; })()`, true],
    [`${sim}.setBoard('mega'); ${sim}.board.id`, 'mega'],
    [`${sim}.setBoard('nano'); ${sim}.board.id`, 'nano'],
    [`${sim}.setBoard('uno'); ${sim}.board.id`, 'uno'],
    [`document.getElementById('simExamplesBtn').click(); document.querySelectorAll('.sim-gallery-card').length >= 30`, true],
    [`document.querySelectorAll('.sim-gallery-cat')[2]?.click(); document.querySelectorAll('.sim-gallery-card').length > 0`, true],
    [`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); !document.querySelector('.sim-overlay')`, true],
    ...['logic', 'checks', 'serial'].map(t => [`document.querySelector('.sim-pane-tab[data-pane="${t}"]').click(); true`, true]),
    [`document.getElementById('simUndoBtn').click(); document.getElementById('simRedoBtn').click(); true`, true],
  ];
  for (const [step, expected] of simSteps) {
    const got = await evaluate(step);
    if (got !== expected) problems.push(`simulator step returned ${JSON.stringify(got)} (expected ${JSON.stringify(expected)}): ${step.slice(0, 120)}`);
    await sleep(350);
  }
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
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (err) {
    console.warn(`Could not remove ${profile}: ${err.message}`);
  }
}

if (problems.length) {
  console.error(`Smoke test failed:\n- ${problems.join('\n- ')}`);
} else {
  console.log('Smoke test passed: every panel and the simulator opened without errors.');
}
process.exit(exitCode);
