#!/usr/bin/env node
// Build Impulse for this Mac and install it in /Applications, replacing the
// copy there (which goes to the Trash, so it can be put back).
//
//   npm run install:mac
//
// The app is built for this Mac's architecture and signed ad hoc by
// build/afterPack.cjs, then checked with codesign before it replaces anything.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('install:mac installs into /Applications on macOS. On Windows and Linux, run the installer from npm run build:win or build:linux.');
  process.exit(1);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appName = `${pkg.build.productName || pkg.productName || 'Impulse IDE'}.app`;
const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
const quiet = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

console.log(`Building ${appName} ${pkg.version} for ${arch}…`);
run('npm', ['run', 'build:renderer']);
run('npx', ['electron-builder', '--mac', 'dir', `--${arch}`], { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });

const built = path.join(root, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', appName);
if (!fs.existsSync(built)) throw new Error(`The build didn't produce ${built}`);
run('codesign', ['--verify', '--deep', '--strict', built]);

const target = path.join('/Applications', appName);
// Quit a running copy first; it asks about unsaved work itself.
try {
  if (quiet('pgrep', ['-f', `${target}/Contents/MacOS/`]).trim()) {
    console.log('Quitting the running copy…');
    quiet('osascript', ['-e', `tell application "${target}" to quit`]);
    for (let i = 0; i < 40 && quiet('pgrep', ['-f', `${target}/Contents/MacOS/`]).trim(); i++) execFileSync('sleep', ['0.5']);
  }
} catch { /* pgrep exits 1 when nothing runs */ }

if (fs.existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const trashed = path.join(os.homedir(), '.Trash', `${appName.replace(/\.app$/, '')} ${stamp}.app`);
  fs.renameSync(target, trashed);
  console.log(`Moved the old copy to the Trash: ${path.basename(trashed)}`);
}
run('ditto', [built, target]);
run('codesign', ['--verify', '--deep', '--strict', target]);
const version = quiet('defaults', ['read', path.join(target, 'Contents', 'Info.plist'), 'CFBundleShortVersionString']).trim();
console.log(`Installed ${appName} ${version} (${arch}) in /Applications.`);
if (!process.argv.includes('--no-open')) run('open', [target]);
