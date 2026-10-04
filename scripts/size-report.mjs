#!/usr/bin/env node
/**
 * ZimboRush — dist size report (runs after `vite build`; use `npm run size`).
 *
 * Metrics per file and in total:
 *   raw    — bytes on disk
 *   gzip   — node:zlib gzipSync, level 9
 *   brotli — node:zlib brotliCompressSync, default quality 11
 *   zip    — fflate zipSync (dev-only dependency, used exclusively by this
 *            script; it never enters the browser bundle)
 *
 * Zip semantics: the per-file "Zip (B)" column is a one-file archive of that
 * file (comparison only). The TOTAL row's zip is ONE archive of the entire
 * dist output — that is the reported zip size.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import process from 'node:process';
import { zipSync } from 'fflate';

const DIST_DIR = 'dist';

/** Recursively collect { rel, bytes } for every regular file under `dir`. */
function collectFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, base, out);
    else if (entry.isFile()) {
      out.push({ rel: relative(base, full).split(sep).join('/'), bytes: readFileSync(full) });
    }
  }
  return out;
}

const fmt = (n) => n.toLocaleString('en-US');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const files = collectFiles(DIST_DIR);
if (files.length === 0) {
  console.error(`size-report: "${DIST_DIR}/" is empty or missing — run "npm run build" first.`);
  process.exit(1);
}
files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

const rows = files.map((f) => ({
  rel: f.rel,
  raw: f.bytes.length,
  gzip: gzipSync(f.bytes, { level: 9 }).length,
  brotli: brotliCompressSync(f.bytes).length,
  zip: zipSync({ [f.rel]: f.bytes }).length,
}));

const totals = rows.reduce(
  (acc, r) => {
    acc.raw += r.raw;
    acc.gzip += r.gzip;
    acc.brotli += r.brotli;
    return acc;
  },
  { raw: 0, gzip: 0, brotli: 0 },
);

// One archive of the whole dist output — the reported zip size.
const distZip = zipSync(Object.fromEntries(files.map((f) => [f.rel, f.bytes])));

const NUM_W = 13;
const nameW = Math.max('File'.length, ...rows.map((r) => r.rel.length)) + 2;
const num = (n) => fmt(n).padStart(NUM_W);
const rule = '-'.repeat(nameW + NUM_W * 4);

console.log(`ZimboRush dist size report — ${rows.length} file(s) under ${DIST_DIR}/`);
console.log(
  `${'File'.padEnd(nameW)}${'Raw (B)'.padStart(NUM_W)}${'Gzip (B)'.padStart(NUM_W)}${'Brotli (B)'.padStart(NUM_W)}${'Zip (B)'.padStart(NUM_W)}`,
);
console.log(rule);
for (const r of rows) {
  console.log(`${r.rel.padEnd(nameW)}${num(r.raw)}${num(r.gzip)}${num(r.brotli)}${num(r.zip)}`);
}
console.log(rule);
console.log(`${'TOTAL'.padEnd(nameW)}${num(totals.raw)}${num(totals.gzip)}${num(totals.brotli)}${num(distZip.length)}`);
console.log('');
console.log(`Total raw:     ${fmt(totals.raw)} B  (${kb(totals.raw)})`);
console.log(`Total gzip:    ${fmt(totals.gzip)} B  (${kb(totals.gzip)})`);
console.log(`Total brotli:  ${fmt(totals.brotli)} B  (${kb(totals.brotli)})`);
console.log(`Zip (entire dist, one archive): ${fmt(distZip.length)} B  (${kb(distZip.length)})`);
console.log(
  'Note: the TOTAL "Zip (B)" is one archive of the whole dist output; per-file zip values are single-file archives, listed for comparison only.',
);
