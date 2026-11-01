import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'web');
const output = path.join(root, 'dist', 'web');

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function relative(file) {
  return path.relative(source, file).split(path.sep).join('/');
}

function fail(message) {
  console.error(`[web:build] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(source, 'index.html'))) fail('web/index.html not found');

const sourceFiles = walk(source);
const required = ['index.html', 'manifest.webmanifest', 'sw.js', 'css/app.css', 'js/app.js', 'assets/icon.svg'];
for (const file of required) {
  if (!sourceFiles.some((candidate) => relative(candidate) === file)) fail(`missing required asset ${file}`);
}

const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="\/([^"#?]+)"/g)) {
  const asset = match[1];
  if (!sourceFiles.some((candidate) => relative(candidate) === asset)) fail(`index.html references missing asset ${asset}`);
}

const swSource = fs.readFileSync(path.join(source, 'sw.js'), 'utf8');
const shellMatch = swSource.match(/const SHELL = \[([\s\S]*?)\];/);
if (!shellMatch) fail('sw.js SHELL list not found');
for (const match of shellMatch[1].matchAll(/'([^']+)'/g)) {
  const asset = match[1] === '/' ? 'index.html' : match[1].replace(/^\//, '');
  if (!sourceFiles.some((candidate) => relative(candidate) === asset)) fail(`sw.js caches missing asset ${match[1]}`);
}

for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    fail(`syntax error in ${relative(file)}\n${err.stderr?.toString() || err.message}`);
  }
}

const hash = crypto.createHash('sha256');
for (const file of sourceFiles.sort((a, b) => relative(a).localeCompare(relative(b)))) {
  hash.update(relative(file));
  hash.update(fs.readFileSync(file));
}
const buildHash = hash.digest('hex');
const version = `haonline-${buildHash.slice(0, 12)}`;

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

let total = 0;
const files = [];
for (const file of sourceFiles) {
  const dest = path.join(output, relative(file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (relative(file) === 'sw.js') {
    const rewritten = swSource.replace(/const VERSION = '[^']+';/, `const VERSION = '${version}';`);
    fs.writeFileSync(dest, rewritten);
    total += Buffer.byteLength(rewritten);
  } else {
    fs.copyFileSync(file, dest);
    total += fs.statSync(file).size;
  }
  files.push(`/${relative(file)}`);
}

const manifest = {
  version,
  hash: buildHash,
  built_at: new Date().toISOString(),
  files: files.sort(),
  bytes: total,
};
fs.writeFileSync(path.join(output, 'build.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`[web:build] ${files.length} files, ${(total / 1024).toFixed(1)} KiB`);
console.log(`[web:build] version ${version}`);
console.log(`[web:build] output ${path.relative(root, output)}`);
