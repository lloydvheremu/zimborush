/**
 * Deterministic scripted fly-through camera rig (design doc §12).
 *
 * The rig is a *pure function of elapsed time*: `update(camera, t)` always
 * produces the same pose for the same `t`, with no internal accumulation and
 * no randomness. Bench steps that compare rendering output (design steps 4, 5,
 * 9) can therefore drive the same camera path every run.
 *
 * Path model
 * ----------
 * - The camera rides the road spline at a fixed arc-length speed:
 *   `speedMps = spline.lengthM / loopSeconds` (default loop: 60 s).
 * - Plan-view XZ comes from `spline.pointAt(s)`; world height is
 *   `terrain.heightAt(x, z) + eyeHeightM` (pointAt returns y = 0).
 * - The look-at point is a *fixed arc-length look-ahead* of `lookAheadM`
 *   metres along the same spline (independent of speed), raised to terrain
 *   height + `eyeHeightM` + `lookAheadLiftM`.
 * - `elapsed` wraps modulo the loop period, so t > loopSeconds (or negative t)
 *   re-enters the same path seamlessly.
 *
 * Determinism / allocation
 * ------------------------
 * Every intermediate lives in rig-local scratch objects allocated once at
 * factory time; `update` and `sampleInto` write into caller-owned objects or
 * into the camera and allocate no objects, arrays or closures.
 *
 * Usage from the orchestrator (main.ts) — pin quality via URL params:
 *
 * ```ts
 * const rig = createFlyRig(road, terrain, {
 *   loopSeconds: Number(url.searchParams.get('loop') ?? 60),
 *   lookAheadM: Number(url.searchParams.get('look') ?? 18),
 * });
 * // per frame:
 * rig.update(camera, clock.getElapsedTime());
 * ```
 */

import type { PerspectiveCamera } from 'three';

/** Minimal plan-view point shape (`{ x, y, z }`), shared with the track sources. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Structural subset of `ISplineSource` required by the rig. */
export interface FlySplineSource {
  /** Total arc length of the (closed) spline in metres. */
  readonly lengthM: number;
  /** Plan-view position at arc length `s` (metres); `y` is 0 (terrain-relative). */
  pointAt(s: number, out: Vec3Like): void;
}

/** Structural subset of `ITerrainSource` required by the rig. */
export interface FlyTerrainSource {
  /** Ground height in metres at world `(x, z)`. */
  heightAt(x: number, z: number): number;
}

/** Rig tuning. All values are fixed at construction time. */
export interface FlyRigOptions {
  /** Seconds for one full loop around the closed spline. Default 60. */
  loopSeconds?: number;
  /** Camera height above the terrain surface, metres. Default 2.2. */
  eyeHeightM?: number;
  /** Fixed look-ahead arc length along the spline, metres. Default 18. */
  lookAheadM?: number;
  /** Extra height of the look-at point above the terrain, metres. Default 0. */
  lookAheadLiftM?: number;
}

/** Read-only view of the resolved rig parameters plus the pose samplers. */
export interface FlyRig {
  /** Seconds per full loop. */
  readonly loopSeconds: number;
  /** Ground speed along the spline, m/s (= `lengthM / loopSeconds`). */
  readonly speedMps: number;
  /** Fixed look-ahead arc length, metres. */
  readonly lookAheadM: number;
  /** Camera height above terrain, metres. */
  readonly eyeHeightM: number;
  /** Spline arc length of one loop, metres. */
  readonly loopLengthM: number;
  /** Arc-length position for `elapsedSeconds`, wrapped into `[0, loopLengthM)`. */
  arcLengthAt(elapsedSeconds: number): number;
  /** Writes world-space camera position and look-at target into caller-owned objects. */
  sampleInto(elapsedSeconds: number, outPos: Vec3Like, outLookAt: Vec3Like): void;
  /** Applies the pose for `elapsedSeconds` to `camera` (position + look-at orientation). */
  update(camera: PerspectiveCamera, elapsedSeconds: number): void;
}

const DEFAULT_LOOP_SECONDS = 60;
const DEFAULT_EYE_HEIGHT_M = 2.2;
const DEFAULT_LOOK_AHEAD_M = 18;
const DEFAULT_LOOK_AHEAD_LIFT_M = 0;

/**
 * Creates a deterministic fly-through rig over `spline` using `terrain` for
 * world height.
 */
export function createFlyRig(
  spline: FlySplineSource,
  terrain: FlyTerrainSource,
  opts: FlyRigOptions = {},
): FlyRig {
  const loopLengthM = spline.lengthM;
  const loopSeconds = opts.loopSeconds ?? DEFAULT_LOOP_SECONDS;
  const eyeHeightM = opts.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
  const lookAheadM = opts.lookAheadM ?? DEFAULT_LOOK_AHEAD_M;
  const lookAheadLiftM = opts.lookAheadLiftM ?? DEFAULT_LOOK_AHEAD_LIFT_M;

  if (!(loopLengthM > 0)) {
    throw new Error('createFlyRig: spline.lengthM must be > 0');
  }
  if (!(loopSeconds > 0)) {
    throw new Error('createFlyRig: loopSeconds must be > 0');
  }
  if (!(lookAheadM >= 0 && lookAheadM < loopLengthM)) {
    throw new Error('createFlyRig: lookAheadM must be within [0, lengthM)');
  }

  const speedMps = loopLengthM / loopSeconds;

  // Rig-local scratch: allocated once here, reused by every call.
  const posScratch: Vec3Like = { x: 0, y: 0, z: 0 };
  const lookScratch: Vec3Like = { x: 0, y: 0, z: 0 };

  function arcLengthAt(elapsedSeconds: number): number {
    let s = (elapsedSeconds * speedMps) % loopLengthM;
    if (s < 0) s += loopLengthM;
    return s;
  }

  function evalPose(elapsedSeconds: number): void {
    const s = arcLengthAt(elapsedSeconds);

    let st = s + lookAheadM;
    if (st >= loopLengthM) st -= loopLengthM;

    spline.pointAt(s, posScratch);
    posScratch.y = terrain.heightAt(posScratch.x, posScratch.z) + eyeHeightM;

    spline.pointAt(st, lookScratch);
    lookScratch.y = terrain.heightAt(lookScratch.x, lookScratch.z) + eyeHeightM + lookAheadLiftM;
  }

  function sampleInto(elapsedSeconds: number, outPos: Vec3Like, outLookAt: Vec3Like): void {
    evalPose(elapsedSeconds);
    outPos.x = posScratch.x;
    outPos.y = posScratch.y;
    outPos.z = posScratch.z;
    outLookAt.x = lookScratch.x;
    outLookAt.y = lookScratch.y;
    outLookAt.z = lookScratch.z;
  }

  function update(camera: PerspectiveCamera, elapsedSeconds: number): void {
    evalPose(elapsedSeconds);
    camera.position.set(posScratch.x, posScratch.y, posScratch.z);
    camera.lookAt(lookScratch.x, lookScratch.y, lookScratch.z);
  }

  return {
    loopSeconds,
    speedMps,
    lookAheadM,
    eyeHeightM,
    loopLengthM,
    arcLengthAt,
    sampleInto,
    update,
  };
}
