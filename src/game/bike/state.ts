/**
 * Bike state shapes — the snapshot pair the fixed 60 Hz step mutates in place
 * and the pose the renderer interpolates between them (design doc §8:
 * "Snapshots mutated in place — zero per-frame allocation (hard rule)").
 *
 * Snapshots are flat bags of `number` fields rather than vectors on purpose:
 * `step` reads and writes every field each tick, and `interpolate` copies
 * numbers out of the two slots into a caller-owned pose, so neither the sim
 * nor the render path has an object to allocate. Consumers only read
 * snapshots; writing them is `createBikePhysics`'s private business.
 *
 * Plan-view (x, z) is authoritative; `y` is the ground contact height the
 * physics derives from the heightfield every step, never an integrated value.
 */

/** Per-step rider input: what a player, a rival (step 7) or a peer sends. */
export interface BikeInput {
  /** Drive, 0..1 — trigger pulled / up arrow. */
  throttle: number;
  /** Handlebar, -1..1 — left..right, 0 centred. */
  steer: number;
  /** Brakes, 0..1 — both wheels. */
  brake: number;
}

/** Neutral input: no drive, bars centred, no brakes. Shared, never mutated. */
export const NEUTRAL_INPUT: Readonly<BikeInput> = Object.freeze({
  throttle: 0,
  steer: 0,
  brake: 0,
});

/** One fixed-step snapshot of the bike. */
export interface BikeSnapshot {
  /** Plan-view position of the bike's centre of mass, metres. */
  x: number;
  z: number;
  /** Contact-patch height: `heightAt(x, z) + ride height`, metres. */
  y: number;
  /** Heading of the forward axis in the plan view, radians (atan2(z, x) sense). */
  heading: number;
  /** Signed speed along `heading`, m/s; negative while reversing. */
  speed: number;
  /** Body lean, radians, positive = right — the camera roll source (§11). */
  lean: number;
  /** Bar position after the input's rate limit, radians; 0 centred. */
  steer: number;
  /** Arc length of the nearest road-centreline sample, metres. */
  roadS: number;
  /** Distance from that centreline, metres, always >= 0. */
  offRoad: number;
  /** True while `offRoad` is inside the road half-width at `roadS`. */
  onRoad: boolean;
  /** Over-rotation left after the grip cap, rad/s; 0 while fully gripped. */
  slide: number;
  /** Heading change of the last step, rad/s — the camera's yaw rate. */
  yawRate: number;
}

/** The pose the render step consumes; `interpolate` writes it in place. */
export interface InterpolatedPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  lean: number;
  speed: number;
  yawRate: number;
  offRoad: number;
  onRoad: boolean;
}

/** Full turn, radians. */
const TAU = Math.PI * 2;

/** Wraps an angle into (-PI, PI]. */
export function wrapPi(angle: number): number {
  const wrapped = (((angle + Math.PI) % TAU) + TAU) % TAU - Math.PI;
  return wrapped <= -Math.PI ? wrapped + TAU : wrapped;
}

/** A pose target with every field at rest; allocate once, reuse every frame. */
export function createPose(): InterpolatedPose {
  return { x: 0, y: 0, z: 0, heading: 0, lean: 0, speed: 0, yawRate: 0, offRoad: 0, onRoad: false };
}

/** Copies every field of `source` into `target` — no allocation either side. */
export function copySnapshot(target: BikeSnapshot, source: BikeSnapshot): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  target.heading = source.heading;
  target.speed = source.speed;
  target.lean = source.lean;
  target.steer = source.steer;
  target.roadS = source.roadS;
  target.offRoad = source.offRoad;
  target.onRoad = source.onRoad;
  target.slide = source.slide;
  target.yawRate = source.yawRate;
}

/** Snapshot -> pose, field for field; the no-blend path of `interpolate`. */
function copyPose(target: InterpolatedPose, source: BikeSnapshot): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  target.heading = source.heading;
  target.lean = source.lean;
  target.speed = source.speed;
  target.yawRate = source.yawRate;
  target.offRoad = source.offRoad;
  target.onRoad = source.onRoad;
}

/**
 * The render step's interpolator (design doc §8): blends the snapshot pair at
 * `alpha` in [0, 1] — 0 is `prev`, 1 is `curr` — into `out`, and returns it.
 * Heading takes the shortest arc, contact flags switch at the midpoint, and
 * `alpha` at either end reproduces that snapshot exactly. Nothing is
 * allocated, so `out` can be the same pose object every frame.
 */
export function interpolate(
  prev: BikeSnapshot,
  curr: BikeSnapshot,
  alpha: number,
  out: InterpolatedPose,
): InterpolatedPose {
  if (alpha <= 0) {
    copyPose(out, prev);
    return out;
  }
  if (alpha >= 1) {
    copyPose(out, curr);
    return out;
  }
  out.x = prev.x + (curr.x - prev.x) * alpha;
  out.y = prev.y + (curr.y - prev.y) * alpha;
  out.z = prev.z + (curr.z - prev.z) * alpha;
  out.heading = wrapPi(prev.heading + wrapPi(curr.heading - prev.heading) * alpha);
  out.lean = prev.lean + (curr.lean - prev.lean) * alpha;
  out.speed = prev.speed + (curr.speed - prev.speed) * alpha;
  out.yawRate = prev.yawRate + (curr.yawRate - prev.yawRate) * alpha;
  out.offRoad = prev.offRoad + (curr.offRoad - prev.offRoad) * alpha;
  out.onRoad = alpha < 0.5 ? prev.onRoad : curr.onRoad;
  return out;
}
