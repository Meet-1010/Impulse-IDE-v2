/**
 * The board knowledge layer: a catalog of the ~100 boards students and
 * industry in India use most, notes per board family (upload, power, clones,
 * libraries), per-board records (onboard parts, pins they take, how to
 * upload) and API-drift tables per core version. The installed core stays the
 * authority for pin numbers (boardKnowledge.js reads it); this layer adds what
 * the core cannot say. Only the selected board's notes go into a request.
 * Pure data and functions, no I/O.
 * @module main/services/ai/knowledge/boardRecords
 */
const { boards: CATALOG } = require('./boards/catalog.json');
const FAMILIES = require('./boards/families.json');
const RECORDS = require('./boards/records.json');
const CORES = require('./cores.json');

/** "esp32:esp32:esp32s3:CDCOnBoot=cdc" → "esp32:esp32:esp32s3" */
function baseFqbn(fqbn) {
  return String(fqbn || '').split(':').slice(0, 3).join(':');
}

/** "esp32:esp32:esp32s3" → "esp32:esp32" */
function platformOf(fqbn) {
  return String(fqbn || '').split(':').slice(0, 2).join(':');
}

/** Parse "3.3.12" / "2.0.18-arduino.5" / "1.8.8" into comparable numbers. */
function parseVersion(v) {
  const parts = String(v || '').trim().split(/[.-]/, 3);
  if (!/^\d+$/.test(parts[0] || '')) return null;
  return [0, 1, 2].map((i) => (/^\d+$/.test(parts[i] || '') ? Number(parts[i]) : 0));
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The catalog entry for a board (options stripped); several entries can share an fqbn, the best-ranked wins. */
function catalogEntry(fqbn) {
  const base = baseFqbn(fqbn);
  if (!base) return null;
  const hits = CATALOG.filter((b) => b.fqbn === base);
  if (!hits.length) return null;
  // An entry whose options match the fqbn's options (STM32 pnum, Nano cpu) is the better match.
  const options = Object.fromEntries(String(fqbn || '').split(':').slice(3).join(':').split(',').filter(Boolean).map((kv) => kv.split('=')));
  const withOptions = hits.filter((b) => Object.entries(b.options || {}).every(([k, v]) => options[k] === v));
  const pool = withOptions.length ? withOptions : hits;
  return pool.sort((a, b) => a.rank - b.rank)[0];
}

/** The family notes for a board: the catalog's family, else the family id the core gave, else by platform. */
function familyFor(fqbn, familyId = null) {
  const entry = catalogEntry(fqbn);
  const id = entry?.family || familyId || familyByPlatform(fqbn);
  return id && FAMILIES[id] ? { id, ...FAMILIES[id] } : null;
}

function familyByPlatform(fqbn) {
  const platform = platformOf(fqbn);
  const board = String(fqbn || '').split(':')[2] || '';
  if (platform === 'esp32:esp32' || platform === 'arduino:esp32') {
    if (/s3|nano_nora/i.test(board)) return 'esp32-s3';
    if (/c3/i.test(board)) return 'esp32-c3';
    if (/c6/i.test(board)) return 'esp32-c6';
    if (/s2/i.test(board)) return 'esp32-s2';
    return 'esp32';
  }
  return {
    'esp8266:esp8266': 'esp8266', 'rp2040:rp2040': 'rp2040', 'arduino:avr': 'avr-atmega328p', 'arduino:megaavr': 'megaavr-atmega4809',
    'arduino:renesas_uno': 'renesas-ra4m1', 'arduino:samd': 'samd21', 'Seeeduino:samd': 'samd21', 'arduino:mbed_nano': 'nrf52840',
    'STMicroelectronics:stm32': 'stm32', 'teensy:avr': 'teensy4', 'ATTinyCore:avr': 'attiny-x5', 'digistump:avr': 'attiny-x5',
    'megaTinyCore:megaavr': 'attiny-modern', 'Seeeduino:nrf52': 'nrf52840', 'adafruit:nrf52': 'nrf52840',
  }[platform] || null;
}

/**
 * The API-drift notes that apply to an installed core version: what this
 * version expects (the latest table at or below the version) and, when a
 * newer table exists, what code written for it will fail with here.
 * @returns {{ platform: string, name: string, version: string, current: object[], newer: object[] } | null}
 */
function driftFor(platform, version) {
  const core = CORES[platform];
  if (!core) return null;
  const sorted = [...core.versions].sort((a, b) => compareVersions(a.from, b.from));
  const v = parseVersion(version);
  const current = v ? sorted.filter((t) => compareVersions(t.from, version) <= 0) : [];
  const newer = v ? sorted.filter((t) => compareVersions(t.from, version) > 0) : [];
  return { platform, name: core.name, version: version || '', current, newer, all: sorted };
}

/**
 * The drift as text for the model: at most `max` change lines. Compact form
 * (every request) says what to write; the full form (get_board_info) adds what
 * not to write and the compile error it would give.
 */
function driftText(platform, version, { max = 6, compact = false } = {}) {
  const d = driftFor(platform, version);
  if (!d) return null;
  const lines = [];
  if (d.current.length) {
    // Newest applicable table first: it is what the installed core expects.
    const tables = [...d.current].reverse();
    lines.push(`${d.name} ${d.version || '(version unknown)'}: ${tables[0].summary}`);
    let count = 0;
    for (const t of tables) {
      for (const c of t.changes) {
        if (count >= max) break;
        if (compact && !c.new) continue;
        const parts = [`${c.what}: ${c.new}`];
        if (!compact && c.old) parts.push(`not ${c.old}`);
        if (!compact && c.error) parts.push(`(otherwise: ${c.error})`);
        lines.push(`- ${parts.join('; ')}`);
        count++;
      }
    }
  } else if (!d.version) {
    lines.push(`${d.name}, version unknown: check Board Options › core version before using version-specific APIs.`);
  }
  if (d.newer.length) {
    const next = d.newer[0];
    lines.push(`- Code written for ${d.name} ${next.from}+ does not compile here: ${next.changes.filter((c) => c.error).slice(0, 2).map((c) => c.error).join('; ')}.`);
  }
  return lines.length ? lines.join('\n') : null;
}

/**
 * Everything the layer knows about a board.
 * @param {string} fqbn
 * @param {{ familyId?: string|null, coreVersion?: string }} [opts]
 */
function boardNotes(fqbn, { familyId = null, coreVersion = '' } = {}) {
  const entry = catalogEntry(fqbn);
  const family = familyFor(fqbn, familyId);
  const record = entry ? RECORDS[entry.id] || null : null;
  const drift = driftFor(platformOf(fqbn), coreVersion);
  if (!entry && !family && !drift) return null;
  return { entry, family, record, drift };
}

const take = (list, n) => (Array.isArray(list) ? list.slice(0, n) : []);

/**
 * The [BOARD NOTES] block for a request: the board's onboard parts and pins,
 * how it uploads and is powered, clone notes, libraries, and the core's API
 * drift. Compact: the core-derived facts carry the pin numbers.
 * @returns {string|null}
 */
function notesText(fqbn, { familyId = null, coreVersion = '' } = {}) {
  const k = boardNotes(fqbn, { familyId, coreVersion });
  if (!k) return null;
  const { entry, family, record } = k;
  const lines = [];
  const name = entry?.name || (family ? family.title : baseFqbn(fqbn));
  lines.push(`[BOARD NOTES] ${name}${entry?.india ? `: ${entry.india}` : '.'}`);
  if (record?.onboard?.length) lines.push(`Onboard: ${take(record.onboard, 4).join('; ')}.`);
  if (record?.taken?.length) lines.push(`Pins taken by onboard parts (do not use): ${record.taken.join(', ')}.`);
  for (const n of take(record?.notes, 2)) lines.push(n);
  // One upload note and one power note: the record's own first, else the family's.
  const upload = record?.upload?.length ? record.upload[0] : family?.upload?.[0];
  if (upload) lines.push(`Upload: ${upload}`);
  if (family?.power?.length) lines.push(`Power: ${family.power[0]}`);
  if (family?.clones?.length && !/clone/i.test(entry?.india || '')) lines.push(`Clones: ${family.clones[0]}`);
  if (family?.libraries?.length) lines.push(`Libraries: ${family.libraries[0]}`);
  if (family?.notes?.length) lines.push(family.notes[0]);
  const drift = driftText(platformOf(fqbn), coreVersion, { max: 4, compact: true });
  if (drift) lines.push(drift);
  lines.push('get_board_info has the full notes, get_mcu_guide the chip\'s limits.');
  return lines.join('\n');
}

/**
 * Catalog boards matching a query (name, aliases, tags, fqbn, family), best
 * rank first.
 * @returns {Array<object>}
 */
function searchCatalog(query, { limit = 12 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [...CATALOG].sort((a, b) => a.rank - b.rank).slice(0, limit);
  const words = q.split(/\s+/).filter(Boolean);
  const score = (b) => {
    const hay = [b.name, b.id, b.fqbn, b.family, ...(b.aliases || []), ...(b.tags || [])].join(' ').toLowerCase();
    let s = 0;
    for (const w of words) {
      if (b.name.toLowerCase() === w || (b.aliases || []).some((a) => a.toLowerCase() === w)) s += 5;
      else if (hay.includes(w)) s += 2;
      else return 0;
    }
    return s;
  };
  return CATALOG.map((b) => ({ b, s: score(b) })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.b.rank - y.b.rank).slice(0, limit).map((x) => x.b);
}

/** The catalog in rank order, each with its family title (for the board picker). */
function popularBoards() {
  return [...CATALOG].sort((a, b) => a.rank - b.rank).map((b) => ({
    id: b.id, name: b.name, fqbn: b.fqbn, platform: b.platform, family: b.family,
    familyTitle: FAMILIES[b.family]?.title || b.family, rank: b.rank, tags: b.tags, options: b.options || {}, india: b.india, sim: !!b.sim,
  }));
}

module.exports = {
  CATALOG, FAMILIES, RECORDS, CORES,
  baseFqbn, platformOf, parseVersion, compareVersions,
  catalogEntry, familyFor, familyByPlatform, driftFor, driftText, boardNotes, notesText, searchCatalog, popularBoards,
};
