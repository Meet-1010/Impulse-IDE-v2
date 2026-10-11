// Shared helper for end-to-end tests that need a real arduino-cli build.
// Tests using it are skipped when arduino-cli or the AVR core isn't installed.
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';

function findCliWithAvrCore() {
  for (const candidate of ['/opt/homebrew/bin/arduino-cli', '/usr/local/bin/arduino-cli', 'arduino-cli']) {
    try {
      const cores = execFileSync(candidate, ['core', 'list'], { stdio: 'pipe' }).toString();
      if (cores.includes('arduino:avr')) return candidate;
    } catch { /* not installed at this path */ }
  }
  return null;
}

export const CLI = findCliWithAvrCore();

// Raspberry Pi Pico and ATtiny85 tests need the Arduino-Pico core and
// ATTinyCore. IMPULSE_EXTRA_CORES_CONFIG (or the older IMPULSE_PICO_CLI_CONFIG)
// points arduino-cli at a configuration that has them, so they needn't be
// installed globally; otherwise arduino-cli's own configuration is used.
export const EXTRA_CONFIG_FILE = process.env.IMPULSE_EXTRA_CORES_CONFIG || process.env.IMPULSE_PICO_CLI_CONFIG || null;
const EXTRA_CONFIG = EXTRA_CONFIG_FILE ? ['--config-file', EXTRA_CONFIG_FILE] : [];
const isExtraCore = (fqbn) => /^(rp2040|ATTinyCore):/.test(fqbn);
const isPico = (fqbn) => fqbn.startsWith('rp2040:');

const extraCores = (() => {
  if (!CLI) return '';
  try {
    return execFileSync(CLI, [...EXTRA_CONFIG, 'core', 'list'], { stdio: 'pipe' }).toString();
  } catch {
    return '';
  }
})();

export const PICO = extraCores.includes('rp2040:rp2040');
export const ATTINY = extraCores.includes('ATTinyCore:avr');

const cache = new Map();

// Extra library folders (path-separated) for libraries that aren't installed
// globally, e.g. IMPULSE_TEST_LIBRARIES=/tmp/libs npm test.
const EXTRA_LIBS = (process.env.IMPULSE_TEST_LIBRARIES || '').split(path.delimiter).filter(Boolean);

const CACHE_DIR = path.join(os.tmpdir(), 'impulse-test-hex-cache');

/**
 * Compile `code` for `fqbn` (cached on disk by content): the application HEX
 * text for AVR chips, the UF2 bytes for the Raspberry Pi Pico.
 */
export function compileSketch(code, fqbn = 'arduino:avr:uno', name = 'sketch') {
  const key = `${fqbn}\n${EXTRA_LIBS.join(path.delimiter)}\n${code}`;
  if (cache.has(key)) return cache.get(key);
  const digest = crypto.createHash('sha1').update(key).digest('hex');
  const cached = path.join(CACHE_DIR, `${digest}.${isPico(fqbn) ? 'uf2' : 'hex'}`);
  if (fs.existsSync(cached)) {
    const program = isPico(fqbn) ? new Uint8Array(fs.readFileSync(cached)) : fs.readFileSync(cached, 'utf8');
    cache.set(key, program);
    return program;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impulse-compile-'));
  const sketchDir = path.join(dir, name);
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(sketchDir);
  fs.writeFileSync(path.join(sketchDir, `${name}.ino`), code);
  let hex;
  try {
    const libs = EXTRA_LIBS.flatMap(lib => ['--libraries', lib]);
    execFileSync(CLI, [...(isExtraCore(fqbn) ? EXTRA_CONFIG : []), 'compile', '--fqbn', fqbn, ...libs, '--output-dir', outDir, sketchDir], { stdio: 'pipe' });
    hex = isPico(fqbn)
      ? new Uint8Array(fs.readFileSync(path.join(outDir, `${name}.ino.uf2`)))
      : fs.readFileSync(path.join(outDir, `${name}.ino.hex`), 'utf8');
  } catch (err) {
    throw new Error(`Compile failed for ${fqbn}:\n${err.stderr?.toString() || err.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cached, hex);
  cache.set(key, hex);
  return hex;
}

/** Libraries installed for arduino-cli (lower-case names). */
export function installedLibraries() {
  if (!CLI) return new Set();
  try {
    const list = JSON.parse(execFileSync(CLI, ['lib', 'list', '--format', 'json'], { stdio: 'pipe' }).toString());
    const libs = list.installed_libraries || list;
    const names = new Set(libs.map(l => (l.library?.name || l.name || '').toLowerCase()));
    for (const dir of EXTRA_LIBS) {
      for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        const props = path.join(dir, entry, 'library.properties');
        const name = fs.existsSync(props) && /^name=(.+)$/m.exec(fs.readFileSync(props, 'utf8'))?.[1];
        if (name) names.add(name.trim().toLowerCase());
      }
    }
    return names;
  } catch {
    return new Set();
  }
}

export const describeWithCli = CLI ? describe : describe.skip;
export const describeWithPico = PICO ? describe : describe.skip;
export const describeWithAttiny = ATTINY ? describe : describe.skip;
