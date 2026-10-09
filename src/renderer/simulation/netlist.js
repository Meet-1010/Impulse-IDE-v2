// Circuit connectivity and DC operating point.
//
// Nodes are part pins ("led1:A"). Zero-ohm links (wires, breadboard strips,
// closed switch contacts) merge nodes into nets. Resistors connect nets into
// islands; each island's node voltages come from a small nodal analysis with
// rails, outputs and sensor outputs as voltage sources. The simulator uses the
// result for digital input levels, ADC readings and short-circuit warnings.

const HIGH_THRESHOLD = 2.5;

export class Circuit {
  /**
   * @param {{ nodes?: Iterable<string>, links?: [string, string][], resistors?: [string, string, number, string?][] }} spec
   */
  constructor({ nodes = [], links = [], resistors = [] } = {}) {
    const index = new Map();
    const parent = [];
    const id = (node) => {
      let i = index.get(node);
      if (i === undefined) {
        i = parent.length;
        index.set(node, i);
        parent.push(i);
      }
      return i;
    };
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    for (const n of nodes) id(n);
    for (const [a, b] of links) {
      const ra = find(id(a));
      const rb = find(id(b));
      if (ra !== rb) parent[ra] = rb;
    }
    for (const [a, b] of resistors) { id(a); id(b); }

    // Compact net ids.
    const rootToNet = new Map();
    this.netByNode = new Map();
    this.netNodes = [];
    for (const [node, i] of index) {
      const root = find(i);
      let net = rootToNet.get(root);
      if (net === undefined) {
        net = this.netNodes.length;
        rootToNet.set(root, net);
        this.netNodes.push([]);
      }
      this.netByNode.set(node, net);
      this.netNodes[net].push(node);
    }

    this.resistors = [];
    for (const [a, b, ohms, tag] of resistors) {
      const na = this.netByNode.get(a);
      const nb = this.netByNode.get(b);
      if (na === nb || !(ohms > 0)) continue;
      this.resistors.push({ a: na, b: nb, ohms, tag: tag || `${a}~${b}` });
    }

    // Islands: nets joined through resistors.
    const ip = this.netNodes.map((_, i) => i);
    const ifind = (i) => {
      while (ip[i] !== i) { ip[i] = ip[ip[i]]; i = ip[i]; }
      return i;
    };
    for (const r of this.resistors) {
      const ra = ifind(r.a);
      const rb = ifind(r.b);
      if (ra !== rb) ip[ra] = rb;
    }
    const rootToIsland = new Map();
    this.islandOf = new Int32Array(this.netNodes.length);
    this.islandNets = [];
    this.islandResistors = [];
    for (let net = 0; net < this.netNodes.length; net++) {
      const root = ifind(net);
      let island = rootToIsland.get(root);
      if (island === undefined) {
        island = this.islandNets.length;
        rootToIsland.set(root, island);
        this.islandNets.push([]);
        this.islandResistors.push([]);
      }
      this.islandOf[net] = island;
      this.islandNets[island].push(net);
    }
    for (const r of this.resistors) this.islandResistors[this.islandOf[r.a]].push(r);
  }

  get netCount() {
    return this.netNodes.length;
  }

  /** Net id of a node, or -1 when the node isn't part of the circuit. */
  netOf(node) {
    const net = this.netByNode.get(node);
    return net === undefined ? -1 : net;
  }

  nodesOf(net) {
    return this.netNodes[net] || [];
  }

  /** True when two nodes share a net (directly connected). */
  connected(a, b) {
    const na = this.netOf(a);
    return na >= 0 && na === this.netOf(b);
  }

  /** Nets reachable through resistors from `net`, with the path resistance (nearest first). */
  resistiveNeighbors(net, maxHops = 3) {
    const out = [];
    const seen = new Map([[net, 0]]);
    let frontier = [net];
    for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
      const next = [];
      for (const n of frontier) {
        for (const r of this.islandResistors[this.islandOf[n]]) {
          if (r.a !== n && r.b !== n) continue;
          const other = r.a === n ? r.b : r.a;
          const ohms = seen.get(n) + r.ohms;
          if (seen.has(other) && seen.get(other) <= ohms) continue;
          seen.set(other, ohms);
          out.push({ net: other, ohms, hops: hop });
          next.push(other);
        }
      }
      frontier = next;
    }
    return out.sort((x, y) => x.ohms - y.ohms);
  }
}

/**
 * @typedef {{ volts: number, ohms?: number, tag?: string }} Source
 *   ohms = 0 (or missing) is an ideal source (rail, push-pull output);
 *   ohms > 0 is a source behind a resistance (pull-up, open sensor output).
 */

/**
 * DC operating point of one island.
 * @param {Circuit} circuit
 * @param {number} island
 * @param {(net: number) => Source[]} sourcesOf
 * @returns {{ volts: Map<number, number|null>, shorts: { net: number, tags: string[] }[] }}
 */
export function solveIsland(circuit, island, sourcesOf) {
  const nets = circuit.islandNets[island];
  const volts = new Map();
  const shorts = [];
  const fixed = new Map();
  const soft = new Map(); // net → [{ g, volts }]

  for (const net of nets) {
    for (const s of sourcesOf(net) || []) {
      if (!(s.ohms > 0)) {
        if (fixed.has(net)) {
          const prev = fixed.get(net);
          if (Math.abs(prev.volts - s.volts) > 0.5) {
            const existing = shorts.find(x => x.net === net);
            if (existing) existing.tags.push(s.tag || '?');
            else shorts.push({ net, tags: [prev.tag || '?', s.tag || '?'] });
            // A short pulls toward ground, like a supply in current limit.
            if (s.volts < prev.volts) fixed.set(net, s);
          }
        } else {
          fixed.set(net, s);
        }
      } else {
        if (!soft.has(net)) soft.set(net, []);
        soft.get(net).push({ g: 1 / s.ohms, volts: s.volts });
      }
    }
  }

  for (const [net, s] of fixed) volts.set(net, s.volts);
  const unknown = nets.filter(n => !fixed.has(n));
  if (!unknown.length) return { volts, shorts };

  const resistors = circuit.islandResistors[island];
  if (!resistors.length) {
    // Single floating net: only soft sources (pull-ups) can set it.
    for (const net of unknown) {
      const list = soft.get(net);
      if (!list) { volts.set(net, null); continue; }
      const g = list.reduce((a, x) => a + x.g, 0);
      volts.set(net, list.reduce((a, x) => a + x.g * x.volts, 0) / g);
    }
    return { volts, shorts };
  }

  // Nets that can't reach any source float.
  const adj = new Map(unknown.map(n => [n, []]));
  for (const r of resistors) {
    if (adj.has(r.a)) adj.get(r.a).push(r.b);
    if (adj.has(r.b)) adj.get(r.b).push(r.a);
  }
  const anchored = new Set();
  const queue = unknown.filter(n => soft.has(n) || adj.get(n).some(m => fixed.has(m)));
  queue.forEach(n => anchored.add(n));
  while (queue.length) {
    const n = queue.pop();
    for (const m of adj.get(n)) {
      if (adj.has(m) && !anchored.has(m)) { anchored.add(m); queue.push(m); }
    }
  }
  const solveNets = unknown.filter(n => anchored.has(n));
  for (const n of unknown) if (!anchored.has(n)) volts.set(n, null);
  if (!solveNets.length) return { volts, shorts };

  const row = new Map(solveNets.map((n, i) => [n, i]));
  const N = solveNets.length;
  const G = Array.from({ length: N }, () => new Float64Array(N + 1)); // augmented
  for (const r of resistors) {
    const g = 1 / r.ohms;
    const ia = row.get(r.a);
    const ib = row.get(r.b);
    if (ia !== undefined) {
      G[ia][ia] += g;
      if (ib !== undefined) G[ia][ib] -= g;
      else if (fixed.has(r.b)) G[ia][N] += g * fixed.get(r.b).volts;
    }
    if (ib !== undefined) {
      G[ib][ib] += g;
      if (ia !== undefined) G[ib][ia] -= g;
      else if (fixed.has(r.a)) G[ib][N] += g * fixed.get(r.a).volts;
    }
  }
  for (const [net, list] of soft) {
    const i = row.get(net);
    if (i === undefined) continue;
    for (const s of list) {
      G[i][i] += s.g;
      G[i][N] += s.g * s.volts;
    }
  }

  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(G[r][c]) > Math.abs(G[p][c])) p = r;
    if (Math.abs(G[p][c]) < 1e-15) continue;
    if (p !== c) [G[p], G[c]] = [G[c], G[p]];
    for (let r = 0; r < N; r++) {
      if (r === c) continue;
      const f = G[r][c] / G[c][c];
      if (!f) continue;
      for (let k = c; k <= N; k++) G[r][k] -= f * G[c][k];
    }
  }
  for (let i = 0; i < N; i++) {
    const d = G[i][i];
    volts.set(solveNets[i], Math.abs(d) < 1e-15 ? null : G[i][N] / d);
  }
  return { volts, shorts };
}

/** Logic level for a voltage (null = floating). */
export function logicLevel(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return v >= HIGH_THRESHOLD ? 1 : 0;
}
