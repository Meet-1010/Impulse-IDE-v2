// The side panel in chat mode: the simulator (the same live circuit as the
// IDE's, moved in while shown), the serial monitor, and the code (a second
// editor on the same document as the IDE's, so edits show in both).

import { h, icon, led } from './dom.js';
import { ICON } from './icons.js';

const WIDTH_KEY = 'impulse-vibe-bench-width';
const BAUDS = [9600, 19200, 38400, 57600, 74880, 115200, 230400];
const MAX_LINES = 3000;

/**
 * @param {{ host: HTMLElement, impulse: object, onChange?: (tab: string | null) => void }} deps
 */
export function createBench({ host, impulse, onChange }) {
  let tab = null;
  let codeEditor = null;

  const tabButton = (id, label, svg) => h('button', {
    type: 'button', class: 'v-tab', role: 'tab', id: `vTab-${id}`, 'aria-controls': `vPane-${id}`, 'aria-selected': 'false',
    onclick: () => open(id),
  }, icon(svg), label);
  const tabs = { sim: tabButton('sim', 'Simulator', ICON.sim), serial: tabButton('serial', 'Serial', ICON.terminal), code: tabButton('code', 'Code', ICON.code) };

  // ── Serial ─────────────────────────────────────────────────────────────
  const serialLed = led(null);
  const serialText = h('span', { text: 'Not connected' });
  const baud = h('select', { class: 'v-select', 'aria-label': 'Baud rate' }, BAUDS.map((b) => h('option', { value: String(b), text: String(b) })));
  const connectBtn = h('button', { type: 'button', class: 'v-btn', text: 'Connect' });
  const clearBtn = h('button', { type: 'button', class: 'v-icon-btn', 'aria-label': 'Clear the output', title: 'Clear the output', html: ICON.trash });
  const out = h('div', { class: 'v-serial-out', role: 'log', 'aria-live': 'polite', tabindex: '0', 'aria-label': 'Serial output' });
  const empty = h('div', { class: 'v-serial-empty', text: 'Connect a board to see what it prints. Lines from the simulator show here too while it runs.' });
  const sendInput = h('input', { type: 'text', placeholder: 'Send to the board…', 'aria-label': 'Send to the board', spellcheck: 'false' });
  const sendForm = h('form', { class: 'v-serial-send' }, sendInput, h('button', { type: 'submit', class: 'v-btn', text: 'Send' }));
  let atBottom = true;
  out.addEventListener('scroll', () => { atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 24; });

  function line(text, kind = 'rx', source = '') {
    empty.hidden = true;
    const time = new Date().toLocaleTimeString(undefined, { hour12: false });
    const row = h('div', { class: kind }, h('span', { class: 't', text: source ? `${time} ${source}` : time }), text);
    out.append(row);
    while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
    if (atBottom) out.scrollTop = out.scrollHeight;
  }

  function syncSerial() {
    const s = impulse.serial.state();
    serialLed.dataset.state = s.connected ? 'green' : '';
    serialText.textContent = s.connected ? `${s.port} · ${s.baud}` : s.port ? `Ready: ${s.port}` : 'No board port selected';
    connectBtn.textContent = s.connected ? 'Disconnect' : 'Connect';
    connectBtn.disabled = !s.connected && !s.port;
    baud.value = String(s.baud);
    sendInput.disabled = !s.connected;
  }

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    const s = impulse.serial.state();
    if (s.connected) await impulse.serial.disconnect();
    else await impulse.serial.connect();
    syncSerial();
  });
  baud.addEventListener('change', () => impulse.serial.setBaud(Number(baud.value)));
  clearBtn.addEventListener('click', () => {
    out.replaceChildren();
    empty.hidden = false;
  });
  sendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = sendInput.value;
    if (!text) return;
    if (await impulse.serial.send(text)) sendInput.value = '';
  });
  impulse.serial.onLine(({ text, type, source }) => line(text, { sent: 'tx', info: 'info', error: 'err' }[type] || 'rx', source));
  impulse.serial.onState(syncSerial);

  const serialPane = h('div', { class: 'v-pane', id: 'vPane-serial', role: 'tabpanel', 'aria-labelledby': 'vTab-serial', hidden: true },
    h('div', { class: 'v-serial-bar' }, h('span', { class: 'v-serial-status' }, serialLed, serialText), baud, connectBtn, clearBtn),
    h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column' }, empty, out),
    sendForm);

  // ── Simulator ──────────────────────────────────────────────────────────
  const simPane = h('div', { class: 'v-pane v-pane-sim', id: 'vPane-sim', role: 'tabpanel', 'aria-labelledby': 'vTab-sim', hidden: true });

  // ── Code ───────────────────────────────────────────────────────────────
  const codeName = h('span', { text: '' });
  const codeSlot = h('div', { class: 'v-code-slot' });
  const codeEmpty = h('div', { class: 'v-code-empty', text: 'No code yet. Ask Impulse to build something and the sketch shows up here.' });
  const openInIde = h('button', { type: 'button', class: 'v-btn ghost', text: 'Open in IDE', onclick: () => impulse.shell.setMode('ide') });
  const codePane = h('div', { class: 'v-pane', id: 'vPane-code', role: 'tabpanel', 'aria-labelledby': 'vTab-code', hidden: true },
    h('div', { class: 'v-code-head' }, icon(ICON.file), codeName, openInIde), codeEmpty, codeSlot);

  function syncCode() {
    const file = impulse.editor.currentFile();
    codeName.textContent = file ? file.split(/[/\\]/).pop() : '';
    codeEmpty.hidden = !!file;
    codeSlot.hidden = !file;
    openInIde.hidden = !file;
    if (file && !codeEditor) codeEditor = impulse.editor.createLinked(codeSlot);
    if (codeEditor) requestAnimationFrame(() => codeEditor.refresh());
  }

  // ── Frame ──────────────────────────────────────────────────────────────
  const close = h('button', { type: 'button', class: 'v-icon-btn', 'aria-label': 'Close the panel', title: 'Close', html: ICON.close, onclick: () => hide() });
  const resize = h('div', { class: 'v-bench-resize', 'aria-hidden': 'true' });
  const el = h('aside', { class: 'v-bench', hidden: true, 'aria-label': 'Workbench' },
    resize,
    h('div', { class: 'v-bench-head' }, h('div', { class: 'v-tabs', role: 'tablist', 'aria-label': 'Workbench' }, tabs.sim, tabs.serial, tabs.code), close),
    h('div', { class: 'v-bench-body' }, simPane, serialPane, codePane));
  host.append(el);

  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (saved >= 360) el.style.width = `${saved}px`;
  } catch { /* no storage */ }
  resize.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resize.setPointerCapture(e.pointerId);
    resize.dataset.dragging = '';
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    const move = (ev) => {
      // The chat column keeps at least 420px.
      const mainLeft = host.querySelector('.v-main')?.getBoundingClientRect().left || 0;
      const max = Math.min(window.innerWidth * 0.7, window.innerWidth - mainLeft - 420);
      el.style.width = `${Math.round(Math.max(360, Math.min(max, startW + (startX - ev.clientX))))}px`;
    };
    const up = () => {
      delete resize.dataset.dragging;
      resize.removeEventListener('pointermove', move);
      resize.removeEventListener('pointerup', up);
      try { localStorage.setItem(WIDTH_KEY, String(Math.round(el.getBoundingClientRect().width))); } catch { /* no storage */ }
      if (tab === 'sim') impulse.sim.fit();
      codeEditor?.refresh();
    };
    resize.addEventListener('pointermove', move);
    resize.addEventListener('pointerup', up);
  });

  function open(id) {
    if (!['sim', 'serial', 'code'].includes(id)) return;
    el.hidden = false;
    tab = id;
    for (const [key, button] of Object.entries(tabs)) button.setAttribute('aria-selected', String(key === id));
    simPane.hidden = id !== 'sim';
    serialPane.hidden = id !== 'serial';
    codePane.hidden = id !== 'code';
    if (id === 'sim') impulse.sim.mountInto(simPane);
    if (id === 'serial') {
      syncSerial();
      requestAnimationFrame(() => { out.scrollTop = out.scrollHeight; });
    }
    if (id === 'code') syncCode();
    onChange?.(tab);
  }

  function hide() {
    el.hidden = true;
    tab = null;
    impulse.sim.restore();
    onChange?.(null);
  }

  return {
    el,
    get tab() { return tab; },
    open,
    hide,
    toggle(id) {
      if (tab === id) hide();
      else open(id);
    },
    /** The sketch changed (a new project, another file). */
    refreshCode() {
      if (tab === 'code') syncCode();
    },
    /** Leaving chat mode: hand the simulator back to the IDE. */
    release() {
      impulse.sim.restore();
    },
    /** Back in chat mode. */
    reclaim() {
      if (tab === 'sim') impulse.sim.mountInto(simPane);
      if (tab === 'code') syncCode();
    },
  };
}
