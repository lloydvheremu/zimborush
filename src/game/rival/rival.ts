/**
 * Rival rider — step 7, design doc §11.
 *
 * The rival follows the road spline with a curvature-based speed profile and a
 * ±8% rubber-band against the player (both ESTIMATE, design doc §11). It emits
 * the same `RiderInput` struct a networked player would send, so a future
 * multiplayer path can swap the AI for a received packet without changing the
 * simulation that consumes it.
 *
 * Determinism: the only randomness is `createRng(hashSeed(seed,
 * RIVAL_STREAM_TAG))` — one lane bias per instance (design rule: no
 * `Math.random`). Everything else is a pure function of arc length.
 *
 * Frame discipline: `update` allocates nothing. It writes its pose into a
 * caller-owned `RivalPose` and its commands into the `input` struct it owns;
 * every scratch value (the curvature table included) is built once in
 * `createRival`.
 */
import { createRng, hashSeed } from '../../core/rng';
import type { ISplineSource, ITerrainSource } from '../../world/contracts';

/** RNG stream tag; keeps rival draws independent of the road/terrain streams. */
const RIVAL_STREAM_TAG = 0x7a11;

/** Rubber-band cap: speed is biased by at most ±8% (design doc §11, ESTIMATE). */
export const RUBBER_BAND_FRACTION = 0.08;

/**
 * Progress gap that saturates the rubber-band: with the player this many
 * metres ahead the bias is +8%; behind, −8% (ESTIMATE).
 */
export const RUBBER_BAND_REFERENCE_GAP_M = 40;

/** Straight-line speed ceiling, m/s (~120 km/h, ESTIMATE). */
export const RIVAL_MAX_SPEED_MPS = 33.3;

/**
 * Corner speed profile: `v = sqrt(aLat / |k|)` — the constant-lateral-acceleration
 * cornering limit (design doc §11 "curvature-based speed profile", ESTIMATE).
 */
export const RIVAL_CORNER_LAT_ACCEL_MPS2 = 6;

/** Deceleration the look-ahead brake plan assumes, m/s² (ESTIMATE). */
export const RIVAL_BRAKE_DECEL_MPS2 = 6;

/** First-order speed lag time constant, s (ESTIMATE). */
export const RIVAL_SPEED_LAG_S = 0.35;

/** Speed floor so the rival never stalls mid-lap, m/s (ESTIMATE). */
export const RIVAL_SPEED_FLOOR_MPS = 2;

/** Pose-origin clearance above the analytic terrain, m (ESTIMATE). */
export const RIDE_HEIGHT_M = 0.02;

/** Lane bias draw magnitude, m — keeps the rival off dead centre (ESTIMATE). */
const LANE_BIAS_M = 0.5;

/** Slow deterministic lane weave, m amplitude and metres per cycle (ESTIMATE). */
const WEAVE_AMPLITUDE_M = 0.35;
const WEAVE_WAVELENGTH_M = 90;

/** Curvature is sampled into a table at build time at this step, metres. */
const CURVATURE_TABLE_STEP_M = 0.5;

/** Floor on |k| so a straight gives a finite (then capped) target speed. */
const CURVATURE_FLOOR_PER_M = 1e-3;

/** Look-ahead window/step of the brake plan, metres. */
const BRAKE_LOOKAHEAD_M = 60;
const BRAKE_LOOKAHEAD_STEP_M = 4;

/** Visual lean cap, rad (ESTIMATE). */
const MAX_LEAN_RAD = 0.5;

/** Pitch probe half-span along the tangent, metres. */
const PITCH_PROBE_M = 1.5;

/** Steer readout scale: steer = clamp(−k × gain, ±1) (ESTIMATE). */
const RIVAL_STEER_GAIN_PER_M = 12;

const TAU = Math.PI * 2;
const GRAVITY_MPS2 = 9.81;

/**
 * Commands for one rider — the struct a networked peer's packet would carry.
 * `createRival` fills one of these every `update`, so the AI and a remote
 * player are interchangeable at the seam.
 */
export interface RiderInput {
  /** 0..1. */
  throttle: number;
  /** 0..1. */
  brake: number;
  /** −1..1; positive steers right. */
  steer: number;
  /** −1..1; positive leans right. */
  lean: number;
}

/** Rival state for one simulation step; written into a caller-owned object. */
export interface RivalPose {
  x: number;
  y: number;
  z: number;
  /** Heading around +Y, rad; 0 faces +X. */
  headingRad: number;
  /** Nose-up pitch from the terrain grade, rad. */
  pitchRad: number;
  /** Lean into the current curvature, rad; positive leans right. */
  leanRad: number;
  speedMps: number;
  /** Arc length along the lap in metres, in [0, lengthM). */
  progressM: number;
}

export interface Rival {
  /** Command packet produced by the AI; same shape as a networked player's. */
  readonly input: RiderInput;
  /** Current arc length along the lap, metres in [0, lengthM). */
  readonly progressM: number;
  /**
   * Rubber-band factor for a player progress position, clamped to
   * 1 ± `RUBBER_BAND_FRACTION`.
   */
  rubberBandFactor(playerProgressM: number): number;
  /** Place the rival on the lap again (restart). */
  reset(atProgressM: number, initialSpeedMps?: number): void;
  /** Advance one fixed step; pose is written into `out`. No allocation. */
  update(dt: number, playerProgressM: number, out: RivalPose): RivalPose;
}

export function createRival(seed: number, road: ISplineSource, terrain: ITerrainSource): Rival {
  const lengthM = road.lengthM;

  // One deterministic lane bias per instance (design rule: seeded RNG only).
  const rng = createRng(hashSeed(seed, RIVAL_STREAM_TAG));
  const laneBiasM = rng.signed(LANE_BIAS_M);

  // Curvature table: built once (design doc §11 profile needs many look-ahead
  // samples per tick; sampling the accessor per tick would repeat work).
  const tableCount = Math.max(1, Math.round(lengthM / CURVATURE_TABLE_STEP_M));
  const curvatureTable = new Float64Array(tableCount);
  for (let i = 0; i < tableCount; i++) {
    curvatureTable[i] = road.curvatureAt((i * lengthM) / tableCount);
  }

  // Scratch vectors and state: allocated once, mutated forever.
  const pointScratch = { x: 0, y: 0, z: 0 };
  const tangentScratch = { x: 0, y: 0, z: 0 };
  const input: RiderInput = { throttle: 0, brake: 0, steer: 0, lean: 0 };

  let progressM = 0;
  let speedMps = RIVAL_MAX_SPEED_MPS * 0.5;

  const wrap = (s: number): number => ((s % lengthM) + lengthM) % lengthM;

  /** Signed curvature at arc length `s` via the table (wrapped). */
  const curvatureLookup = (s: number): number => {
    const idx = Math.floor((wrap(s) / lengthM) * tableCount);
    return curvatureTable[idx < tableCount ? idx : tableCount - 1];
  };

  /** `v = sqrt(aLat / |k|)`, capped (design doc §11 profile). */
  const cornerSpeedMps = (k: number): number =>
    Math.min(
      RIVAL_MAX_SPEED_MPS,
      Math.sqrt(RIVAL_CORNER_LAT_ACCEL_MPS2 / Math.max(Math.abs(k), CURVATURE_FLOOR_PER_M)),
    );

  /**
   * Curvature-based target speed with a look-ahead brake plan: over the next
   * `BRAKE_LOOKAHEAD_M`, the speed allowed now at distance `d` from a corner
   * with limit `vc` is `sqrt(vc² + 2·aBrake·d)`.
   */
  const planSpeedMps = (s: number): number => {
    let target = RIVAL_MAX_SPEED_MPS;
    for (let d = 0; d <= BRAKE_LOOKAHEAD_M; d += BRAKE_LOOKAHEAD_STEP_M) {
      const vc = cornerSpeedMps(curvatureLookup(s + d));
      const allowed = Math.sqrt(vc * vc + 2 * RIVAL_BRAKE_DECEL_MPS2 * d);
      if (allowed < target) target = allowed;
    }
    return target;
  };

  const rubberBandFactor = (playerProgressM: number): number => {
    // Wrap-aware signed gap, so a player 1 m behind the seam is not read as a
    // lap ahead; then the ±8% clamp (design doc §11, ESTIMATE).
    let gap = ((playerProgressM - progressM) % lengthM + lengthM) % lengthM;
    if (gap > lengthM / 2) gap -= lengthM;
    const factor = 1 + (gap / RUBBER_BAND_REFERENCE_GAP_M) * RUBBER_BAND_FRACTION;
    return Math.min(1 + RUBBER_BAND_FRACTION, Math.max(1 - RUBBER_BAND_FRACTION, factor));
  };

  const reset = (atProgressM: number, initialSpeedMps = RIVAL_MAX_SPEED_MPS * 0.5): void => {
    progressM = wrap(atProgressM);
    speedMps = Math.min(RIVAL_MAX_SPEED_MPS, Math.max(RIVAL_SPEED_FLOOR_MPS, initialSpeedMps));
  };

  const update = (dt: number, playerProgressM: number, out: RivalPose): RivalPose => {
    const factor = rubberBandFactor(playerProgressM);
    const goal = Math.min(
      RIVAL_MAX_SPEED_MPS * (1 + RUBBER_BAND_FRACTION),
      Math.max(RIVAL_SPEED_FLOOR_MPS, planSpeedMps(progressM) * factor),
    );
    // First-order lag so the profile is followed smoothly, never snapped.
    if (dt > 0) {
      const alpha = dt < RIVAL_SPEED_LAG_S ? dt / RIVAL_SPEED_LAG_S : 1;
      speedMps += (goal - speedMps) * alpha;
    }
    progressM = wrap(progressM + speedMps * dt);

    const k = curvatureLookup(progressM);
    const point = road.pointAt(progressM, pointScratch);
    const tangent = road.tangentAt(progressM, tangentScratch);

    // Plan-view lane offset: seeded bias plus a slow deterministic weave.
    const laneOffsetM =
      laneBiasM + WEAVE_AMPLITUDE_M * Math.sin((progressM / WEAVE_WAVELENGTH_M) * TAU);
    const perpX = -tangent.z;
    const perpZ = tangent.x;
    const x = point.x + perpX * laneOffsetM;
    const z = point.z + perpZ * laneOffsetM;
    // y is the analytic terrain height plus the fixed ride height (frozen
    // semantic: `pointAt` is plan-view, y = 0).
    const y = terrain.heightAt(x, z) + RIDE_HEIGHT_M;

    const hAhead = terrain.heightAt(x + tangent.x * PITCH_PROBE_M, z + tangent.z * PITCH_PROBE_M);
    const hBehind = terrain.heightAt(x - tangent.x * PITCH_PROBE_M, z - tangent.z * PITCH_PROBE_M);
    const leanUnclamped = Math.atan((speedMps * speedMps * k) / GRAVITY_MPS2);

    out.x = x;
    out.y = y;
    out.z = z;
    out.headingRad = Math.atan2(tangent.z, tangent.x);
    out.pitchRad = Math.atan((hAhead - hBehind) / (2 * PITCH_PROBE_M));
    out.leanRad = Math.max(-MAX_LEAN_RAD, Math.min(MAX_LEAN_RAD, leanUnclamped));
    out.speedMps = speedMps;
    out.progressM = progressM;

    // Command readout, same shape a network packet would use. Heading grows
    // with +k (counter-clockwise in plan view), so following +k needs negative
    // (left-side) steer under the "positive steers right" convention.
    input.throttle = goal > speedMps ? 1 : 0;
    input.brake = goal < speedMps - 0.05 ? 1 : 0;
    input.steer = Math.max(-1, Math.min(1, -k * RIVAL_STEER_GAIN_PER_M));
    input.lean = out.leanRad / MAX_LEAN_RAD;
    return out;
  };

  reset(0);

  return {
    input,
    get progressM(): number {
      return progressM;
    },
    rubberBandFactor,
    reset,
    update,
  };
}
