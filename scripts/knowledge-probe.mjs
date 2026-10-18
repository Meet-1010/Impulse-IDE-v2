// Compiles the knowledge layer's probe sketches: each one uses the APIs the
// board notes and drift tables recommend for a core, so a record whose
// advice no longer compiles shows up here. Cores that are not installed are
// skipped (pass --config-file to point arduino-cli at another data dir).
//
//   node scripts/knowledge-probe.mjs            # every installed core
//   node scripts/knowledge-probe.mjs esp32 avr  # only these probes
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probesDir = path.join(root, 'src/main/services/ai/knowledge/boards/probes');
const manifest = JSON.parse(fs.readFileSync(path.join(probesDir, 'manifest.json'), 'utf8')).probes;
const args = process.argv.slice(2);
const configIndex = args.indexOf('--config-file');
const cliArgs = configIndex >= 0 ? ['--config-file', args[configIndex + 1]] : [];
const wanted = args.filter((a, i) => !a.startsWith('--') && i !== configIndex + 1);
const cli = process.env.ARDUINO_CLI || 'arduino-cli';

const run = (a) => spawnSync(cli, [...cliArgs, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const listed = run(['core', 'list', '--format', 'json']);
if (listed.status !== 0) {
  console.error(`arduino-cli not usable: ${listed.stderr || listed.error}`);
  process.exit(2);
}
const parsed = JSON.parse(listed.stdout);
const installed = new Set((parsed.platforms || parsed || []).map((p) => p.id || p.ID || p.metadata?.id).filter(Boolean));

let failed = 0;
let ran = 0;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'impulse-probe-'));
for (const [name, probe] of Object.entries(manifest)) {
  if (wanted.length && !wanted.includes(name)) continue;
  if (!installed.has(probe.platform)) {
    console.log(`skip  ${name}: core ${probe.platform} is not installed`);
    continue;
  }
  const dir = path.join(temp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(probesDir, probe.sketch), path.join(dir, `${name}.ino`));
  const started = Date.now();
  const res = run(['compile', '--fqbn', probe.fqbn, dir]);
  ran++;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) {
    const size = /Sketch uses (\d+) bytes/.exec(res.stdout)?.[1];
    console.log(`ok    ${name} (${probe.fqbn}) ${size ? `${size} bytes` : ''} in ${secs}s`);
  } else {
    failed++;
    const errors = `${res.stdout}\n${res.stderr}`.split('\n').filter((l) => /error:|Error during build/.test(l)).slice(0, 6);
    console.log(`FAIL  ${name} (${probe.fqbn}) in ${secs}s\n      ${errors.join('\n      ')}`);
  }
}
fs.rmSync(temp, { recursive: true, force: true });
console.log(`${ran} probe${ran === 1 ? '' : 's'} compiled, ${failed} failed`);
process.exit(failed ? 1 : 0);
