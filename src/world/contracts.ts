/**
 * FROZEN SEAM — world contracts.
 *
 * Ownership: orchestrator. Consumers IMPORT these types and never edit them.
 * If a task needs a change here, it must stop and report rather than edit: an
 * edit by one task is a change every other task's code depends on, and it
 * would invalidate work already verified against the old shape.
 *
 * These are interfaces and type aliases only. No implementations, no geometry,
 * no colors — those belong to the tasks that own the corresponding files.
 */

import type { BufferGeometry } from 'three';
import type { ColorSource } from '../renderer/contracts';

/** Mutable 3-component vector, allocated once and reused. */
export interface Vec3Mut {
  x: number;
  y: number;
  z: number;
}

/** World units are metres, Y is up (design doc: "units in metres"). */
export interface Bounds2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The terrain's analytic height function. The single source of truth for
 * ground height: physics (step 6), prop placement (step 8) and the terrain
 * mesh (task 7) all sample this, and step 6's deviation check compares the
 * mesh against it (tolerance max ≤ 0.05 m, mean ≤ 0.02 m).
 */
export interface ITerrainSource {
  /** Ground height in metres at a world position. Must be pure. */
  heightAt(x: number, z: number): number;
  /** Approximate normal, written into `out` to avoid per-call allocation. */
  normalAt(x: number, z: number, out: Vec3Mut): Vec3Mut;
  /** World extent this source is defined over. */
  readonly bounds: Bounds2;
  /** Grid cell size the mesh should use, in metres. */
  readonly cellSize: number;
}

/**
 * The road centreline. The fly-through (task 10), the rival rider (step 7)
 * and the road mesh (task 8) all sample this, so they agree on one curve.
 * Arc length is parameterised in metres, not normalised 0..1, so speeds and
 * look-aheads are expressed in real units.
 */
export interface ISplineSource {
  /** Total arc length in metres. */
  readonly lengthM: number;
  /** Position at arc length `s` metres, written into `out`. */
  pointAt(s: number, out: Vec3Mut): Vec3Mut;
  /** Unit tangent at arc length `s`, written into `out`. */
  tangentAt(s: number, out: Vec3Mut): Vec3Mut;
  /** Signed curvature (1/m) at arc length `s`; sign gives turn direction. */
  curvatureAt(s: number): number;
  /** Road half-width in metres at arc length `s` (may vary). */
  halfWidthAt(s: number): number;
}

/** One instanced prop. Positions come from the seeded scatter, not from code. */
export interface PropRecord {
  /** Which instanced variant this prop uses. */
  variant: number;
  x: number;
  y: number;
  z: number;
  /** Yaw in radians. */
  rotation: number;
  /** Uniform scale multiplier. */
  scale: number;
}

/**
 * A prop source. One implementation per prop family (trees, rocks), each with
 * its own seeded stream so changing one family cannot shift another's layout.
 */
export interface IPropSource {
  /** Stable id, used for named scene-graph slots. */
  readonly id: string;
  /** Variant count this source produces. */
  readonly variantCount: number;
  /** Deterministic generation. Called once at world build, never per frame. */
  build(ctx: SpawnContext): PropRecord[];
}

/** Everything a generator needs to place things in the world consistently. */
export interface SpawnContext {
  terrain: ITerrainSource;
  spline: ISplineSource;
  /**
   * Base seed. Derive per-feature seeds with `hashSeed(base, n)` from
   * `core/rng.ts` so features stay independent (§3 repeatability).
   */
  seed: number;
  /** Distance from the road centreline inside which props must not spawn. */
  roadClearanceM: number;
}

/** A geometry builder result: geometry plus the colours that go with it. */
export interface BuiltGeometry {
  geometry: BufferGeometry;
  /** Human-readable name for the scene-graph slot and telemetry. */
  name: string;
  /** Discrete tint families to split into separate meshes (fewer draw calls). */
  tintCount: number;
}

/**
 * The assembled world. Every field is a real object by the time `compose()`
 * returns — consumers may rely on that and must not re-check for null.
 */
export interface WorldParts {
  terrain: ITerrainSource;
  spline: ISplineSource;
  colors: ColorSource;
  terrainGeometry: BufferGeometry;
  roadGeometry: BufferGeometry;
  roadTintCount: number;
  hillGeometry: BufferGeometry;
  /**
   * Prop sources present in this build. Empty in step 3: scatter arrives at
   * step 8 (design doc §14.8), so consumers must handle an empty array.
   */
  propSources: readonly IPropSource[];
}
