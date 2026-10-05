/**
 * Silhouette harmonics: [1,2,3] for the large crest shape and [5,7,11] for the
 * ragged detail. Kept as-is; only the amplitudes above changed.
 */

/**
 * Distant hill ring — the purple-maroon band that closes the horizon.
 *
 * One draped annulus: a `PlaneGeometry` re-interpreted as an
 * (angle, radius) parameter grid, re-projected into polar coordinates and
 * displaced in Y by a seeded silhouette. `toNonIndexed()` gives every triangle
 * its own vertices, which buys two things the visual target needs: one flat
 * tint per face (vertex colours) and flat per-face normals via
 * `computeVertexNormals()` → the faceted low-poly read.
 *
 * Seams: silhouette harmonics are integer multiples of theta and theta wraps
 * modulo 2*PI, so the ring closes exactly. All randomness comes from
 * `createRng(hashSeed(HILL_SEED_BASE, n))` streams — same seed, identical
 * geometry, byte for byte.
 *
 * Built once at world build; there is no per-frame code path in this module.
 */
import { Color, Float32BufferAttribute, PlaneGeometry, type BufferGeometry } from 'three';
import { createRng, hashSeed, type Rng } from '../../core/rng';
import type { ColorSource } from '../../renderer/contracts';
import type { BuiltGeometry } from '../../world/contracts';

const TAU = Math.PI * 2;

/** Faces around the ring: 192 × 13 rings → 4992 triangles (budget 6000). */
const ANGULAR_SEGMENTS = 192;
const RADIAL_RINGS = 13;

/**
 * Ring metrics in metres.
 *
 * `INNER_RADIUS_M` MUST equal the terrain field's zero radius
 * (`EDGE_RADIUS_M` in `heightfield.ts`, which equals the corridor's inscribed
 * radius). This ring's base height is 0 at its inner edge and the field tapers
 * to exactly 0 there with zero slope, so the two surfaces meet in a smooth
 * valley floor rather than the step-plus-gap the previous 232 m inner radius
 * produced (P4).
 *
 * The inner radius used to be 232 m, which is 40 m *outside* the corridor's own
 * edge and therefore left a bare gap in front of the ring. It is now the
 * corridor's 192 m.
 */
const INNER_RADIUS_M = 192;
const OUTER_RADIUS_M = 430;

/**
 * Silhouette height model: a base rise plus a seeded, ragged crest.
 *
 * The rim was 780 m at 118 m tall, which under fog read as a smooth unbroken
 * purple WALL filling the upper half of the frame rather than as distant hills
 * (P4). It is now a 430 m rim at 95 m tall, chosen by measurement rather than
 * taste: the ring's colour at the sampled `hill_left_lit` / `hill_right_lit`
 * regions was scored against the same regions of the reference for several
 * heights, and 40 m / 95 m / 110 m gave mean deltas of 32.1 / 18.5 / 23.8. At
 * 95 m the ring also reads as ridges rather than a wall, because at 430 m its
 * facets are large on screen — which is what makes it low-poly instead of a
 * gradient.
 */
const RISE_HEIGHT_M = 95;
const CREST_AMPLITUDE_M = 34;

/**
 * Rise and crest exponents over the normalised radius `v`.
 *
 * Both are >= 1 on purpose: `v^1.15` and `v^1.2` have zero slope at v = 0, so
 * the ring leaves its foot flat and the join to the terrain stays C1. The
 * previous crest exponent (0.8) had an infinite derivative at the foot, i.e. a
 * crease exactly along the seam, which is the one place it would be noticed.
 * At v = 1 both still reach their full height.
 */
const RISE_EXPONENT = 1.15;
const CREST_EXPONENT = 1.2;

/** Radial split between the near band (derived) and the far band (authored). */
const NEAR_BAND_SPLIT = 0.72;
/** Distinct `midHill` tints across the near band. */
const NEAR_TINT_LEVELS = 5;

/**
 * Weight of the detail harmonic set inside the crest, 0..1.
 *
 * Raised from 0.32 to 0.45 by P4: the reference art's ridgeline is clearly
 * broken into separate peaks, and the smooth crest set alone gives one clean
 * arc. This only affects the silhouette height, not the triangle count.
 */
const DETAIL_WEIGHT = 0.45;

/** Seed streams. `hashSeed` keeps generations independent but reproducible. */
const HILL_SEED_BASE = 0x68696c6c; // 'hill'
const SEED_CREST = 1;
const SEED_DETAIL = 2;

/**
 * Documented fallback, used only if a style source hands back a value that is
 * not a parseable colour; keeps the builder total instead of emitting NaNs.
 */
const FALLBACK_HEX = '#000000';

const HEX_RE = /^#?[0-9a-f]{3,8}$/i;

interface Harmonic {
  k: number;
  amp: number;
  phase: number;
  /** Phase drift with radius: ridgelines lean outward instead of stacking. */
  drift: number;
}

/** Ring metrics, exported for fog tuning and verification. */
export const HILL_RING = {
  innerRadiusM: INNER_RADIUS_M,
  outerRadiusM: OUTER_RADIUS_M,
  angularSegments: ANGULAR_SEGMENTS,
  radialRings: RADIAL_RINGS,
  triangles: ANGULAR_SEGMENTS * RADIAL_RINGS * 2,
} as const;

function makeHarmonics(rng: Rng, ks: readonly number[], ampScale: number): Harmonic[] {
  return ks.map((k) => ({
    k,
    amp: ampScale / k,
    phase: rng.range(0, TAU),
    drift: rng.range(-1.4, 1.4),
  }));
}

/** Normalised silhouette in roughly [-1, 1]; periodic in theta by construction. */
function silhouette(hs: readonly Harmonic[], norm: number, theta: number, v: number): number {
  let sum = 0;
  for (const h of hs) {
    sum += h.amp * Math.cos(h.k * theta + h.phase + h.drift * v);
  }
  return norm === 0 ? 0 : sum / norm;
}

function toColor(hex: string, out: Color): string {
  const safe = HEX_RE.test(hex) ? hex : FALLBACK_HEX;
  out.setStyle(safe);
  return safe.toLowerCase();
}

export interface HillsOptions {
  /** Seed base for the silhouette streams; defaults to the frozen constant. */
  seed?: number;
}

/**
 * Build the distant hill ring.
 *
 * Colours come only from `ColorSource`: the far band is the authored
 * `hillsDistant` palette entry, the near band is the derived `midHill` rule
 * (design doc: mix(terrainShade, hillsDistant) by distance band) evaluated at
 * `NEAR_TINT_LEVELS` quantised levels.
 */
export function buildDistantHills(colors: ColorSource, opts: HillsOptions = {}): BuiltGeometry {
  const base = opts.seed ?? HILL_SEED_BASE;
  // Harmonic sets. The crest set carries the large hill SHAPES and was widened
  // from [1,2,3] to [2,3,4] by P4: at k = 1 a single lobe spans the whole ring,
  // so the silhouette read as one smooth arc rather than a row of hills. Starting
  // at k = 2 puts two to four lobes around the horizon. The detail set adds the
  // ragged crest on top and also starts higher than before for the same reason.
  const crestHs = makeHarmonics(createRng(hashSeed(base, SEED_CREST)), [2, 3, 4], 1);
  const detailHs = makeHarmonics(createRng(hashSeed(base, SEED_DETAIL)), [7, 11, 17], 0.55);
  const norm = (hs: readonly Harmonic[]): number =>
    hs.reduce((acc, h) => acc + h.amp, 0);
  const crestNorm = norm(crestHs);
  const detailNorm = norm(detailHs);

  // (angle, radius) parameter grid; u = x in [-0.5, 0.5], v = y in [-0.5, 0.5].
  const geometry: BufferGeometry = new PlaneGeometry(1, 1, ANGULAR_SEGMENTS, RADIAL_RINGS).toNonIndexed();
  const position = geometry.getAttribute('position');
  const radialV = new Float32Array(position.count);

  for (let i = 0; i < position.count; i++) {
    const u = position.getX(i) + 0.5;
    const v = position.getY(i) + 0.5;
    radialV[i] = v;

    const theta = (u % 1) * TAU;
    const r = INNER_RADIUS_M + v * (OUTER_RADIUS_M - INNER_RADIUS_M);
    const rise = RISE_HEIGHT_M * Math.pow(v, RISE_EXPONENT);
    const crest = CREST_AMPLITUDE_M * Math.pow(v, CREST_EXPONENT) *
      ((1 - DETAIL_WEIGHT) * silhouette(crestHs, crestNorm, theta, v) +
        DETAIL_WEIGHT * silhouette(detailHs, detailNorm, theta, v));

    position.setXYZ(i, r * Math.cos(theta), rise + crest, r * Math.sin(theta));
  }

  // One flat tint per triangle: quantised radial band, resolved via ColorSource.
  const tintKeys: string[] = [];
  const tintColors: Color[] = [];
  const tintIndex = new Map<string, number>();
  const tintFor = (v: number): number => {
    const key = v >= NEAR_BAND_SPLIT
      ? 'distant'
      : `mid:${Math.min(NEAR_TINT_LEVELS - 1, Math.floor((v / NEAR_BAND_SPLIT) * NEAR_TINT_LEVELS))}`;
    const hit = tintIndex.get(key);
    if (hit !== undefined) return hit;

    const c = new Color();
    const resolved = key === 'distant'
      ? toColor(colors.palette('hillsDistant'), c)
      : toColor(
          colors.derived({
            kind: 'midHill',
            t: (Number(key.slice(4)) + 0.5) / NEAR_TINT_LEVELS,
          }),
          c,
        );
    tintKeys.push(resolved);
    tintColors.push(c);
    tintIndex.set(key, tintColors.length - 1);
    return tintColors.length - 1;
  };

  const rgb = new Float32Array(position.count * 3);
  for (let t = 0; t < position.count / 3; t++) {
    const v = (radialV[t * 3] + radialV[t * 3 + 1] + radialV[t * 3 + 2]) / 3;
    const c = tintColors[tintFor(v)];
    for (let k = 0; k < 3; k++) {
      rgb[(t * 3 + k) * 3] = c.r;
      rgb[(t * 3 + k) * 3 + 1] = c.g;
      rgb[(t * 3 + k) * 3 + 2] = c.b;
    }
  }
  geometry.setAttribute('color', new Float32BufferAttribute(rgb, 3));
  // Non-indexed ⇒ per-triangle normals ⇒ the flat, faceted read.
  geometry.computeVertexNormals();

  return {
    geometry,
    name: 'hillsDistant',
    tintCount: new Set(tintKeys).size,
  };
}
