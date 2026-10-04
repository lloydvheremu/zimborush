/**
 * Terrain mesh — the corridor surface, built from the heightfield (task 7).
 *
 * Reads `ITerrainSource` + `ColorSource` and returns ONE `BuiltGeometry`: one
 * geometry, one material, one draw call (§5 draw-call budget counts the
 * corridor as a single item).
 *
 * One source of truth: every vertex's Y is `heightAt(x, z)` at that vertex's
 * own world (x, z) — the same function the road ribbon (task 8), the arcade
 * physics (step 6) and prop scatter (step 8) sample. The mesh therefore cannot
 * disagree with the ground it stands on, and step 6's deviation check compares
 * the two back against each other at exactly these grid vertices.
 *
 * Mesh convention (settled): a `PlaneGeometry` built in its own XY plane is
 * converted with `toNonIndexed()`, then mapped `plane (x, y) -> world
 * (x, heightAt(x, z), cz - y)`, which turns the flat Z-up sheet into the Y-up
 * landscape. That map is a rotation (determinant +1), so the plane's front
 * faces stay front faces and the winding is correct without `side:
 * DoubleSide`. No merge helper is involved: `mergeVertices` /
 * `BufferGeometryUtils` would weld away the per-face vertex split this mesh
 * needs — see the next paragraph — and pulling in `three/examples` would add a
 * second copy of geometry semantics for no gain.
 *
 * Why non-indexed: one flat colour per *face element* is only possible when no
 * two faces share a vertex. Flat shading itself still comes from the material
 * (`flatShading: true`), not from the split: under `#define FLAT_SHADED` three
 * derives the facet normal from screen-space derivatives (dFdx/dFdy of
 * `vViewPosition`), and the shader never reads a `normal` attribute — so none
 * is emitted. That is also why the plane's own normals are not carried over:
 * they point +Z in plane space and would be stale and wrong after the map.
 * `uv` is dropped too: the material is untextured (§4), so it would be 442 KB
 * of dead attribute on a phone budget.
 *
 * Colours: `terrainLit` and `terrainShade` from the passed `ColorSource` — no
 * palette value is hardcoded here; the only hex literals are the documented §4
 * fallbacks used when a style hands back a malformed value. Each face element
 * gets ONE colour: a wrapped half-Lambert mix of the two keys by the angle
 * between the face normal and the sun, so a facet's albedo already leans lit or
 * shaded before the directional light rig lands on it. The buffer is left
 * writable on purpose — step 8 bakes prop shadows into it (multiplicative
 * darkening), so do not freeze it.
 *
 * The sun is a parameter, not a constant: it is authored in the style JSON
 * (`sun.azimuthDeg` / `sun.elevationDeg`, §4), which this module must not read.
 *
 * MEASURED (seeds 1 / 7 / 42 / 1234): the corridor's facets are gentle — max
 * face slope 3.3-6.7 deg — so the mix above compresses into t = 0.58..0.66.
 * Lit and shade therefore read as a narrow band, deliberately: the corridor is
 * rolling plains, and the strong lit/shade contrast in the reference belongs to
 * the steeper distant hill ring (task 6) and to real lighting. If the step-3
 * facet side-by-side wants more contrast, that is an art call, and this is the
 * knob: widen the ramp around t = 0.5 instead of adding a second colour key.
 *
 * One-time build: a single call allocates and fills everything, and the module
 * exports nothing that runs per frame. The loops below only touch typed arrays.
 */

import { BufferAttribute, Color, Float32BufferAttribute, PlaneGeometry } from 'three';
import { CELL_SIZE_M, CORRIDOR_CELLS } from './heightfield';
import type { ColorSource } from '../../renderer/contracts';
import type { BuiltGeometry, ITerrainSource } from '../../world/contracts';

/**
 * Sun direction, world space: points from the ground toward the sun. Need not
 * be normalised; this module normalises it once at build.
 */
export interface TerrainSun {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Fallback palette values, used ONLY when the `ColorSource` returns something
 * that is not `#RRGGBB`. These are the estimates authored in design doc §4;
 * keeping them here means a style bug degrades the terrain's colour instead of
 * failing the boot.
 */
const FALLBACK_TERRAIN_LIT = '#C99A6B';
const FALLBACK_TERRAIN_SHADE = '#8A6A4F';

/** A `#RRGGBB` value, the only shape `ColorSource.palette` may return. */
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Tolerance for "bounds divide evenly into cells". */
const CELL_FIT_EPSILON = 1e-6;

/**
 * Parses `#RRGGBB` into `out`. three converts sRGB to the linear working space
 * the shader multiplies by, so the authored palette keeps its intended value.
 * A malformed string warns once and falls back rather than throwing: a bad
 * style entry must not be able to take the world build down.
 */
function setHex(hex: string, fallback: string, out: Color): Color {
  if (!HEX_PATTERN.test(hex)) {
    console.warn(`terrain: palette value "${hex}" is not #RRGGBB — using fallback ${fallback}`);
    return out.setStyle(fallback);
  }
  return out.setStyle(hex);
}

/**
 * Builds the corridor terrain mesh for `terrain`, coloured from `colors`.
 *
 * @param terrain Height source; defines both the corridor bounds and the grid.
 * @param colors  Palette access; only `terrainLit` / `terrainShade` are read.
 * @param sun     Direction toward the sun, used to split lit vs shaded faces.
 */
export function buildTerrainGeometry(
  terrain: ITerrainSource,
  colors: ColorSource,
  sun: TerrainSun,
): BuiltGeometry {
  const { minX, maxX, minZ, maxZ } = terrain.bounds;
  const widthM = maxX - minX;
  const depthM = maxZ - minZ;
  const cellM = terrain.cellSize;

  // Guard the seam: the grid must divide the bounds exactly, or the last vertex
  // row would sit off the lattice `heightAt` is sampled on. The corridor is
  // 96 x 96 cells of 4 m (§5) — a moved bound is a conscious change, not a
  // silent one.
  const cellsX = Math.round(widthM / cellM);
  const cellsZ = Math.round(depthM / cellM);
  if (
    cellsX < 1 ||
    cellsZ < 1 ||
    Math.abs(cellsX * cellM - widthM) > CELL_FIT_EPSILON ||
    Math.abs(cellsZ * cellM - depthM) > CELL_FIT_EPSILON
  ) {
    throw new Error(
      `terrain: bounds are ${widthM} m x ${depthM} m, which is not a whole number of ${cellM} m cells`,
    );
  }
  if (cellsX !== CORRIDOR_CELLS || cellsZ !== CORRIDOR_CELLS || cellM !== CELL_SIZE_M) {
    throw new Error(
      `terrain: expected the ${CORRIDOR_CELLS} x ${CORRIDOR_CELLS} cell corridor at ` +
        `${CELL_SIZE_M} m, got ${cellsX} x ${cellsZ} at ${cellM} m`,
    );
  }

  // Plane centre in world space; the corridor is origin-centred today, but
  // using the bounds' own centre keeps the mapping correct if it ever moves.
  const centreX = (minX + maxX) * 0.5;
  const centreZ = (minZ + maxZ) * 0.5;

  const plane = new PlaneGeometry(widthM, depthM, cellsX, cellsZ);

  // Height the *indexed* plane (97 x 97 vertices for the corridor) and map it
  // into world space: plane (x, y) -> world (x, h, z). `toNonIndexed` then fans
  // each corner out to its faces, so `heightAt` runs 9,409 times, not 98,304.
  const indexed = plane.getAttribute('position') as BufferAttribute;
  const indexedArray = indexed.array as Float32Array;
  for (let i = 0; i < indexed.count; i++) {
    const base = i * 3;
    const x = indexedArray[base] + centreX;
    const z = centreZ - indexedArray[base + 1];
    indexedArray[base] = x;
    indexedArray[base + 1] = terrain.heightAt(x, z);
    indexedArray[base + 2] = z;
  }

  const geometry = plane.toNonIndexed();

  const positions = geometry.getAttribute('position') as BufferAttribute;
  const vertexCount = positions.count;
  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    throw new Error(`terrain: expected whole triangles, got ${vertexCount} vertices`);
  }
  const positionArray = positions.array as Float32Array;

  // Palette -> linear scalars once, then one colour per face element.
  const lit = setHex(colors.palette('terrainLit'), FALLBACK_TERRAIN_LIT, new Color());
  const shaded = setHex(colors.palette('terrainShade'), FALLBACK_TERRAIN_SHADE, new Color());
  const litR = lit.r;
  const litG = lit.g;
  const litB = lit.b;
  const shadeR = shaded.r;
  const shadeG = shaded.g;
  const shadeB = shaded.b;

  const sunLength = Math.sqrt(sun.x * sun.x + sun.y * sun.y + sun.z * sun.z);
  if (sunLength < 1e-6) {
    throw new Error('terrain: sun direction must be a non-zero vector');
  }
  const sunX = sun.x / sunLength;
  const sunY = sun.y / sunLength;
  const sunZ = sun.z / sunLength;

  const colourArray = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v += 3) {
    const base = v * 3;
    const aX = positionArray[base];
    const aY = positionArray[base + 1];
    const aZ = positionArray[base + 2];
    const abX = positionArray[base + 3] - aX;
    const abY = positionArray[base + 4] - aY;
    const abZ = positionArray[base + 5] - aZ;
    const acX = positionArray[base + 6] - aX;
    const acY = positionArray[base + 7] - aY;
    const acZ = positionArray[base + 8] - aZ;

    // Face normal from the element's own winding (see the header: the mapping
    // preserves orientation, so this points up for a flat, unwound face).
    let nX = abY * acZ - abZ * acY;
    let nY = abZ * acX - abX * acZ;
    let nZ = abX * acY - abY * acX;
    const nLength = Math.sqrt(nX * nX + nY * nY + nZ * nZ);
    // A degenerate facet gets the mid tone instead of NaN.
    if (nLength > 0) {
      const invN = 1 / nLength;
      nX *= invN;
      nY *= invN;
      nZ *= invN;
    } else {
      nX = 0;
      nY = 1;
      nZ = 0;
    }

    // Wrapped half-Lambert: 0 = facing away from the sun, 1 = facing it. The
    // wrap keeps a near-horizon sunset sun from flattening the whole field to
    // the shade key, and leaves the real shadow term to the lighting rig.
    let t = 0.5 + 0.5 * (nX * sunX + nY * sunY + nZ * sunZ);
    if (t < 0) {
      t = 0;
    } else if (t > 1) {
      t = 1;
    }
    const r = shadeR + (litR - shadeR) * t;
    const g = shadeG + (litG - shadeG) * t;
    const b = shadeB + (litB - shadeB) * t;

    // One triple, written to all three corners: the invariant that makes the
    // facet flat regardless of what the material does.
    colourArray[base] = r;
    colourArray[base + 1] = g;
    colourArray[base + 2] = b;
    colourArray[base + 3] = r;
    colourArray[base + 4] = g;
    colourArray[base + 5] = b;
    colourArray[base + 6] = r;
    colourArray[base + 7] = g;
    colourArray[base + 8] = b;
  }

  // Position + colour only. `normal` would be stale after the map and is
  // unused under FLAT_SHADED; `uv` belongs to a texture this material has not.
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry.setAttribute('color', new Float32BufferAttribute(colourArray, 3));

  return {
    geometry,
    name: 'terrain',
    // One tint family: lit/shade here are one continuous mix per facet, not
    // discrete material families, so the whole corridor is a single mesh with a
    // single material — one draw call (design doc §5 / §6).
    tintCount: 1,
  };
}
