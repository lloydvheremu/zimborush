/**
 * Terrain heightfield — the analytic ground height of the ZimboRush corridor
 * (task 4). Implements `ITerrainSource` from `world/contracts.ts`.
 *
 * One function serves the whole game: the terrain mesh (task 7), arcade
 * physics (step 6), prop scatter (step 8) and the road centreline (`road.ts`)
 * all sample `heightAt`, so the ground can never disagree with itself. The
 * field is five octaves of rotated 2D value noise summed over the integer
 * lattice hashing in `core/rng.ts` — there is no second PRNG in the project.
 *
 * Why 4 m cells: `CORRIDOR_CELLS` = 96 is fixed by the design doc (§5, the
 * 96x96 corridor). 4 m cells make that corridor 384 m x 384 m — enough for the
 * ~800 m road loop plus run-off. Cell size also sets the error step 6 checks
 * against this source: a quad's linear interpolation misses the H cell-centre
 * value by roughly the field's second difference over the cell, A(pi h/L)^2/2
 * per octave, which for the octaves below at h = 4 m comes out around max
 * 0.03 m / mean 0.01 m — inside the 0.05 m / 0.02 m tolerance (ESTIMATE;
 * step 6 measures the real figure).
 *
 * Determinism: no `Math.cos` / `Math.sin` anywhere. Engines may disagree on
 * those by an ulp, and an ulp in this field can flip which noise lattice cell
 * a position lands in — §3 requires one seed to reproduce one track. The
 * octave-rotation angles are therefore pinned by a seeded sqrt pair, and the
 * only transcendental call left is `Math.sqrt`, which IEEE-754 requires to be
 * correctly rounded.
 *
 * Invariants:
 * - Pure: a call reads only `(x, z)` plus per-instance constants derived from
 *   the seed — no scene, no renderer, no clock.
 * - C1-continuous: the smoothstep interpolation is flat-sloped at lattice
 *   crossings, so `normalAt`'s differences never straddle a gradient step.
 * - Defined everywhere; `bounds` is the corridor the mesh is expected to
 *   cover, not a clamp — the road reaches beyond it only by design margin.
 * - Allocation-free: nothing on the call path creates an object, array,
 *   closure or iterator. Per-octave constants live in one Float64Array that
 *   is built here, in the constructor.
 */

import { hashSeed, hashUnit } from '../../core/rng';
import type { Bounds2, ITerrainSource, Vec3Mut } from '../../world/contracts';

/** Corridor resolution along each axis, in grid cells (design doc §5). */
export const CORRIDOR_CELLS = 96;

/** Grid cell size in metres; 96 x 96 of these is the corridor. */
export const CELL_SIZE_M = 4;

/** Corridor extent along each axis in metres (96 x 4 = 384). */
export const CORRIDOR_SIZE_M = CORRIDOR_CELLS * CELL_SIZE_M;

/** Half extent in metres; the corridor is centred on the world origin. */
const HALF_EXTENT_M = CORRIDOR_SIZE_M * 0.5;

/** Feature tag: keeps this field's seed stream separate from siblings'. */
const TERRAIN_STREAM_TAG = 0x7a01;

/** Octaves coarse to fine: wavelength in metres, amplitude in metres. */
const OCTAVE_WAVELENGTH_M = [520, 260, 130, 64, 32];
const OCTAVE_AMPLITUDE_M = [13, 4.5, 1.4, 0.4, 0.08];

const OCTAVE_COUNT = OCTAVE_WAVELENGTH_M.length;

/** Packed per-octave constants: [cosA/L, sinA/L, amplitude, noise seed]. */
const OCTAVE_STRIDE = 4;

/** Central-difference step for `normalAt`, metres. */
const NORMAL_EPSILON_M = 1;

/** C1-continuous interpolation on [0, 1]: no gradient steps between cells. */
function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * One octave of 2D value noise in [-1, 1]. `fx` / `fz` are in lattice units.
 * Lattice values come from `core/rng.ts`, so determinism keeps one owner.
 */
function valueNoise2(fx: number, fz: number, seed: number): number {
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smoothStep(fx - ix);
  const tz = smoothStep(fz - iz);
  const v00 = hashUnit(hashSeed(ix, iz), seed);
  const v10 = hashUnit(hashSeed(ix + 1, iz), seed);
  const v01 = hashUnit(hashSeed(ix, iz + 1), seed);
  const v11 = hashUnit(hashSeed(ix + 1, iz + 1), seed);
  const row0 = v00 + (v10 - v00) * tx;
  const row1 = v01 + (v11 - v01) * tx;
  return (row0 + (row1 - row0) * tz) * 2 - 1;
}

/**
 * Builds the analytic terrain source for `seed`. The returned object owns
 * every constant its functions read; nothing is fetched from module scope.
 */
export function createHeightfield(seed: number): ITerrainSource {
  const streamSeed = hashSeed(seed, TERRAIN_STREAM_TAG);
  const params = new Float64Array(OCTAVE_COUNT * OCTAVE_STRIDE);

  for (let i = 0; i < OCTAVE_COUNT; i++) {
    const invWavelength = 1 / OCTAVE_WAVELENGTH_M[i];
    // A seeded unit (cos, sin) pair built from sqrt rather than cos/sin: the
    // rotation only has to decorrelate octaves, the exact angle is free.
    const sinA = hashUnit(i, streamSeed) * 1.9 - 0.95;
    const cosA = Math.sqrt(1 - sinA * sinA);
    const base = i * OCTAVE_STRIDE;
    params[base] = cosA * invWavelength;
    params[base + 1] = sinA * invWavelength;
    params[base + 2] = OCTAVE_AMPLITUDE_M[i];
    params[base + 3] = hashSeed(streamSeed, i + 1);
  }

  const heightAt = (x: number, z: number): number => {
    let height = 0;
    for (let i = 0; i < OCTAVE_COUNT; i++) {
      const base = i * OCTAVE_STRIDE;
      const rotX = params[base];
      const rotZ = params[base + 1];
      height += params[base + 2] * valueNoise2(rotX * x + rotZ * z, rotX * z - rotZ * x, params[base + 3]);
    }
    return height;
  };

  const normalAt = (x: number, z: number, out: Vec3Mut): Vec3Mut => {
    const slopeX =
      (heightAt(x + NORMAL_EPSILON_M, z) - heightAt(x - NORMAL_EPSILON_M, z)) / (2 * NORMAL_EPSILON_M);
    const slopeZ =
      (heightAt(x, z + NORMAL_EPSILON_M) - heightAt(x, z - NORMAL_EPSILON_M)) / (2 * NORMAL_EPSILON_M);
    const invLength = 1 / Math.sqrt(slopeX * slopeX + slopeZ * slopeZ + 1);
    out.x = -slopeX * invLength;
    out.y = invLength;
    out.z = -slopeZ * invLength;
    return out;
  };

  const bounds: Bounds2 = {
    minX: -HALF_EXTENT_M,
    maxX: HALF_EXTENT_M,
    minZ: -HALF_EXTENT_M,
    maxZ: HALF_EXTENT_M,
  };

  return { heightAt, normalAt, bounds, cellSize: CELL_SIZE_M };
}
