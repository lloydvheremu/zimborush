/**
 * Rival dust sprites — design doc §14.7 (fixes 9), budgeted in §5.
 *
 * Budget: `BUDGET.dustQuads` = 12 sprite quads. All 12 live in ONE non-indexed
 * BufferGeometry (12 quads x 6 vertices = 72 vertices = 24 triangles) drawn
 * with ONE material, so the whole effect is exactly one draw call.
 *
 * The ring buffer is a struct-of-arrays allocated once at construction;
 * `update()` only writes into those typed arrays and into the two attributes'
 * backing stores, so a frame creates no objects, arrays or closures.
 * Randomness comes from the field's own seeded stream and is drawn only when a
 * puff spawns, which is what makes the same seed + the same input sequence
 * produce identical particle positions.
 *
 * Frame order inside `update()`: existing puffs age and rewrite first, then
 * this frame's distance-gated spawns are written at age 0 — so a puff is never
 * aged by the same step that created it.
 *
 * The geometry is built by hand rather than by merging 12 PlaneGeometry
 * instances: the settled mesh convention (`PlaneGeometry(...).toNonIndexed()`)
 * applies to flat per-face colours, and BufferGeometryUtils / three examples
 * are out of bounds. Positions and the vec4 colour attribute are rewritten in
 * place every frame, which is why the mesh must not be frustum culled by a
 * bounding sphere baked at the origin.
 *
 * Transparency: puffs are alpha-blended (depthWrite off). Transparent overdraw
 * is exactly why §5 cuts this effect FIRST on the low tier — `setEnabled(false)`
 * is that cut and makes `update()` return before it does any work.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { BUDGET, type ColorSource } from '../../renderer/contracts';
import { createRng, hashSeed } from '../../core/rng';
import type { ITerrainSource } from '../../world/contracts';

/** Ring-buffer capacity, read from the frozen budget (never a local copy). */
const CAP = BUDGET.dustQuads; // 12

/**
 * Stream label: keeps dust's random draws independent of any other feature's
 * stream derived from the same world seed (design doc §3, src/core/rng).
 */
const DUST_STREAM_LABEL = 0xd057;

/** Emission gate: one puff per this many metres travelled (ESTIMATE). */
const EMIT_INTERVAL_M = 1.4;
/** Spawn offset behind the rival, plus jitter (ESTIMATE, metres). */
const SPAWN_BACK_M = 0.9;
const SPAWN_BACK_JITTER_M = 0.25;
const SIDE_JITTER_M = 0.35;
/** Puffs seed this far above the terrain surface (ESTIMATE, metres). */
const SPAWN_HEIGHT_M = 0.12;
/** Fraction of the rival's speed thrown backwards, plus jitter (ESTIMATE). */
const THROW_FRACTION = 0.22;
const THROW_JITTER_MPS = 0.5;
const LATERAL_VEL_MPS = 0.7;
/** Initial upward drift and its gentle settle (ESTIMATE, m/s and m/s^2). */
const RISE_MIN_MPS = 0.45;
const RISE_MAX_MPS = 1.15;
const DUST_GRAVITY_MPS2 = 0.9;
/** Per-puff lifetime span (ESTIMATE, seconds). */
const LIFE_MIN_S = 0.75;
const LIFE_MAX_S = 1.3;
/** Puff half-width at birth and its growth factor over the lifetime (ESTIMATE). */
const SIZE_MIN_M = 0.22;
const SIZE_MAX_M = 0.34;
const GROW_MIN = 1.7;
const GROW_MAX = 2.4;
/** Vertex-colour brightness jitter, so the 12 quads do not read identical. */
const BRIGHTNESS_MIN = 0.84;
const BRIGHTNESS_MAX = 1.0;
/** Alpha ramp: brief fade-in, power fade-out, peak opacity (ESTIMATE). */
const FADE_IN_FRACTION = 0.18;
const FADE_OUT_POWER = 1.4;
const PEAK_ALPHA = 0.5;
/**
 * Documented fallback only, if the style layer returns a malformed hex. §4
 * names terrainShade as the dirt reference colour, so its authored value
 * (#8A6A4F) is the stand-in; no other hex is hardcoded here.
 */
const FALLBACK_DIRT_HEX = 0x8a6a4f;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Reads `#RRGGBB`, or `fallback` when the style layer returned something else. */
function readHex6(hex: string, fallback: number): number {
  return HEX6.test(hex) ? Number.parseInt(hex.slice(1), 16) : fallback;
}

/**
 * One frame of rival + camera state, primitive-only so `update()` can consume
 * it without allocating.
 */
export interface DustMotion {
  /** Rival position on the plan-view plane (metres). */
  readonly x: number;
  readonly z: number;
  /**
   * Rival heading in radians. Direction of travel is (sin h, 0, cos h) — the
   * kick-up is placed opposite to it.
   */
  readonly headingRad: number;
  /** Rival speed along its heading (m/s). 0 or less parks the emitter. */
  readonly speedMps: number;
  /**
   * Camera position on the plan-view plane. Only x/z are read: puffs are yaw
   * billboards, so they need the camera's horizontal bearing, not its height.
   */
  readonly camX: number;
  readonly camZ: number;
}

export interface DustFieldOptions {
  /** World seed. Dust derives its own stream from it and shares it with nobody. */
  seed: number;
  /** Style source for the puff colour; no palette value is hardcoded here. */
  colors: ColorSource;
  /** Height source: puffs seed at the terrain surface under the spawn point. */
  terrain: ITerrainSource;
}

export interface DustField {
  /** The single draw item; add it to the scene once. */
  readonly mesh: Mesh;
  /** Ring-buffer capacity in quads (== BUDGET.dustQuads). */
  readonly capacity: number;
  /** Triangles in the single buffer (capacity x 2). */
  readonly triangleCount: number;
  /** Emission events since construction (monotonic; the ring wraps under it). */
  readonly spawnsTotal: number;
  /** Slots currently alive (age < life). */
  readonly liveCount: number;
  /** Spawns that overwrote a still-alive slot — the ring never grows instead. */
  readonly overwrites: number;
  /** Next ring slot to be written (0..capacity-1). */
  readonly nextIndex: number;
  readonly enabled: boolean;
  /** The ladder cut (§5). Disabling hides the mesh and skips `update()`. */
  setEnabled(enabled: boolean): void;
  update(dtS: number, motion: DustMotion): void;
  dispose(): void;
}

/**
 * Creates the dust field. Deterministic for a given seed and input sequence;
 * every per-frame write happens in place.
 */
export function createDustField(options: DustFieldOptions): DustField {
  const terrain = options.terrain;
  const rng = createRng(hashSeed(options.seed, DUST_STREAM_LABEL));

  // --- preallocated particle records (struct of arrays) --------------------
  // `alive[i] === 0` means the quad is collapsed and invisible.
  const px = new Float32Array(CAP);
  const py = new Float32Array(CAP);
  const pz = new Float32Array(CAP);
  const vx = new Float32Array(CAP);
  const vy = new Float32Array(CAP);
  const vz = new Float32Array(CAP);
  const age = new Float32Array(CAP);
  const life = new Float32Array(CAP);
  const size0 = new Float32Array(CAP);
  const size1 = new Float32Array(CAP);
  const brightness = new Float32Array(CAP);
  const alive = new Uint8Array(CAP);

  // --- one buffer: CAP quads x 6 vertices --------------------------------
  const positionArray = new Float32Array(CAP * 6 * 3); // 216 floats = 24 triangles
  const colourArray = new Float32Array(CAP * 6 * 4); // vec4 colours: per-puff alpha

  const positionAttr = new BufferAttribute(positionArray, 3);
  positionAttr.setUsage(DynamicDrawUsage);
  const colourAttr = new BufferAttribute(colourArray, 4);
  colourAttr.setUsage(DynamicDrawUsage);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('color', colourAttr);

  const material = new MeshBasicMaterial({
    transparent: true, // alpha-blended puffs; §5 notes the overdraw this costs
    depthWrite: false, // puffs must not occlude each other
    side: DoubleSide, // a yaw billboard stays visible if the camera swings past
    vertexColors: true, // vec4 attribute => per-vertex alpha (three >= r152)
  });
  material.color.setHex(readHex6(options.colors.palette('terrainLit'), FALLBACK_DIRT_HEX));
  material.name = 'dustSprite';

  const mesh = new Mesh(geometry, material);
  mesh.name = 'dustSprites';
  // The field follows the rival over the whole track; a bounding sphere baked
  // at the origin would cull it wrongly.
  mesh.frustumCulled = false;

  // --- mutable state (no allocation after construction) -------------------
  let enabledState = true;
  let cursor = 0;
  let spawns = 0;
  let overwriteCount = 0;
  let distanceSinceEmit = 0;
  let dirty = false;

  function collapseQuad(i: number): void {
    const p = i * 18;
    for (let k = 0; k < 18; k++) {
      positionArray[p + k] = 0;
    }
    const c = i * 24;
    for (let k = 0; k < 24; k++) {
      colourArray[c + k] = 0;
    }
  }

  /**
   * Rewrites one quad from its analytic state at `a` seconds of age. All math
   * is closed-form in `a`, so no integration error accumulates.
   */
  function writeQuad(i: number, a: number, motion: DustMotion): void {
    // Decay: normalised age drives growth (linear) and alpha (fade-in, then a
    // power fade-out).
    const t = a / life[i];
    const half = size0[i] + (size1[i] - size0[i]) * t;
    const fadeIn = t < FADE_IN_FRACTION ? t / FADE_IN_FRACTION : 1;
    const fadeOut = (1 - t) ** FADE_OUT_POWER;
    const alpha = PEAK_ALPHA * fadeIn * fadeOut;

    const x = px[i] + vx[i] * a;
    const y = py[i] + vy[i] * a - 0.5 * DUST_GRAVITY_MPS2 * a * a;
    const z = pz[i] + vz[i] * a;

    // Yaw billboard around world up: the quad's plane faces the camera.
    const bdx = motion.camX - x;
    const bdz = motion.camZ - z;
    const len = Math.sqrt(bdx * bdx + bdz * bdz);
    let rx = 1;
    let rz = 0;
    if (len > 1e-6) {
      rx = bdz / len;
      rz = -bdx / len;
    }
    const x0 = x - rx * half;
    const z0 = z - rz * half;
    const x1 = x + rx * half;
    const z1 = z + rz * half;
    const y1 = y + 2 * half; // puffs stand on the spawn height and grow up

    // Two triangles, six vertices, written into the preallocated array.
    const p = i * 18;
    positionArray[p] = x0; positionArray[p + 1] = y; positionArray[p + 2] = z0;
    positionArray[p + 3] = x1; positionArray[p + 4] = y; positionArray[p + 5] = z1;
    positionArray[p + 6] = x1; positionArray[p + 7] = y1; positionArray[p + 8] = z1;
    positionArray[p + 9] = x0; positionArray[p + 10] = y; positionArray[p + 11] = z0;
    positionArray[p + 12] = x1; positionArray[p + 13] = y1; positionArray[p + 14] = z1;
    positionArray[p + 15] = x0; positionArray[p + 16] = y1; positionArray[p + 17] = z0;

    const glow = brightness[i];
    const c = i * 24;
    for (let v = 0; v < 6; v++) {
      const o = c + v * 4;
      colourArray[o] = glow;
      colourArray[o + 1] = glow;
      colourArray[o + 2] = glow;
      colourArray[o + 3] = alpha;
    }
    dirty = true;
  }

  function emit(motion: DustMotion): void {
    // Fixed draw order (10 values) — the determinism contract of this stream.
    const back = SPAWN_BACK_M + rng.range(-SPAWN_BACK_JITTER_M, SPAWN_BACK_JITTER_M);
    const side = rng.signed(SIDE_JITTER_M);
    const throwJitter = rng.range(0, THROW_JITTER_MPS);
    const lateral0 = rng.signed(LATERAL_VEL_MPS);
    const lateral1 = rng.signed(LATERAL_VEL_MPS);
    const rise = rng.range(RISE_MIN_MPS, RISE_MAX_MPS);
    const lifetime = rng.range(LIFE_MIN_S, LIFE_MAX_S);
    const birth = rng.range(SIZE_MIN_M, SIZE_MAX_M);
    const growth = rng.range(GROW_MIN, GROW_MAX);
    const glow = rng.range(BRIGHTNESS_MIN, BRIGHTNESS_MAX);

    const heading = motion.headingRad;
    const dirX = Math.sin(heading);
    const dirZ = Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);

    // Behind the rival: opposite the heading, plus lateral jitter, seeded on
    // the terrain surface (plan-view positions carry no height).
    const sx = motion.x - dirX * back + rightX * side;
    const sz = motion.z - dirZ * back + rightZ * side;

    const i = cursor;
    if (alive[i] !== 0) {
      overwriteCount++;
    }
    px[i] = sx;
    py[i] = terrain.heightAt(sx, sz) + SPAWN_HEIGHT_M;
    pz[i] = sz;
    const thrownBack = motion.speedMps * THROW_FRACTION + throwJitter;
    vx[i] = -dirX * thrownBack + rightX * lateral0;
    vz[i] = -dirZ * thrownBack + rightZ * lateral1;
    vy[i] = rise;
    age[i] = 0;
    life[i] = lifetime;
    size0[i] = birth;
    size1[i] = birth * growth;
    brightness[i] = glow;
    alive[i] = 1;
    writeQuad(i, 0, motion); // born at age 0, already coherent in the buffer
    spawns++;
    cursor = (i + 1) % CAP;
  }

  function update(dtS: number, motion: DustMotion): void {
    if (!enabledState) {
      return; // the ladder cut: no state change, no work, no throw
    }

    // 1) Age and rewrite the existing puffs.
    for (let i = 0; i < CAP; i++) {
      if (alive[i] === 0) {
        continue;
      }
      const a = age[i] + dtS;
      if (a >= life[i]) {
        alive[i] = 0;
        collapseQuad(i);
        dirty = true;
        continue;
      }
      age[i] = a;
      writeQuad(i, a, motion);
    }

    // 2) Emit new puffs, distance-gated so spacing stays constant across frame
    // rates. `speed <= 0` parks the emitter.
    const speed = motion.speedMps;
    if (speed > 0) {
      distanceSinceEmit += speed * dtS;
      while (distanceSinceEmit >= EMIT_INTERVAL_M) {
        distanceSinceEmit -= EMIT_INTERVAL_M;
        emit(motion);
      }
    }

    // 3) Flush the two attributes once, only if something was written.
    if (dirty) {
      positionAttr.needsUpdate = true;
      colourAttr.needsUpdate = true;
      dirty = false;
    }
  }

  return {
    mesh,
    get capacity(): number {
      return CAP;
    },
    get triangleCount(): number {
      return CAP * 2;
    },
    get spawnsTotal(): number {
      return spawns;
    },
    get liveCount(): number {
      let n = 0;
      for (let i = 0; i < CAP; i++) {
        if (alive[i] !== 0) {
          n++;
        }
      }
      return n;
    },
    get overwrites(): number {
      return overwriteCount;
    },
    get nextIndex(): number {
      return cursor;
    },
    get enabled(): boolean {
      return enabledState;
    },
    setEnabled(next: boolean): void {
      enabledState = next;
      mesh.visible = next;
    },
    update,
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
