/**
 * Rival bike + rider — step 7, design doc §5 (triangle budget, one merged
 * draw) and §11.
 *
 * ONE merged, non-indexed `BufferGeometry` with `position` + `color`
 * attributes, returned inside exactly one `Mesh` with exactly one material:
 * one draw call. There is no index and no groups, so nothing can split the
 * draw. No `normal` attribute: the material is flat-shaded and derives facet
 * normals from screen-space derivatives, matching the terrain / world-view
 * convention (`src/game/track/terrain.ts`).
 *
 * Colours (design doc §4 — derived, never authored):
 *  - rival bike  = palette `bikeMetal`;
 *  - rival jersey = the accent hue rotated 180°.
 *
 * SEAM NOTE (reported, not changed): the frozen `StylePalette` has no
 * `accent` key and `DerivedColorRule` has no rival-jersey rule, so the
 * sunset accent `skyMid` is treated as the accent-hue source and the 180°
 * rotation is applied locally in `deriveRivalJersey`. Hex fallbacks below are
 * documented constants used only when the palette value is missing/invalid.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshLambertMaterial } from 'three';
import { createRng, hashSeed } from '../../core/rng';
import type { ColorSource, HexColor } from '../../renderer/contracts';

/** RNG stream tag; keeps mesh jitter independent of sim/rival streams. */
const RIVAL_MESH_STREAM_TAG = 0x7a12;

/** Mesh/geometry names for the scene-graph slot and telemetry. */
export const RIVAL_MESH_NAME = 'rival';
export const RIVAL_GEOMETRY_NAME = 'rivalGeometry';

/** Documented fallbacks, used only when a palette value is missing/invalid. */
const BIKE_FALLBACK_HEX: HexColor = '#2E2A26';
const ACCENT_FALLBACK_HEX: HexColor = '#FF9552';

/** `#RRGGBB` only; same validation style as the terrain/road builders. */
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Triangles per box: 6 faces × 2. */
const TRIANGLES_PER_BOX = 12;

interface Box {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  base: 'metal' | 'jersey';
}

/**
 * Local frame: +X forward, +Y up, origin on the ground between the wheels.
 * Rider sits on the seat (pelvis bottom ≈ seat top) and reaches the
 * handlebar; silhouette only — no rig.
 */
const BOXES: readonly Box[] = [
  // Bike — `bikeMetal` (design doc §4).
  { cx: -0.62, cy: 0.33, cz: 0.0, hx: 0.3, hy: 0.33, hz: 0.055, base: 'metal' }, // rear wheel
  { cx: 0.62, cy: 0.33, cz: 0.0, hx: 0.3, hy: 0.33, hz: 0.055, base: 'metal' }, // front wheel
  { cx: 0.02, cy: 0.66, cz: 0.0, hx: 0.42, hy: 0.12, hz: 0.09, base: 'metal' }, // frame + tank
  { cx: 0.1, cy: 0.47, cz: 0.0, hx: 0.22, hy: 0.14, hz: 0.1, base: 'metal' }, // engine block
  { cx: -0.42, cy: 0.8, cz: 0.0, hx: 0.34, hy: 0.055, hz: 0.1, base: 'metal' }, // seat
  { cx: 0.62, cy: 0.72, cz: 0.0, hx: 0.24, hy: 0.045, hz: 0.075, base: 'metal' }, // front fender
  { cx: 0.62, cy: 0.52, cz: 0.06, hx: 0.05, hy: 0.22, hz: 0.03, base: 'metal' }, // fork L
  { cx: 0.62, cy: 0.52, cz: -0.06, hx: 0.05, hy: 0.22, hz: 0.03, base: 'metal' }, // fork R
  { cx: 0.42, cy: 1.06, cz: 0.0, hx: 0.035, hy: 0.035, hz: 0.26, base: 'metal' }, // handlebar
  { cx: -0.25, cy: 0.44, cz: 0.1, hx: 0.3, hy: 0.045, hz: 0.045, base: 'metal' }, // exhaust
  // Rider — jersey = accent hue rotated 180° (design doc §4).
  { cx: -0.34, cy: 0.94, cz: 0.0, hx: 0.17, hy: 0.1, hz: 0.15, base: 'jersey' }, // pelvis
  { cx: -0.16, cy: 1.24, cz: 0.0, hx: 0.13, hy: 0.2, hz: 0.17, base: 'jersey' }, // torso
  { cx: 0.14, cy: 1.14, cz: 0.2, hx: 0.24, hy: 0.055, hz: 0.055, base: 'jersey' }, // arm L
  { cx: 0.14, cy: 1.14, cz: -0.2, hx: 0.24, hy: 0.055, hz: 0.055, base: 'jersey' }, // arm R
  // Rider gear — dark metal like the bike.
  { cx: 0.02, cy: 1.56, cz: 0.0, hx: 0.13, hy: 0.12, hz: 0.12, base: 'metal' }, // helmet
  { cx: -0.12, cy: 0.7, cz: 0.14, hx: 0.26, hy: 0.1, hz: 0.07, base: 'metal' }, // leg L
  { cx: -0.12, cy: 0.7, cz: -0.14, hx: 0.26, hy: 0.1, hz: 0.07, base: 'metal' }, // leg R
  { cx: 0.04, cy: 0.6, cz: 0.14, hx: 0.1, hy: 0.06, hz: 0.06, base: 'metal' }, // boot L
  { cx: 0.04, cy: 0.6, cz: -0.14, hx: 0.1, hy: 0.06, hz: 0.06, base: 'metal' }, // boot R
];

/** Box count and exact triangle count, exported for budget telemetry. */
export const RIVAL_BOX_COUNT = BOXES.length;
export const RIVAL_TRIANGLE_COUNT = RIVAL_BOX_COUNT * TRIANGLES_PER_BOX;

/**
 * Faces as two triangles each, CCW seen from outside, with a per-face shade
 * factor. Corner index mapping:
 * 0 (-,-,-) 1 (+,-,-) 2 (+,+,-) 3 (-,+,-) 4 (-,-,+) 5 (+,-,+) 6 (+,+,+) 7 (-,+,+).
 */
const FACES: readonly { a: number; b: number; c: number; shade: number }[] = [
  { a: 4, b: 5, c: 6, shade: 0.86 }, // +z
  { a: 4, b: 6, c: 7, shade: 0.86 },
  { a: 1, b: 0, c: 3, shade: 0.8 }, // -z
  { a: 1, b: 3, c: 2, shade: 0.8 },
  { a: 5, b: 1, c: 2, shade: 0.92 }, // +x
  { a: 5, b: 2, c: 6, shade: 0.92 },
  { a: 0, b: 4, c: 7, shade: 0.7 }, // -x
  { a: 0, b: 7, c: 3, shade: 0.7 },
  { a: 7, b: 6, c: 2, shade: 1.0 }, // +y
  { a: 7, b: 2, c: 3, shade: 1.0 },
  { a: 0, b: 1, c: 5, shade: 0.55 }, // -y
  { a: 0, b: 5, c: 4, shade: 0.55 },
];

/**
 * Rotate a hex colour's hue by 180°, keeping saturation/lightness: the
 * "accent hue rotated 180 degrees" rule from design doc §4. Invalid input
 * falls back to the documented accent constant.
 */
export function deriveRivalJersey(accentHex: HexColor): HexColor {
  let source = accentHex;
  if (!HEX_PATTERN.test(source)) {
    console.warn(
      `rival mesh: palette accent "${accentHex}" is not #RRGGBB — using fallback ${ACCENT_FALLBACK_HEX}`,
    );
    source = ACCENT_FALLBACK_HEX;
  }
  const colour = new Color().setStyle(source);
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  colour.setHSL((hsl.h + 0.5) % 1, hsl.s, hsl.l);
  return `#${colour.getHexString()}`;
}

function resolveMetres(
  value: HexColor,
  fallback: HexColor,
  key: string,
): HexColor {
  if (!HEX_PATTERN.test(value)) {
    console.warn(`rival mesh: palette value "${value}" for ${key} is not #RRGGBB — using fallback ${fallback}`);
    return fallback;
  }
  return value;
}

function pushBox(positions: number[], colours: number[], box: Box, r: number, g: number, b: number): void {
  const { cx, cy, cz, hx, hy, hz } = box;
  const cornersX = [-hx, hx, hx, -hx, -hx, hx, hx, -hx];
  const cornersY = [-hy, -hy, hy, hy, -hy, -hy, hy, hy];
  const cornersZ = [-hz, -hz, -hz, -hz, hz, hz, hz, hz];
  for (const face of FACES) {
    const vertices = [face.a, face.b, face.c];
    for (const v of vertices) {
      positions.push(cx + cornersX[v], cy + cornersY[v], cz + cornersZ[v]);
      colours.push(r * face.shade, g * face.shade, b * face.shade);
    }
  }
}

/**
 * Build the merged rival geometry: one non-indexed `BufferGeometry` with only
 * `position` and `color` attributes (interleaved layout by construction, same
 * vertex count). Deterministic for a given `seed`.
 */
export function buildRivalGeometry(seed: number, colors: ColorSource): BufferGeometry {
  const rng = createRng(hashSeed(seed, RIVAL_MESH_STREAM_TAG));
  const metalHex = resolveMetres(colors.palette('bikeMetal'), BIKE_FALLBACK_HEX, 'bikeMetal');
  const jerseyHex = deriveRivalJersey(colors.palette('skyMid'));
  const metal = new Color().setStyle(metalHex);
  const jersey = new Color().setStyle(jerseyHex);

  const positions: number[] = [];
  const colours: number[] = [];
  for (const box of BOXES) {
    // ±3% deterministic per-box shading variance so the merge does not read
    // as one flat blob (draw from the seeded stream, never `Math.random`).
    const jitter = 0.97 + rng.next() * 0.06;
    const base = box.base === 'metal' ? metal : jersey;
    pushBox(positions, colours, box, base.r * jitter, base.g * jitter, base.b * jitter);
  }

  const geometry = new BufferGeometry();
  geometry.name = RIVAL_GEOMETRY_NAME;
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return geometry;
}

/**
 * The rival as it enters the scene: ONE mesh, ONE material — one draw call.
 * Nothing secondary (no shadow quad, no billboard) is returned; caller-owned
 * effects stay in their own modules.
 */
export function createRivalMesh(seed: number, colors: ColorSource): Mesh {
  const geometry = buildRivalGeometry(seed, colors);
  const material = new MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    fog: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = RIVAL_MESH_NAME;
  return mesh;
}
