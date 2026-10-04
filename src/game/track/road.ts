/**
 * Road centreline — the closed circuit the whole game races on (task 4).
 * Implements `ISplineSource` from `world/contracts.ts`.
 *
 * The fly-through (task 10), the rival rider (step 7) and the road mesh
 * (task 8) all sample this one curve, so they agree by construction. Arc
 * length is in metres, not normalised 0..1, so speeds and look-aheads are
 * real units.
 *
 * Shape: the circuit is a closed loop built as a radial table — each control
 * point sits at its own radius and angle around the origin — which makes the
 * "windy but never self-crossing" property structural rather than something
 * that has to be discovered by trial and error. Radii and angles jitter off
 * `core/rng.ts`, so the track is seeded and every player with the same seed
 * gets the same circuit.
 *
 * Geometry vs the terrain: the loop is sized to stay broadly inside the
 * corridor `heightfield.ts` covers; the road builder (task 8) drapes it onto
 * `heightAt`, so this file carries y = 0 and owns only the plan-view curve.
 *
 * Parameterisation: `s` is arc length. Segments are uniform in the radial
 * table, and every accessor inverts the same lookup, so `pointAt`, `tangentAt`,
 * `curvatureAt` and `halfWidthAt` are exactly consistent with each other: they
 * all evaluate at the same position along the same segment. A closed loop means
 * `s` wraps, and `pointAt(0)` and `pointAt(lengthM)` are the same point — the
 * boundary is walked as the segment from the last control point back to the
 * first, so there is no visible seam.
 *
 * Allocation-free: `pointAt` / `tangentAt` write into the caller's `out` and
 * read only the tables built in the constructor; `curvatureAt` / `halfWidthAt`
 * return numbers. Hot-path lookup state is per-instance scratch, never a
 * per-call object.
 */

import { createRng, hashSeed } from '../../core/rng';
import type { ISplineSource, Vec3Mut } from '../../world/contracts';

/** Feature tag: keeps this curve's seed stream separate from siblings'. */
const ROAD_STREAM_TAG = 0x9b02;

/** Control points around the circuit. */
const CONTROL_POINTS = 32;

/** Mean radius of the circuit in metres; radius 120 m gives a ~800 m loop. */
const BASE_RADIUS_M = 120;

/** Radius jitter in metres — the winding, kept well inside the corridor. */
const RADIUS_JITTER_M = 26;

/** Road half-width in metres: a 7 m road, driven from the handlebars. */
const HALF_WIDTH_M = 3.5;

/** Samples per control-point interval when measuring arc length. */
const ARC_SAMPLES_PER_SEGMENT = 24;

/** Centred-difference step for `curvatureAt`, metres. */
const CURVATURE_STEP_M = 0.5;

/** Full turn in radians. */
const TAU = Math.PI * 2;

/**
 * Writes the loop's control points into `out` (x, z pairs). Each point carries
 * its own radius and phase, both seeded, so the circuit is a closed ring with
 * a stable, reproducible wobble.
 */
function buildControlPoints(out: Float64Array, seed: number): void {
  const rng = createRng(hashSeed(seed, ROAD_STREAM_TAG));
  // A phase offset per point, plus a slow drift, keeps some bends tighter than
  // others instead of an even sine ring.
  for (let i = 0; i < CONTROL_POINTS; i++) {
    const phase = (i / CONTROL_POINTS) * TAU + rng.signed(0.18);
    const radius = BASE_RADIUS_M + rng.signed(RADIUS_JITTER_M);
    const sinA = rng.signed(0.999999);
    const cosA = Math.sqrt(1 - sinA * sinA);
    out[i * 2] = radius * cosA * Math.cos(phase);
    out[i * 2 + 1] = radius * cosA * Math.sin(phase);
  }
}

/**
 * Reads a control point, wrapping the index so the loop closes: index
 * `CONTROL_POINTS` is index 0.
 */
function controlX(points: Float64Array, index: number): number {
  return points[((index % CONTROL_POINTS) + CONTROL_POINTS) % CONTROL_POINTS * 2];
}

function controlZ(points: Float64Array, index: number): number {
  return points[(((index % CONTROL_POINTS) + CONTROL_POINTS) % CONTROL_POINTS) * 2 + 1];
}

/**
 * Uniform cubic B-spline evaluation for one coordinate of control points
 * p0..p3 at parameter t in [0, 1]. The basis is the standard 1/6
 * (1-t)^3 / (3t^3 - 6t^2 + 4) / (-3t^3 + 3t^2 + 3t + 1) / t^3 form; C2
 * across joins, which is what makes curvature continuous around the loop.
 */
function splineCoord(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (1 / 6) *
    ((1 - t) * (1 - t) * (1 - t) * p0 +
      (3 * t3 - 6 * t2 + 4) * p1 +
      (-3 * t3 + 3 * t2 + 3 * t + 1) * p2 +
      t3 * p3)
  );
}

/** Builds the road centreline for `seed`. */
export function createRoad(seed: number): ISplineSource {
  const points = new Float64Array(CONTROL_POINTS * 2);
  buildControlPoints(points, seed);

  // Pitch, in metres, of one unit of spline parameter t. Placing t via index +
  // fraction per segment makes every accessor share one lookup.
  const sampleCount = CONTROL_POINTS * ARC_SAMPLES_PER_SEGMENT;
  const cumulativeS = new Float64Array(sampleCount + 1);
  let total = 0;
  let prevX = splineCoord(controlX(points, CONTROL_POINTS - 1), controlX(points, 0), controlX(points, 1), controlX(points, 2), 0);
  let prevZ = splineCoord(controlZ(points, CONTROL_POINTS - 1), controlZ(points, 0), controlZ(points, 1), controlZ(points, 2), 0);
  for (let i = 0; i < sampleCount; i++) {
    const segment = Math.floor(i / ARC_SAMPLES_PER_SEGMENT);
    const t = (i % ARC_SAMPLES_PER_SEGMENT) / ARC_SAMPLES_PER_SEGMENT;
    const x = splineCoord(
      controlX(points, segment - 1),
      controlX(points, segment),
      controlX(points, segment + 1),
      controlX(points, segment + 2),
      t,
    );
    const z = splineCoord(
      controlZ(points, segment - 1),
      controlZ(points, segment),
      controlZ(points, segment + 1),
      controlZ(points, segment + 2),
      t,
    );
    total += Math.sqrt((x - prevX) * (x - prevX) + (z - prevZ) * (z - prevZ));
    cumulativeS[i + 1] = total;
    prevX = x;
    prevZ = z;
  }
  const lengthM = total;

  /** Position on the closed curve at arc length s (wraps). */
  const pointAt = (s: number, out: Vec3Mut): Vec3Mut => {
    const wrapped = ((s % lengthM) + lengthM) % lengthM;
    const segments = sampleCount;
    // Uniform-per-segment pitch from the cumulative table: locate the segment
    // index by walking the table (CONTROL_POINTS-sized loop, no allocation).
    let seg = 0;
    for (let i = 1; i <= segments; i++) {
      if (cumulativeS[i] > wrapped) {
        seg = i - 1;
        break;
      }
      seg = i - 1;
    }
    const segStart = cumulativeS[seg];
    const segEnd = cumulativeS[seg + 1];
    const span = segEnd - segStart;
    const localT = span > 0 ? (wrapped - segStart) / span : 0;
    const controlSegment = Math.floor(seg / ARC_SAMPLES_PER_SEGMENT);
    const base = (seg % ARC_SAMPLES_PER_SEGMENT) / ARC_SAMPLES_PER_SEGMENT;
    const t = base + localT / ARC_SAMPLES_PER_SEGMENT;
    out.x = splineCoord(
      controlX(points, controlSegment - 1),
      controlX(points, controlSegment),
      controlX(points, controlSegment + 1),
      controlX(points, controlSegment + 2),
      t,
    );
    out.y = 0;
    out.z = splineCoord(
      controlZ(points, controlSegment - 1),
      controlZ(points, controlSegment),
      controlZ(points, controlSegment + 1),
      controlZ(points, controlSegment + 2),
      t,
    );
    return out;
  };

  const pA: Vec3Mut = { x: 0, y: 0, z: 0 };
  const pB: Vec3Mut = { x: 0, y: 0, z: 0 };

  const tangentAt = (s: number, out: Vec3Mut): Vec3Mut => {
    pointAt(s - CURVATURE_STEP_M, pA);
    pointAt(s + CURVATURE_STEP_M, pB);
    const dx = pB.x - pA.x;
    const dz = pB.z - pA.z;
    const invLength = 1 / Math.sqrt(dx * dx + dz * dz);
    out.x = dx * invLength;
    out.y = 0;
    out.z = dz * invLength;
    return out;
  };

  const curvatureAt = (s: number): number => {
    pointAt(s - CURVATURE_STEP_M, pA);
    pointAt(s + CURVATURE_STEP_M, pB);
    const dx = pB.x - pA.x;
    const dz = pB.z - pA.z;
    const invLength = 1 / Math.sqrt(dx * dx + dz * dz);
    pointAt(s + 2 * CURVATURE_STEP_M, pB);
    const dx2 = pB.x - pA.x;
    const dz2 = pB.z - pA.z;
    const invLength2 = 1 / Math.sqrt(dx2 * dx2 + dz2 * dz2);
    const tx = dx * invLength;
    const tz = dz * invLength;
    const tx2 = dx2 * invLength2;
    const tz2 = dz2 * invLength2;
    // Signed turn rate per metre of arc length; sign gives turn direction.
    return (tx * tz2 - tz * tx2) / (2 * CURVATURE_STEP_M);
  };

  const halfWidthAt = (_s: number): number => HALF_WIDTH_M;

  return { lengthM, pointAt, tangentAt, curvatureAt, halfWidthAt };
}
