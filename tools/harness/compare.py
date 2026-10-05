#!/usr/bin/env python3
"""Region colour comparison between the art target and a rendered frame.

Reports the same fixed regions for both images so the deltas are the evidence,
and adds the composition proxies the patch report requires (ridge silhouette
height above the horizon, per side of the road).

usage: python3 tools/harness/compare.py [current.png] [target.jpeg]
"""
import sys
from PIL import Image

CUR = sys.argv[1] if len(sys.argv) > 1 else '.patchwork/shots/v5-start.png'
TGT = sys.argv[2] if len(sys.argv) > 2 else '3-low-poly.jpeg'

# name -> (x0f, y0f, x1f, y1f) as fractions of the image, shared by both images
REGIONS = {
    'sky_top':        (0.30, 0.01, 0.70, 0.05),
    'sky_upper':      (0.10, 0.06, 0.40, 0.14),
    'sky_mid':        (0.10, 0.15, 0.35, 0.22),
    'sky_low_left':   (0.00, 0.09, 0.06, 0.13),
    'sky_low_right':  (0.94, 0.09, 1.00, 0.13),
    'far_ridge_left': (0.00, 0.15, 0.10, 0.18),
    'far_ridge_right':(0.90, 0.15, 1.00, 0.18),
    'hill_left_lit':  (0.02, 0.26, 0.12, 0.30),
    'hill_right_lit': (0.88, 0.26, 0.98, 0.30),
    'ground_left':    (0.02, 0.46, 0.14, 0.54),
    'ground_right':   (0.86, 0.46, 0.98, 0.54),
    'ground_near':    (0.35, 0.80, 0.65, 0.92),
    'road_mid':       (0.46, 0.56, 0.54, 0.62),
    'road_far':       (0.47, 0.46, 0.53, 0.50),
}


def hex_of(p):
    return '#%02X%02X%02X' % p


def region_mean(px, W, H, box):
    x0, y0, x1, y1 = box
    X0, Y0 = int(x0 * W), int(y0 * H)
    X1, Y1 = max(X0 + 1, int(x1 * W)), max(Y0 + 1, int(y1 * H))
    R = G = B = n = 0
    for y in range(Y0, Y1):
        for x in range(X0, X1):
            p = px[x, y]
            R += p[0]; G += p[1]; B += p[2]; n += 1
    return (round(R / n), round(G / n), round(B / n))


def ridge_height(px, W, H):
    """Angular height of the nearest ridge silhouette, per half of the frame.

    The horizon is the topmost row that is no longer sky, measured down the
    vertical centre of each half. A "ridge" is the lowest row whose colour is
    clearly darker than the sky just above it. Reported as a fraction of image
    height, which is proportional to angle for a fixed FOV.
    """
    out = {}
    for name, xf in (('left', 0.18), ('right', 0.82)):
        x = int(xf * W)
        col = [px[x, y] for y in range(H)]
        lum = [0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] for c in col]
        sky = lum[0]
        # first row from the top where luminance drops more than 25 below the
        # zenith reading: that is where ground/ridge starts
        idx = None
        for y in range(5, H):
            if lum[y] < sky - 25:
                idx = y
                break
        if idx is None:
            out[name] = None
            continue
        # then the topmost strongly-lit row at/after that: the lit ridge crest
        crest = None
        for y in range(idx, H):
            if lum[y] > lum[idx] + 8:
                crest = y
                break
        out[name] = {
            'skyline_row': idx,
            'skyline_frac': round(idx / H, 3),
            'lit_crest_row': crest,
            'lit_crest_frac': round(crest / H, 3) if crest is not None else None,
        }
    return out


def main():
    cur = Image.open(CUR).convert('RGB')
    tgt = Image.open(TGT).convert('RGB')
    print(f'current: {CUR}  {cur.size}')
    print(f'target : {TGT}  {tgt.size}')
    print()
    print(f'{"region":17s} {"target":9s} {"current":9s}  dR   dG   dB   |d|')
    print('-' * 68)
    total = 0.0
    for name, box in REGIONS.items():
        t = region_mean(tgt.load(), tgt.size[0], tgt.size[1], box)
        c = region_mean(cur.load(), cur.size[0], cur.size[1], box)
        d = tuple(int(c[i]) - int(t[i]) for i in range(3))
        mag = sum(abs(v) for v in d) / 3.0
        total += mag
        print(f'{name:17s} {hex_of(t):9s} {hex_of(c):9s} {d[0]:+4d} {d[1]:+4d} {d[2]:+4d}  {mag:5.1f}')
    print('-' * 68)
    print(f'mean per-channel absolute delta across regions: {total / len(REGIONS):.1f}')
    print()
    print('ridge silhouette (fraction of image height, 0 = top):')
    for label, img in (('target', tgt), ('current', cur)):
        r = ridge_height(img.load(), img.size[0], img.size[1])
        print(f'  {label:8s} left={r["left"]}')
        print(f'  {label:8s} right={r["right"]}')


if __name__ == '__main__':
    main()
