import { createRng, hashSeed, hashNoise1 } from '/home/lloyd/Projects/VibeCoding/zimborush/src/core/rng.ts';

const rows = [];
function check(name, pass, detail) { rows.push({ name, pass, detail }); }

// 1. same seed -> same sequence
const a = createRng(12345), b = createRng(12345);
const sa = [], sb = [];
for (let i = 0; i < 8; i++) { sa.push(a.next()); sb.push(b.next()); }
check('same seed -> identical sequence', JSON.stringify(sa) === JSON.stringify(sb), sa.slice(0,3).map(v=>v.toFixed(6)).join(', '));

// 2. different seed -> different sequence
const c = createRng(999);
check('different seed -> different sequence', c.next() !== sa[0], '');

// 3. range/int/signed stay in bounds over many draws
const r = createRng(7);
let rangeOk = true, intOk = true, signedOk = true;
for (let i = 0; i < 20000; i++) {
  const v = r.range(-5, 5); if (!(v >= -5 && v < 5)) rangeOk = false;
  const n = r.int(3, 9);    if (!(Number.isInteger(n) && n >= 3 && n < 9)) intOk = false;
  const s = r.signed(2);    if (!(s >= -2 && s <= 2)) signedOk = false;
}
check('range() within [min,max)', rangeOk, '');
check('int() integer within [min,max)', intOk, '');
check('signed() within magnitude', signedOk, '');

// 4. distribution sanity: mean of next() ~ 0.5
const d = createRng(42); let sum = 0; const N = 100000;
for (let i = 0; i < N; i++) sum += d.next();
const mean = sum / N;
check('mean(next()) ~ 0.5', Math.abs(mean - 0.5) < 0.005, mean.toFixed(5));

// 5. hashSeed is stable and label-independent
check('hashSeed stable', hashSeed(100, 1) === hashSeed(100, 1), String(hashSeed(100, 1)));
check('hashSeed separates labels', hashSeed(100, 1) !== hashSeed(100, 2), `${hashSeed(100,1)} vs ${hashSeed(100,2)}`);

// 6. state() round-trip: two streams resuming from same state agree
const e = createRng(555); e.next(); e.next();
const saved = e.state();
const f = createRng(555); f.next(); f.next();
check('state() snapshot matches at same point', f.state() === saved, `${saved}`);
check('post-snapshot draws agree', e.next() === f.next(), '');

// 7. independent feature streams do not disturb each other
const t1 = createRng(hashSeed(2026, 1)), t2 = createRng(hashSeed(2026, 2));
const first1 = t1.next();
const fresh1 = createRng(hashSeed(2026, 1)).next();
check('feature stream independent of other draws', first1 === fresh1, '');

// 8. noise continuity: adjacent samples are close (no discontinuity)
let maxJump = 0;
for (let x = 0; x < 200; x += 0.01) {
  const jump = Math.abs(hashNoise1(x + 0.01, 3) - hashNoise1(x, 3));
  if (jump > maxJump) maxJump = jump;
}
check('hashNoise1 continuous (max step < 0.05)', maxJump < 0.05, `maxJump=${maxJump.toFixed(5)}`);

for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
const failed = rows.filter(r => !r.pass).length;
console.log(`rng seamless check: ${rows.length - failed}/${rows.length} passed`);
