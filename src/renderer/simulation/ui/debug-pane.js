// The simulator's Debug tab: where the program is stopped, its locals,
// globals and registers, and the breakpoints. Values that changed since the
// last stop are highlighted; expanded rows stay expanded between stops.

import { h, icon, mod } from './dom.js';

const baseName = (p) => String(p || '').split(/[/\\]/).pop();

export class DebugPane {
  /**
   * @param {HTMLElement} el
   * @param {{ onOpenLocation: (file: string, line: number) => void,
   *   onRemoveBreakpoint: (file: string, line: number) => void }} actions
   */
  constructor(el, actions) {
    this.el = el;
    this.actions = actions;
    this.expanded = new Set(['locals', 'globals', 'breakpoints']);
    this.previous = new Map();
    this.idle([]);
  }

  /** Not debugging. */
  idle(breakpoints) {
    this.previous.clear();
    this.el.replaceChildren(
      h('div', { class: 'dbg-empty' },
        h('p', {}, 'Click left of a line number to set a breakpoint, then press ', h('strong', {}, 'Debug'), ' (F5). The simulation stops there, and you can step through the sketch line by line and see its variables.'),
        h('p', { class: 'dbg-hint' }, `F10 step over · F11 step into · ⇧F11 step out · F5 continue · ⇧F5 stop · ${mod}F10 run to cursor`)),
      this._breakpoints(breakpoints));
  }

  /** Compiling or running between stops. */
  running(text, breakpoints) {
    this.el.replaceChildren(h('div', { class: 'dbg-status running', role: 'status' }, h('span', { class: 'sim-live-dot' }), text), this._breakpoints(breakpoints));
  }

  /**
   * @param {{ reason: string, location: object, locals: object[], globals: object[], registers: object, breakpoints: object[] }} s
   */
  stopped(s) {
    const { location } = s;
    const why = { breakpoint: 'Breakpoint', step: 'Step', pause: 'Paused', cursor: 'Run to cursor' }[s.reason] || 'Paused';
    const where = location.inSketch
      ? h('button', { type: 'button', class: 'dbg-loc', title: 'Show this line', onclick: () => this.actions.onOpenLocation(location.file, location.line) },
        `${location.function ? `${location.function}()` : ''} · ${baseName(location.file)}:${location.line}`)
      : h('span', { class: 'dbg-loc outside' }, `${location.function ? `${location.function}()` : `0x${location.pc.toString(16)}`} — Arduino core code (no sketch source). Step Out or Continue to get back to the sketch.`);
    const status = h('div', { class: 'dbg-status', role: 'status' }, h('span', { class: `dbg-reason ${s.reason}` }, why), where);

    const seen = new Map();
    const sections = [
      this._section('locals', ['Locals', location.function ? h('span', { class: 'dbg-fn' }, ` · ${location.function}()`) : null], s.locals, 'locals', seen, 'No locals here.'),
      this._section('globals', 'Globals', s.globals, 'globals', seen, 'This sketch has no global variables.'),
      this._registers(s.registers),
      this._breakpoints(s.breakpoints),
    ];
    this.previous = seen;
    this.el.replaceChildren(status, ...sections);
  }

  _details(key, title, ...body) {
    const d = h('details', { class: 'dbg-section', open: this.expanded.has(key) }, h('summary', {}, ...[title].flat()), ...body);
    d.addEventListener('toggle', () => (d.open ? this.expanded.add(key) : this.expanded.delete(key)));
    return d;
  }

  _section(key, title, vars, path, seen, emptyText) {
    const body = vars.length
      ? h('div', { class: 'dbg-vars', role: 'list' }, ...vars.map(v => this._var(v, `${path}.${v.name}`, seen)))
      : h('p', { class: 'dbg-none' }, emptyText);
    return this._details(key, title, body);
  }

  _var(v, path, seen) {
    seen.set(path, v.value);
    const changed = this.previous.has(path) && this.previous.get(path) !== v.value;
    const row = (tag, ...extra) => h(tag, { class: `dbg-row${changed ? ' changed' : ''}${v.unavailable ? ' unavailable' : ''}` },
      h('span', { class: 'dbg-name' }, v.name, v.param ? h('span', { class: 'dbg-param', title: 'Parameter' }, ' (param)') : null),
      h('span', { class: 'dbg-value mono', title: v.value }, v.value),
      h('span', { class: 'dbg-type mono' }, v.type || ''),
      ...extra);
    if (!v.children?.length) return h('div', { class: 'dbg-var', role: 'listitem' }, row('div'));
    const d = h('details', { open: this.expanded.has(path) },
      row('summary'),
      h('div', { class: 'dbg-children', role: 'list' }, ...v.children.map(c => this._var(c, `${path}.${c.name}`, seen))));
    d.addEventListener('toggle', () => (d.open ? this.expanded.add(path) : this.expanded.delete(path)));
    return h('div', { class: 'dbg-var', role: 'listitem' }, d);
  }

  _registers(r) {
    const hex = (n, w = 2) => n.toString(16).padStart(w, '0');
    const grid = h('div', { class: 'dbg-regs mono' }, ...r.r.map((v, i) => h('span', { class: 'dbg-reg', title: `r${i} = ${v}` }, h('span', { class: 'dbg-reg-name' }, `r${i}`), hex(v))));
    const line = (label, value, title) => h('div', { class: 'dbg-reg-line' }, h('span', { class: 'dbg-name' }, label), h('span', { class: 'dbg-value mono', title }, value));
    return this._details('registers', 'Registers', grid,
      line('SREG', `0x${hex(r.sreg)}  ${r.flags}`, 'Status flags: capital letters are set (I interrupts, T, H half carry, S sign, V overflow, N negative, Z zero, C carry)'),
      line('SP', `0x${hex(r.sp, 4)}`),
      line('PC', `0x${hex(r.pc, 4)}`),
      line('Time', `${(r.cycles / 16e6).toFixed(6)} s (${r.cycles.toLocaleString()} cycles)`));
  }

  _breakpoints(list) {
    const items = list.length
      ? h('div', { class: 'dbg-vars', role: 'list' }, ...list.map(bp => h('div', { class: `dbg-bp${bp.unverified ? ' unverified' : ''}`, role: 'listitem' },
        h('span', { class: 'bp-marker', 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'dbg-bp-loc', onclick: () => this.actions.onOpenLocation(bp.file, bp.line) }, `${baseName(bp.file)}:${bp.line}`),
        bp.unverified ? h('span', { class: 'dbg-type' }, 'no code here') : null,
        h('button', { type: 'button', class: 'sim-icon-btn', title: 'Remove breakpoint', 'aria-label': `Remove breakpoint at ${baseName(bp.file)} line ${bp.line}`, onclick: () => this.actions.onRemoveBreakpoint(bp.file, bp.line) }, icon('close', 12)))))
      : h('p', { class: 'dbg-none' }, 'No breakpoints.');
    return this._details('breakpoints', `Breakpoints${list.length ? ` (${list.length})` : ''}`, items);
  }
}
