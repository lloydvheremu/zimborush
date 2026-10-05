#!/usr/bin/env python3
"""Run the terrain-mesh vs heightAt deviation check across several seeds.

Q0 requires this on seeds 1, 7, 42, 1234 and 2026, because 0.0461 m was only
ever proven for 2026. Each seed needs its own page load, so this drives the
existing cdp-eval harness once per seed and parses its JSON.

The check itself: every drawn terrain triangle's own plane is exact at its three
corners by construction, so the deviation from the analytic field shows up inside
the triangle. Evaluate the triangle's centroid height against `heightAt` there.

usage: python3 tools/harness/deviation-seeds.py [baseUrl] [seeds...]
"""
import json
import subprocess
import sys

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5219'
SEEDS = [int(s) for s in sys.argv[2:]] or [1, 7, 42, 1234, 2026]

EXPR = r"""
(() => {
  const Z = window.__zimbo;
  if (!Z) return JSON.stringify({ err: 'no __zimbo (need ?debug=1)' });
  const t = Z.terrain;
  let mesh = null;
  Z.graph.root.traverse((o) => { if (o.isMesh && String(o.name).startsWith('terrain')) mesh = o; });
  if (!mesh) return JSON.stringify({ err: 'no terrain mesh' });
  const pos = mesh.geometry.getAttribute('position');
  let maxErr = 0, maxAt = null, sum = 0, n = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const mx = (pos.getX(i) + pos.getX(i+1) + pos.getX(i+2)) / 3;
    const my = (pos.getY(i) + pos.getY(i+1) + pos.getY(i+2)) / 3;
    const mz = (pos.getZ(i) + pos.getZ(i+1) + pos.getZ(i+2)) / 3;
    const e = Math.abs(my - t.heightAt(mx, mz));
    sum += e; n++;
    if (e > maxErr) { maxErr = e; maxAt = [+mx.toFixed(1), +mz.toFixed(1)]; }
  }
  let minH = Infinity, maxH = -Infinity;
  for (let x = -192; x <= 192; x += 4) for (let z = -192; z <= 192; z += 4) {
    const h = t.heightAt(x, z); if (h < minH) minH = h; if (h > maxH) maxH = h;
  }
  let ringFoot = t.heightAt(192.0001, 0);
  let edge = t.heightAt(191.9999, 0);
  return JSON.stringify({
    triangles: pos.count / 3,
    maxM: +maxErr.toFixed(4), meanM: +(sum/n).toFixed(4), maxAt,
    reliefM: +(maxH - minH).toFixed(2),
    ringFootHeightM: +ringFoot.toFixed(6),
    terrainAtEdgeM: +edge.toFixed(6),
  });
})()
"""

open('/tmp/dev-expr.js', 'w').write(EXPR)

print(f'{"seed":>6}  {"max (tol 0.05)":>15}  {"mean (tol 0.02)":>16}  '
      f'{"max at":>16}  {"relief m":>9}  {"at edge":>9}  result')
print('-' * 92)
allpass = True
rows = []
for seed in SEEDS:
    url = f'{BASE}/?view=start&debug=1&play=0&seed={seed}'
    out = subprocess.run(
        ['node', 'tools/harness/cdp-eval.mjs', url, '11000', '/tmp/dev-expr.js'],
        capture_output=True, text=True, timeout=240,
    ).stdout.strip()
    try:
        d = json.loads(out)
    except Exception as exc:  # noqa: BLE001
        print(f'{seed:>6}  parse failure: {exc}: {out[:200]}')
        allpass = False
        continue
    if 'err' in d:
        print(f'{seed:>6}  {d["err"]}')
        allpass = False
        continue
    ok = d['maxM'] <= 0.05 and d['meanM'] <= 0.02
    allpass = allpass and ok
    rows.append((seed, d))
    print(f'{seed:>6}  {d["maxM"]:>15.4f}  {d["meanM"]:>16.4f}  '
          f'{str(d["maxAt"]):>16}  {d["reliefM"]:>9.2f}  '
          f'{d["terrainAtEdgeM"]:>9.5f}  {"PASS" if ok else "FAIL"}')
print('-' * 92)
print('all seeds within tolerance' if allpass else 'AT LEAST ONE SEED OUT OF TOLERANCE')
ns = sorted(set(d['maxM'] for _, d in rows))
print(f'worst max across seeds: {max(ns) if ns else "n/a"} m (tolerance 0.05 m, not loosened)')
