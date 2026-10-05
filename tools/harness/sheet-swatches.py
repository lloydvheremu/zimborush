#!/usr/bin/env python3
"""Extract colour swatches / prop colours from a reference sheet.

Finds contiguous horizontal runs of non-background colour on one row band and
reports each run's mean colour, so swatch hexes are read off the sheet rather
than eyeballed. Also supports sampling named point lists.

usage:
  python3 tools/harness/sheet-swatches.py <image> <y0> <y1> [--bg R,G,B] [--min-run N]
  python3 tools/harness/sheet-swatches.py <image> --points points.json
"""
import json
import sys
from PIL import Image


def close_to(p, bg, tol):
    return abs(p[0] - bg[0]) <= tol and abs(p[1] - bg[1]) <= tol and abs(p[2] - bg[2]) <= tol


def hexs(p):
    return '#%02X%02X%02X' % (round(p[0]), round(p[1]), round(p[2]))


def find_runs(im, y0, y1, bg, tol=18, min_run=12):
    W, H = im.size
    px = im.load()
    ymid = (y0 + y1) // 2

    def is_fg(x):
        # a column is foreground if the majority of the band is not background
        n = 0
        for y in range(y0, y1):
            if not close_to(px[x, y], bg, tol):
                n += 1
        return n > (y1 - y0) * 0.6

    runs = []
    start = None
    for x in range(W):
        fg = is_fg(x)
        if fg and start is None:
            start = x
        elif not fg and start is not None:
            if x - start >= min_run:
                runs.append((start, x))
            start = None
    if start is not None and W - start >= min_run:
        runs.append((start, W))

    out = []
    for (a, b) in runs:
        R = G = B = n = 0
        for y in range(y0, y1):
            for x in range(a, b):
                p = px[x, y]
                R += p[0]; G += p[1]; B += p[2]; n += 1
        out.append({
            'x0': a, 'x1': b, 'width': b - a, 'centreX': (a + b) // 2,
            'hex': hexs((R / n, G / n, B / n)),
        })
    return out


def sample_points(im, points):
    px = im.load()
    res = {}
    for name, spec in points.items():
        x, y = spec[0], spec[1]
        r = spec[2] if len(spec) > 2 else 4
        R = G = B = n = 0
        for yy in range(max(0, y - r), min(im.size[1], y + r + 1)):
            for xx in range(max(0, x - r), min(im.size[0], x + r + 1)):
                p = px[xx, yy]
                R += p[0]; G += p[1]; B += p[2]; n += 1
        res[name] = hexs((R / n, G / n, B / n))
    return res


def main():
    path = sys.argv[1]
    im = Image.open(path).convert('RGB')
    if '--points' in sys.argv:
        pf = sys.argv[sys.argv.index('--points') + 1]
        print(json.dumps(sample_points(im, json.load(open(pf))), indent=1))
        return
    y0, y1 = int(sys.argv[2]), int(sys.argv[3])
    tol = 18
    if '--bg' in sys.argv:
        bg = tuple(int(v) for v in sys.argv[sys.argv.index('--bg') + 1].split(','))
    else:
        # auto: background is the modal colour of the outermost columns
        px = im.load()
        counts = {}
        for y in range(0, im.size[1], 3):
            for x in list(range(0, 6)) + list(range(im.size[0] - 6, im.size[0])):
                p = px[x, y]
                counts[p] = counts.get(p, 0) + 1
        bg = max(counts, key=counts.get)
    min_run = 12
    if '--min-run' in sys.argv:
        min_run = int(sys.argv[sys.argv.index('--min-run') + 1])
    print(f'# {path}  band y={y0}..{y1}  bg={hexs(bg)}  tol={tol}')
    runs = find_runs(im, y0, y1, bg, tol, min_run)
    print(f'# {len(runs)} run(s)')
    for r in runs:
        print(f'  x {r["x0"]:4d}-{r["x1"]:4d}  w={r["width"]:4d}  centre={r["centreX"]:4d}  {r["hex"]}')


if __name__ == '__main__':
    main()
