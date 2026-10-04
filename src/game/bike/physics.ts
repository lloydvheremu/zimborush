/**
 * Arcade bike physics — design doc §11: "2D position, heading, speed, lean; y
 * from the analytic heightfield; grip/accel penalties off-road; 2D circle
 * collisions with props".
 *
 * Model. The bike is a point mass on the plan view. Heading, speed, lean and a
 * slip angle are integrated; `y` is derived every step as
 * `terrain.heightAt(x, z) + RIDE_HEIGHT_M`, so the ground can never disagree
 * with the terrain mesh (task 7) or the road mesh (task 8) — all three read the
 * one field from `createHeightfield`. `lean` is the bike's sway about the
 * contact line (the camera rig's roll source) and `yawRate` is its yaw rate
 * (the camera's damping input), so the camera consumes state this module
 * already owns instead of a second integration. `slide` is the slip angle
 * between where the bike points and where it travels: turning winds it up,
 * grip bleeds it off, so dirt (low grip) visibly drifts.
 *
 * Timebase (design doc §8): the sim is FIXED 60 Hz and the renderer
 * interpolates between the previous and current snapshots. `step` therefore
 * integrates with its own constant `FIXED_DT`; it does not read the `dt`
 * argument, never clamps it and never scales by it. The argument exists to
 * make the contract observable: a `dt` other than `FIXED_DT` is reported once
 * via console and ignored — the state is left untouched and `stepCount` does
 * not advance. Per-step, `dt` is passed to nothing.
 *
 * Update equations (explicit Euler, one step from the previous snapshot):
 *     steer    = moveTowards(steer, clamp(input.steer, -1, 1) * MAX_STEER_RAD, STEER_RATE_RADPS * FIXED_DT)
 *     yaw      = clamp(kinematic(speed, steer), ±YAW_RATE_PER_STEER)          // rad/s
 *     heading' = wrapPi(heading + yaw * FIXED_DT)
 *     slide'   = clamp(slide + yaw * FIXED_DT - slide * min(1, grip * FIXED_DT), ±SLIP_MAX_RAD)
 *     speed'   = clamp(speed + accel(speed, input, surface) * FIXED_DT, -MAX_REVERSE_MPS, surface max)
 *     x'       = x + cos(heading' - slide') * speed' * FIXED_DT
 *     z'       = z + sin(heading' - slide') * speed' * FIXED_DT
 *     y'       = terrain.heightAt(x', z') + RIDE_HEIGHT_M
 *     lean'    = clamp(lean + (speed' * yaw / GRAVITY_MPS2 - lean) * min(1, response * FIXED_DT), ±MAX_LEAN_RAD)
 * `accel` is `surfaceAccel * throttle * (1 - speed / surfaceMax) - coast - brake`;
 * `surfaceAccel` and `surfaceMax` are 0.4x and 0.30x of on-road off-road, and
 * `grip` is 0.45x — the §11 off-road penalties. All of it is arithmetic on
 * numbers: no wall clock, no `Math.random`, no frame history, so identical
 * initial state + identical input sequence give bit-identical snapshots.
 *
 * Snapshots. The instance owns exactly two snapshot objects and alternates
 * (`state()` is the one just written, `previous()` one step older) plus a few
 * scratch vectors for the track accessors. `step`, `state`, `previous` and
 * `interpolate` allocate no objects, arrays or closures: the snapshot pair is
 * mutated in place and `interpolate` (re-exported from `./state`) writes into
 * a caller-owned pose that reads both. Allocating a `BikePhysics` is allowed —
 * instances are built at load, not per frame. The factory's one closure is the
 * per-instance `interpolate` method, created when the instance is.
 *
 * Road stickiness. While latched (`roadLatched`), a local search around the
 * last `roadS` locates the nearest centreline sample; staying within
 * `halfWidthAt(s) + ROAD_STICKY_MARGIN_M` keeps the latch, so curvature and
 * the 1 m sample pitch cannot eject the bike at speed. Leaving that band
 * releases the latch and a two-stage global scan (64 coarse samples, then a
 * refine pass) re-acquires the real nearest sample anywhere on the loop — so a
 * deliberate excursion stays correctly measured and rejoining latches again
 * when the bike is back inside the half width. `offRoad` is always the
 * distance to that nearest sample minus the half width, >= 0.
 *
 * Collisions. Props arrive at step 8 as plan-view circles; an empty list (the
 * only case at step 6) is valid and costs one call. Each hit pushes the bike
 * out along the radial and reflects the inward radial speed with
 * `PROP_RESTITUTION`. With no props the corridor's own limit is physical: the
 * terrain is only defined over the heightfield bounds, so a step whose target
 * leaves them is projected back to the edge by shrinking that step (a no-op
 * at these speeds and step sizes).
 */

import type { ISplineSource, ITerrainSource, Vec3Mut } from '../../world/contracts';
import {
  copySnapshot,
  interpolate as interpolatePose,
  wrapPi,
  type BikeInput,
  type BikeSnapshot,
  type InterpolatedPose,
} from './state';

export { createPose, interpolate, NEUTRAL_INPUT } from './state';
export type { BikeInput, BikeSnapshot, InterpolatedPose } from './state';

/** Fixed simulation step, seconds — 60 Hz, the only accepted `dt`. */
export const FIXED_DT = 1 / 60;

/** Engine drive at a standstill, m/s^2. */
export const ACCEL_A0_MPS2 = 14;

/** Top speed on the sealed road, m/s (100 km/h). */
export const ROAD_MAX_SPEED_MPS = 27.8;

/** Only this fraction of the on-road drive reaches a wheel in the dirt. */
export const OFFROAD_ACCEL_SCALE = 0.4;

/** Off-road top speed, m/s (30 km/h). */
export const OFFROAD_MAX_SPEED_MPS = 8.4;

/** Service-brake deceleration, m/s^2. */
export const BRAKE_MPS2 = 13.5;

/** Coasting losses with neither drive nor brake, m/s^2 (road / dirt). */
export const ENGINE_BRAKE_MPS2 = 1.8;
export const OFFROAD_COAST_MPS2 = 4.5;

/** Reverse-gear ceiling, m/s. */
export const MAX_REVERSE_MPS = 4;

/** Handlebars: full lock and how fast the input reaches it. */
export const MAX_STEER_RAD = 0.6;
export const STEER_RATE_RADPS = 6;

/** Lock shrinks to this fraction at STEER_FADE_SPEED_MPS and beyond. */
export const HIGH_SPEED_STEER_SCALE = 0.25;
export const STEER_FADE_SPEED_MPS = 14;

/** Pedal-bike wheelbase, metres — the crawl turn radius is WHEELBASE / tan(lock). */
export const WHEELBASE_M = 1.42;

/** Yaw ceiling, rad/s, and how strongly steer yaws with speed (ESTIMATE). */
export const YAW_RATE_PER_STEER = 6;
export const YAW_SPEED_COUPLING = 0.45;

/** Directional grip, 1/s: how fast the slip angle bleeds off (lower = sliddier). */
export const GRIP_ONROAD_PER_S = 12;

/** Dirt keeps 45% of the grip: the bike runs wide instead of turning. */
export const OFFROAD_GRIP_SCALE = 0.45;
export const GRIP_OFFROAD_PER_S = GRIP_ONROAD_PER_S * OFFROAD_GRIP_SCALE;

/** Slip angle is clamped here, rad — 34 degrees of sideways running. */
export const SLIP_MAX_RAD = 0.6;

/** Lean cap, rad, and its time constant, 1/s. */
export const MAX_LEAN_RAD = 0.7;
export const LEAN_RESPONSE_PER_S = 8;

/** Sway beyond this and against the turn gets the re-centre boost (rad, 1/s). */
export const LEAN_DEADBAND_RAD = (0.5 * Math.PI) / 180;
export const LEAN_RECENTER_GAIN = 6;

/** Gravity, m/s^2 — turns lateral acceleration into lean. */
export const GRAVITY_MPS2 = 9.81;

/** Contact-patch height above the ground, metres (wheel + tyre). */
export const RIDE_HEIGHT_M = 0.6;

/** Prop circle at the centre; the radius is distance, a conservative
 *  half-total — near side, far side, bike centre — off the other players. */
export const BIKE_RADIUS_M = 0.5;

/** Outward rebound per hit: 60% of the closing speed, rest absorbed (ESTIMATE). */
export const PROP_RESTITUTION = 0.6;

/** Hard cap on prop evaluations per step, even if `propAt` never ends. */
export const MAX_PROP_CHECKS = 4096;

/** Speed kept after a step is projected back inside the corridor bounds. */
export const CORRIDOR_IMPACT_SCALE = 0.5;

/** Stays latched this far past the road edge, metres; beyond it, re-acquire. */
export const ROAD_STICKY_MARGIN_M = 1.2;

/** Local centreline search: pitch and span around the last sample, metres. */
export const ROAD_LOCAL_STEP_M = 1;
export const ROAD_LOCAL_SPAN_M = 8;

/** Global re-acquire: coarse samples around the loop, then refine passes each side. */
export const ROAD_GLOBAL_SAMPLES = 64;
export const ROAD_GLOBAL_REFINE_STEPS = 8;

/** Nominal start point: arc length 0 on the centreline, road-aligned. */
export const DEFAULT_START_S = 0;

export interface BikePhysicsOptions {
  /** Plan-view start position; defaults to the road point at `startS`. */
  startX?: number;
  startZ?: number;
  /** Initial heading, radians; defaults to the road tangent at `startS`. */
  heading?: number;
  /** Initial speed along the heading, m/s. */
  speed?: number;
  /** Where on the closed loop a default start sits, metres. */
  startS?: number;
}

/** A static prop the bike can hit: a plan-view circle beside the road. */
export interface BikePropSource {
  /**
   * Writes the circle centre for `index` into `out` and returns its radius;
   * a radius <= 0 (or a missing index) ends the list. Called repeatedly until
   * it says stop, so a prop list is a generator, not a materialised array.
   */
  propAt(index: number, out: Vec3Mut): number;
}

export interface BikePhysics {
  /**
   * The two live snapshot records, in no order of its own: it is the pool
   * `state()` and `previous()` name, refreshed every step. Read-only to
   * callers; the objects are reused, so never hold one across a `step`.
   */
  readonly snapshots: readonly [BikeSnapshot, BikeSnapshot];
  /** Steps integrated so far; independent of how often `step` was called. */
  readonly stepCount: number;
  /** Puts the bike back on the road at the configured start. */
  reset(options?: BikePhysicsOptions): void;
  /**
   * One FIXED_DT tick. `dt` must equal FIXED_DT: the step integrates with its
   * own constant and the argument is never used in the equations, so a
   * mismatch is warned about once (console) and otherwise ignored. `props` may
   * be an empty list. `beforeStep` runs after the snapshot swap, immediately
   * before the integrate, and must not throw; it receives no arguments.
   */
  step(dt: number, input: BikeInput, props: BikePropSource, beforeStep?: () => void): BikeSnapshot;
  /** The snapshot written by the latest step — a live record, read only. */
  state(): BikeSnapshot;
  /** The snapshot one step older than `state()`: the other half of the pair. */
  previous(): BikeSnapshot;
  /** `interpolate(previous(), state(), alpha, out)`, bound to this pair. */
  interpolate(alpha: number, out: InterpolatedPose): InterpolatedPose;
}

/** Min/max clamp; every caller passes a finite sim-owned number. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** The list's terminator: any radius at or below this ends iteration. */
const PROP_LIST_END = 0;

export function createBikePhysics(
  terrain: ITerrainSource,
  road: ISplineSource,
  options?: BikePhysicsOptions,
): BikePhysics {
  const lengthM = road.lengthM > 0 ? road.lengthM : 0;

  const slotA: BikeSnapshot = {
    x: 0, y: 0, z: 0, heading: 0, speed: 0, lean: 0, steer: 0,
    roadS: 0, offRoad: 0, onRoad: false, slide: 0, yawRate: 0,
  };
  const slotB: BikeSnapshot = {
    x: 0, y: 0, z: 0, heading: 0, speed: 0, lean: 0, steer: 0,
    roadS: 0, offRoad: 0, onRoad: false, slide: 0, yawRate: 0,
  };

  let current: BikeSnapshot = slotA;
  let last: BikeSnapshot = slotB;
  /** Published as `snapshots`: [previous, state], refreshed in place. */
  const pool: [BikeSnapshot, BikeSnapshot] = [last, current];

  const scratchA: Vec3Mut = { x: 0, y: 0, z: 0 };
  const scratchB: Vec3Mut = { x: 0, y: 0, z: 0 };
  const scratchC: Vec3Mut = { x: 0, y: 0, z: 0 };

  let steps = 0;
  let warnedDt = false;
  /** True while the last search is trusted to be near the bike. */
  let roadLatched = true;
  /** Prop radius written next to the centre in scratchC by the scan. */
  let propRadius = BIKE_RADIUS_M;

  // Start point, resolved once and held so reset() with no options repeats it.
  let startS = options?.startS ?? DEFAULT_START_S;
  let startSpeed = options?.speed ?? 0;
  road.pointAt(startS, scratchB);
  road.tangentAt(startS, scratchA);
  let startX = options?.startX ?? scratchB.x;
  let startZ = options?.startZ ?? scratchB.z;
  let startHeading = options?.heading ?? Math.atan2(scratchA.z, scratchA.x);

  /**
   * Global re-acquire: nearest centreline sample anywhere on the loop. Coarse
   * pass over the whole length, then a refine pass around the coarse winner.
   * Writes the winner into `scratchB`; returns it through the shared fields.
   */
  let bestS = 0;
  let bestDistanceSq = Infinity;

  const searchLocal = (aroundS: number): void => {
    for (let offset = -ROAD_LOCAL_SPAN_M; offset <= ROAD_LOCAL_SPAN_M; offset += ROAD_LOCAL_STEP_M) {
      const t = aroundS + offset;
      road.pointAt(t, scratchB);
      const dx = current.x - scratchB.x;
      const dz = current.z - scratchB.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestS = t;
      }
    }
  };

  const searchGlobal = (): void => {
    if (lengthM <= 0) {
      return;
    }
    const coarseStep = lengthM / ROAD_GLOBAL_SAMPLES;
    let coarseS = 0;
    let coarseDistanceSq = Infinity;
    for (let t = 0; t < lengthM; t += coarseStep) {
      road.pointAt(t, scratchB);
      const dx = current.x - scratchB.x;
      const dz = current.z - scratchB.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < coarseDistanceSq) {
        coarseDistanceSq = distanceSq;
        coarseS = t;
      }
    }
    const refineStep = coarseStep / ROAD_GLOBAL_REFINE_STEPS;
    let refinedS = coarseS;
    let refinedDistanceSq = coarseDistanceSq;
    for (let k = -ROAD_GLOBAL_REFINE_STEPS; k <= ROAD_GLOBAL_REFINE_STEPS; k++) {
      const t = coarseS + k * refineStep;
      road.pointAt(t, scratchB);
      const dx = current.x - scratchB.x;
      const dz = current.z - scratchB.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < refinedDistanceSq) {
        refinedDistanceSq = distanceSq;
        refinedS = t;
      }
    }
    if (refinedDistanceSq < bestDistanceSq) {
      bestDistanceSq = refinedDistanceSq;
      bestS = refinedS;
    }
  };

  const reset = (resetOptions?: BikePhysicsOptions): void => {
    if (resetOptions !== undefined) {
      if (resetOptions.speed !== undefined) {
        startSpeed = resetOptions.speed;
      }
      if (resetOptions.startS !== undefined) {
        startS = resetOptions.startS;
      }
      road.pointAt(startS, scratchB);
      road.tangentAt(startS, scratchA);
      startX = resetOptions.startX ?? scratchB.x;
      startZ = resetOptions.startZ ?? scratchB.z;
      startHeading = resetOptions.heading ?? Math.atan2(scratchA.z, scratchA.x);
    }
    const snapshot = current;
    snapshot.x = startX;
    snapshot.z = startZ;
    snapshot.y = terrain.heightAt(startX, startZ) + RIDE_HEIGHT_M;
    snapshot.heading = wrapPi(startHeading);
    snapshot.speed = startSpeed;
    snapshot.lean = 0;
    snapshot.steer = 0;
    snapshot.roadS = startS;
    snapshot.offRoad = 0;
    snapshot.onRoad = true;
    snapshot.slide = 0;
    snapshot.yawRate = 0;
    copySnapshot(last, snapshot);
    pool[0] = last;
    pool[1] = current;
    roadLatched = true;
    steps = 0;
  };

  /** Reads one prop circle; the terminator check keeps an empty list free. */
  const readProp = (props: BikePropSource, index: number): boolean => {
    const radius = props.propAt(index, scratchC);
    if (!(radius > PROP_LIST_END)) {
      return false;
    }
    propRadius = radius;
    return true;
  };

  const collideProps = (props: BikePropSource): void => {
    if (props === null || typeof props !== 'object' || typeof props.propAt !== 'function') {
      return;
    }
    for (let index = 0; index <= MAX_PROP_CHECKS; index++) {
      if (!readProp(props, index)) {
        return;
      }
      const propX = scratchC.x;
      const propZ = scratchC.z;
      const dx = current.x - propX;
      const dz = current.z - propZ;
      const limit = propRadius + BIKE_RADIUS_M;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= limit * limit) {
        continue;
      }
      const distance = Math.sqrt(distanceSq);
      if (distance > 0) {
        const nx = dx / distance;
        const nz = dz / distance;
        current.x = propX + nx * limit;
        current.z = propZ + nz * limit;
        // The closing speed is the radial part of the travel; a glancing hit
        // barely scrubs, a square hit keeps (1 - PROP_RESTITUTION).
        const radial = Math.cos(current.heading) * nx + Math.sin(current.heading) * nz;
        current.speed *= 1 - PROP_RESTITUTION * radial * radial;
        current.slide *= PROP_RESTITUTION;
      } else {
        // Dead centre: push out behind and drop the speed; deterministic.
        current.x = propX;
        current.z = propZ - limit;
        current.speed *= 1 - PROP_RESTITUTION;
        current.slide *= PROP_RESTITUTION;
      }
    }
  };

  const step = (
    dt: number,
    input: BikeInput,
    props: BikePropSource,
    beforeStepHook?: () => void,
  ): BikeSnapshot => {
    if (dt !== FIXED_DT) {
      if (!warnedDt) {
        warnedDt = true;
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn(
            `[bike] step(${String(dt)}) ignored: the sim is fixed-step, call step(FIXED_DT)`,
          );
        }
      }
      return current;
    }

    const swap = current;
    current = last;
    last = swap;
    if (beforeStepHook !== undefined) {
      beforeStepHook();
    }

    // --- road assignment --------------------------------------------------
    bestDistanceSq = Infinity;
    if (roadLatched) {
      searchLocal(last.roadS);
    }
    let halfWidth = road.halfWidthAt(bestS);
    let distance = Math.sqrt(bestDistanceSq);
    if (!roadLatched || distance > halfWidth + ROAD_STICKY_MARGIN_M) {
      searchGlobal();
      distance = Math.sqrt(bestDistanceSq);
      halfWidth = road.halfWidthAt(bestS);
      roadLatched = distance <= halfWidth;
    }
    let roadS = bestS;
    if (lengthM > 0) {
      roadS %= lengthM;
      if (roadS < 0) {
        roadS += lengthM;
      }
    }
    current.roadS = roadS;
    current.offRoad = distance > halfWidth ? distance - halfWidth : 0;
    current.onRoad = distance <= halfWidth;

    // --- steering, yaw, slip ----------------------------------------------
    const steerInput = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
    const steerTarget = steerInput * MAX_STEER_RAD;
    const steerStep = STEER_RATE_RADPS * FIXED_DT;
    let steer = current.steer;
    if (steer < steerTarget) {
      steer = steer + steerStep < steerTarget ? steer + steerStep : steerTarget;
    } else if (steer > steerTarget) {
      steer = steer - steerStep > steerTarget ? steer - steerStep : steerTarget;
    }
    const speedAbs = Math.abs(last.speed);
    const highSpeedFade = clamp(1 - speedAbs / STEER_FADE_SPEED_MPS, HIGH_SPEED_STEER_SCALE, 1);
    const effectiveSteer = steer * highSpeedFade;
    const crawlRadius = WHEELBASE_M / Math.tan(MAX_STEER_RAD);
    const yawTarget = clamp(
      (last.speed / crawlRadius) * Math.tan(effectiveSteer) + last.speed * YAW_SPEED_COUPLING * effectiveSteer,
      -YAW_RATE_PER_STEER,
      YAW_RATE_PER_STEER,
    );
    const heading = wrapPi(last.heading + yawTarget * FIXED_DT);
    const gripPerS = current.onRoad ? GRIP_ONROAD_PER_S : GRIP_OFFROAD_PER_S;
    const grip = Math.min(1, gripPerS * FIXED_DT);
    const slide = clamp(last.slide + yawTarget * FIXED_DT - last.slide * grip, -SLIP_MAX_RAD, SLIP_MAX_RAD);

    // --- drive, brakes, surface penalties ---------------------------------
    const throttle = Number.isFinite(input.throttle) ? clamp(input.throttle, 0, 1) : 0;
    const brake = Number.isFinite(input.brake) ? clamp(input.brake, 0, 1) : 0;
    const surfaceMax = current.onRoad ? ROAD_MAX_SPEED_MPS : OFFROAD_MAX_SPEED_MPS;
    const surfaceAccel = current.onRoad ? ACCEL_A0_MPS2 : ACCEL_A0_MPS2 * OFFROAD_ACCEL_SCALE;
    let speed = last.speed;
    speed += surfaceAccel * throttle * (1 - speed / surfaceMax) * FIXED_DT;
    if (brake > 0) {
      const brakeStep = brake * BRAKE_MPS2 * FIXED_DT;
      if (speed > 0) {
        speed = Math.max(0, speed - brakeStep);
      } else if (speed < 0) {
        speed = Math.min(0, speed + brakeStep);
      }
    } else if (throttle === 0) {
      const coastStep = (current.onRoad ? ENGINE_BRAKE_MPS2 : OFFROAD_COAST_MPS2) * FIXED_DT;
      if (speed > 0) {
        speed = Math.max(0, speed - coastStep);
      } else if (speed < 0) {
        speed = Math.min(0, speed + coastStep);
      }
    }
    speed = clamp(speed, -MAX_REVERSE_MPS, surfaceMax);

    // --- integrate and stay inside the corridor ---------------------------
    const travelAngle = heading - slide;
    const travel = speed * FIXED_DT;
    const stepX = Math.cos(travelAngle) * travel;
    const stepZ = Math.sin(travelAngle) * travel;
    const minX = terrain.bounds.minX;
    const maxX = terrain.bounds.maxX;
    const minZ = terrain.bounds.minZ;
    const maxZ = terrain.bounds.maxZ;
    let nextX = last.x + stepX;
    let nextZ = last.z + stepZ;
    if (nextX < minX || nextX > maxX || nextZ < minZ || nextZ > maxZ) {
      // Project the step back to the edge by the largest admissible fraction.
      let fraction = 1;
      if (stepX !== 0) {
        if (nextX < minX) {
          fraction = Math.min(fraction, (minX - last.x) / stepX);
        } else if (nextX > maxX) {
          fraction = Math.min(fraction, (maxX - last.x) / stepX);
        }
      }
      if (stepZ !== 0) {
        if (nextZ < minZ) {
          fraction = Math.min(fraction, (minZ - last.z) / stepZ);
        } else if (nextZ > maxZ) {
          fraction = Math.min(fraction, (maxZ - last.z) / stepZ);
        }
      }
      fraction = clamp(fraction, 0, 1);
      nextX = last.x + stepX * fraction;
      nextZ = last.z + stepZ * fraction;
      speed *= CORRIDOR_IMPACT_SCALE;
    }
    current.x = clamp(nextX, minX, maxX);
    current.z = clamp(nextZ, minZ, maxZ);
    current.heading = heading;
    current.speed = speed;
    current.slide = slide;

    // --- collisions, after the move ---------------------------------------
    collideProps(props);
    // A prop push can move the bike, so re-clamp before sampling the ground:
    // y must match the position the terrain is asked about.
    current.x = clamp(current.x, minX, maxX);
    current.z = clamp(current.z, minZ, maxZ);
    current.y = terrain.heightAt(current.x, current.z) + RIDE_HEIGHT_M;

    // --- lean: sway against turning, smoothed in ---------------------------
    const leanTarget = (current.speed * yawTarget) / GRAVITY_MPS2;
    const leanError = current.lean - leanTarget;
    let response = LEAN_RESPONSE_PER_S;
    if (Math.abs(leanError) > LEAN_DEADBAND_RAD && leanTarget * current.lean < 0) {
      response += LEAN_RECENTER_GAIN; // big sway opposite the turn: snap back
    }
    current.lean = clamp(
      current.lean + (leanTarget - current.lean) * Math.min(1, response * FIXED_DT),
      -MAX_LEAN_RAD,
      MAX_LEAN_RAD,
    );
    current.steer = steer;
    current.yawRate = yawTarget;

    pool[0] = last;
    pool[1] = current;
    steps += 1;
    return current;
  };

  reset(options);

  return {
    snapshots: pool,
    get stepCount(): number {
      return steps;
    },
    reset,
    step,
    state: (): BikeSnapshot => current,
    previous: (): BikeSnapshot => last,
    interpolate: (alpha: number, out: InterpolatedPose): InterpolatedPose =>
      interpolatePose(last, current, alpha, out),
  };
}
