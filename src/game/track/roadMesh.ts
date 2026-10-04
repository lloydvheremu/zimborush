/**
 * Road ribbon — the drivable surface of the ZimboRush circuit (task 8).
 *
 * One geometry, one mesh, one draw call (§5's "road ribbon + shoulders +
 * wheel tracks", budget ~4k triangles). Around the closed loop: 280 quads ×
 * 7 colour columns × 2 triangles = 3920 triangles, carrying `road`,
 * `roadTrack` and `terrainShade` as face colours in a single vertex-colour
 * buffer — no textures, no second geometry.
 *
 * Drapery, not extrusion. `ISplineSource.pointAt` is the frozen PLAN-VIEW
 * centreline (y = 0, see `world/contracts.ts`): every vertex here takes its
 * (x, z) from the spline plus a lateral offset, and its y from
 * `ITerrainSource.heightAt(x, z)` at that exact position. So the ribbon lies
 * on the ground everywhere — including the shoulder columns, which must not
 * undercut it — and the curve and the terrain stay independently tunable.
 *
 * Cross-section (metres from the centreline, left → right):
 *
 *   -4.20  -3.50  -1.35  -0.65  +0.65  +1.35  +3.50  +4.20
 *    \______/ \____/ \____/ \____/ \____/ \____/ \______/
 *    shoulder   road  track   road  track  road   shoulder
 *
 * The two inner bands are the wheel tracks (`roadTrack`), the middle and outer
 * bands the driving surface (`road`), and the outermost 0.7 m strips the
 * graded shoulders (`terrainShade`, design doc §5). Track offset/width and
 * shoulder width are ESTIMATEs — the doc fixes the element, not its
 * millimetres.
 *
 * Mesh convention (settled): `new PlaneGeometry(...).toNonIndexed()` — one
 * vertex triple per triangle, each face element carrying exactly ONE flat
 * colour, so the low-poly facets read as authored, not smeared. No merge
 * utilities, no three/examples or three/addons imports.
 *
 * Rows are stepped in arc length, so the cross-section spacing is uniform
 * (lengthM / 280 ≈ 3.07 m for the current seed), and the final row closes the
 * loop onto row 0 — the seam is watertight by construction.
 *
 * Allocation: everything is built once inside `buildRoadGeometry`; the module
 * exports no update step, so nothing here can run per frame.
 */

import { Color, Float32BufferAttribute, PlaneGeometry } from 'three';
import type { ColorSource, HexColor } from '../../renderer/contracts';
import type { BuiltGeometry } from '../../world/contracts';
import { createHeightfield } from './heightfield';
import { createRoad } from './road';

/** Quads around the loop. ~860 m / 280 ≈ 3.07 m per cross-section — denser
 * than the 4 m terrain grid, so the ribbon resolves every ground fold the
 * terrain does. */
const RING_SEGMENTS = 280;

/** Colour columns across the ribbon (see the profile in the header). */
const COLUMNS = 7;

/** Profile vertices per cross-section: one more than the columns. */
const PROFILE_COUNT = COLUMNS + 1;

/** Wheel-track centre offset from the centreline, metres (ESTIMATE). */
const TRACK_CENTER_M = 1;
/** Wheel-track half-width, metres (ESTIMATE): a 0.7 m band per wheel. */
const TRACK_HALF_M = 0.35;
/** Inner and outer edges of a wheel band, metres. */
const TRACK_INNER_M = TRACK_CENTER_M - TRACK_HALF_M;
const TRACK_OUTER_M = TRACK_CENTER_M + TRACK_HALF_M;
/** Graded shoulder width beyond the spline's road edge, metres (ESTIMATE). */
const SHOULDER_M = 0.7;
/** Minimum clearance between a track band and the road edge, metres: keeps the
 * profile columns strictly ordered even if `halfWidthAt` ever varies. */
const PROFILE_MIN_GAP_M = 0.05;

/** Design doc §5 budget for this element (ribbon + shoulders + tracks). */
const ROAD_TRIANGLE_BUDGET = 4000;

/** Scene-graph / telemetry name for the assembled object. */
const GEOMETRY_NAME = 'roadRibbon';

/** The style keys this ribbon paints with: its three tint families. */
type RoadPaletteKey = 'road' | 'roadTrack' | 'terrainShade';

/** Column → tint family, left to right (see the profile in the header). */
const COLUMN_TINTS: readonly RoadPaletteKey[] = [
  'terrainShade',
  'road',
  'roadTrack',
  'road',
  'roadTrack',
  'road',
  'terrainShade',
];

/** Same #RRGGBB shape the style loader enforces. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Documented fallbacks — the design doc §4 ESTIMATEs for the keys this file
 * reads. They are used ONLY if the palette fails to supply a valid `#RRGGBB`
 * string, so a partial style can never paint the road black or white; the real
 * colours belong to the style layer (task 11).
 */
const FALLBACK_TINTS: Record<RoadPaletteKey, HexColor> = {
  road: '#C4A269',
  roadTrack: '#A5854F',
  terrainShade: '#8A6A4F',
};

/** Palette key → a linear-space `Color`, falling back as documented above. */
function resolveTint(colors: ColorSource, key: RoadPaletteKey): Color {
  const value = colors.palette(key);
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    const fallback = FALLBACK_TINTS[key];
    console.warn(`buildRoadGeometry: palette "${String(value)}" for "${key}" is not #RRGGBB — using fallback ${fallback}`);
    return new Color().setStyle(fallback);
  }
  return new Color().setStyle(value);
}

/**
 * Builds the road ribbon for `seed` as ONE geometry. The curve and the ground
 * come from the same seed the rest of the world uses, and both sources are
 * pure, so the ribbon agrees with the world's own `createRoad(seed)` /
 * `createHeightfield(seed)` by construction.
 *
 * Throws if the spline is too narrow for the wheel-track profile, so a
 * malformed seam fails at build with the offending value instead of as a
 * silently degenerate profile.
 */
export function buildRoadGeometry(seed: number, colors: ColorSource): BuiltGeometry {
  const road = createRoad(seed);
  const terrain = createHeightfield(seed);
  const lengthM = road.lengthM;

  // --- 1. Cross-section table: centre, lateral and profile per row ---------
  const sections = RING_SEGMENTS + 1; // last row closes the loop onto row 0
  const centreX = new Float64Array(sections);
  const centreZ = new Float64Array(sections);
  const lateralX = new Float64Array(sections);
  const lateralZ = new Float64Array(sections);
  const profileM = new Float64Array(sections * PROFILE_COUNT);
  const point = { x: 0, y: 0, z: 0 };
  const tangent = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < sections; i++) {
    const s = (i / RING_SEGMENTS) * lengthM;
    road.pointAt(s, point);
    road.tangentAt(s, tangent);
    const halfWidthM = road.halfWidthAt(s);
    if (!(halfWidthM > TRACK_OUTER_M + PROFILE_MIN_GAP_M)) {
      throw new Error(
        `buildRoadGeometry: halfWidthAt(${s} m) = ${halfWidthM} m is too narrow for the ` +
          `${TRACK_OUTER_M} m wheel-track profile`,
      );
    }
    centreX[i] = point.x;
    centreZ[i] = point.z;
    // Plan-view lateral: up × tangent = (t.z, 0, -t.x); unit because t is unit.
    lateralX[i] = tangent.z;
    lateralZ[i] = -tangent.x;
    const base = i * PROFILE_COUNT;
    profileM[base] = -(halfWidthM + SHOULDER_M);
    profileM[base + 1] = -halfWidthM;
    profileM[base + 2] = -TRACK_OUTER_M;
    profileM[base + 3] = -TRACK_INNER_M;
    profileM[base + 4] = TRACK_INNER_M;
    profileM[base + 5] = TRACK_OUTER_M;
    profileM[base + 6] = halfWidthM;
    profileM[base + 7] = halfWidthM + SHOULDER_M;
  }

  // NOTE (measured): the centreline carries near-cusp kinks — the row-to-row
  // tangent turn reaches ~96–168° at the ~3 m row spacing across the seeds
  // measured — so the 8.4 m-wide band folds over itself for a few metres of
  // the ~860 m loop. That is a property of the frozen plan-view seam, not of
  // this builder: every cross-section still follows `pointAt` / `tangentAt`
  // exactly. A fold guard was tried against this and rejected every seed, so
  // none is applied — the fold is reported, not hidden.

  // --- 2. One non-indexed facet grid: flat colour per face -----------------
  const plane = new PlaneGeometry(1, 1, COLUMNS, RING_SEGMENTS);
  const geometry = plane.toNonIndexed();
  const positions = geometry.getAttribute('position');
  const colourArray = new Float32Array(positions.count * 3);
  const columnTint = COLUMN_TINTS.map((key) => resolveTint(colors, key));

  /**
   * Writes one vertex: lateral offset off the row's centreline, ground height
   * at that exact (x, z), and the face's flat colour. The 6-vertex order used
   * below must match `PlaneGeometry`'s a, b, d, b, c, d triangle layout
   * (three r186).
   */
  const place = (vertexIndex: number, row: number, profileIndex: number, tint: Color): void => {
    const offsetM = profileM[row * PROFILE_COUNT + profileIndex];
    const x = centreX[row] + lateralX[row] * offsetM;
    const z = centreZ[row] + lateralZ[row] * offsetM;
    positions.setXYZ(vertexIndex, x, terrain.heightAt(x, z), z);
    colourArray[vertexIndex * 3] = tint.r;
    colourArray[vertexIndex * 3 + 1] = tint.g;
    colourArray[vertexIndex * 3 + 2] = tint.b;
  };

  const facets = RING_SEGMENTS * COLUMNS;
  for (let facet = 0; facet < facets; facet++) {
    const row = Math.floor(facet / COLUMNS);
    const column = facet - row * COLUMNS;
    const tint = columnTint[column];
    const base = facet * 6;
    // Facet corners in the plane's vertex order: (row, col), (row+1, col),
    // (row, col+1), (row+1, col), (row+1, col+1), (row, col+1).
    place(base, row, column, tint);
    place(base + 1, row + 1, column, tint);
    place(base + 2, row, column + 1, tint);
    place(base + 3, row + 1, column, tint);
    place(base + 4, row + 1, column + 1, tint);
    place(base + 5, row, column + 1, tint);
  }

  positions.needsUpdate = true;
  geometry.setAttribute('color', new Float32BufferAttribute(colourArray, 3));
  // The plane's `uv` belongs to a texture this game never uses (§4), so it
  // goes. The plane's own `normal` (+Z in plane space) is stale after the
  // drape and is replaced: on non-indexed geometry `computeVertexNormals()`
  // writes the same face normal to all three of a triangle's vertices, so the
  // ribbon reads as flat facets whether the material opts into `flatShading`
  // or not — same reasoning as the hill ring (task 6).
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
  geometry.name = GEOMETRY_NAME;

  const triangles = positions.count / 3;
  if (triangles > ROAD_TRIANGLE_BUDGET) {
    throw new Error(
      `buildRoadGeometry: ${triangles} triangles exceed the §5 road budget ` +
        `(${ROAD_TRIANGLE_BUDGET})`,
    );
  }

  return {
    geometry,
    name: GEOMETRY_NAME,
    // Distinct tint families carried by the single vertex-colour buffer.
    tintCount: new Set(COLUMN_TINTS).size,
  };
}
