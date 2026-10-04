/**
 * Baked prop shadows for ZimboRush (design doc §14.8, fix 9).
 *
 * Static props (trees, rocks) get their shadow shading BAKED INTO TERRAIN
 * VERTEX COLOURS at track build: each prop darkens a soft ellipse of terrain
 * vertices, offset slightly anti-sunward, deterministic from the seeded
 * scatter, at zero runtime cost.
 *
 * This module therefore only *describes* the darkening: it consumes the same
 * `PropRecord` scatter that `props.ts` produced and returns flat bake data
 * (`PropShadowDisc[]`). The consumer (terrain colour bake) multiplies
 * `terrainShade` by the derived `bakedPropShadow` colour (× 0.75, design §4)
 * inside each disc, fading to no darkening at the rim ("soft ellipse").
 *
 * It renders nothing and allocates no GPU resources: no `BufferGeometry`, no
 * material, no texture, no renderer interaction. The result is plain numbers
 * plus one colour string read from the existing `ColorSource`.
 *
 * Determinism (design §3): disc placement is a pure function of the prop
 * records, the family and the base seed. Decorative jitter uses
 * `hashSeed(seed, SHADOW_STREAM)`, so shadows form their own stream and cannot
 * shift props; there is no `Math.random` in this file.
 */
import { hashSeed, hashUnit } from '../../core/rng';
import type { ColorSource, HexColor } from '../../renderer/contracts';
import type { IPropSource, PropRecord, SpawnContext } from '../../world/contracts';
import { ROCK_SOURCE_ID } from './props';

/** Independent hash stream id for shadow jitter (props use 1 = trees, 2 = rocks). */
export const SHADOW_STREAM = 3;

/**
 * Sun direction in plan view, pointing from the sun towards the scene: a low
 * sun from the north-east, matching the design's warm rim light. Each shadow
 * is nudged slightly anti-sunward along this vector, so the darkening does not
 * sit dead-centre under its prop.
 */
export const SUN_PLAN_DIR: Readonly<{ x: number; z: number }> = {
  x: -0.7071067811865476,
  z: -0.7071067811865476,
};

/** Disc radius in metres, as a multiple of the prop's canopy/footprint radius. */
export const TREE_SHADOW_RADIUS_FACTOR = 1.15;
export const ROCK_SHADOW_RADIUS_FACTOR = 1.45;

/** Disc radius clamps, metres, so shadows stay readable at any instance scale. */
export const SHADOW_RADIUS_MIN_M = 1.1;
export const SHADOW_RADIUS_MAX_M = 2.6;

/** Anti-sunward centre offset, as a fraction of the disc radius. */
export const SHADOW_SUNWARD_OFFSET_FRACTION = 0.16;

/**
 * Fraction of `terrainShade × 0.75` a disc reaches at its centre. 1 means the
 * full derived colour. Kept per family so tree and rock shadows can be tuned
 * independently.
 */
export const TREE_SHADOW_STRENGTH = 1;
export const ROCK_SHADOW_STRENGTH = 1;

export type PropFamily = 'tree' | 'rock';

/** One baked darken disc. Plain numbers, safe to transfer. */
export interface PropShadowDisc {
  /** Disc centre, world metres (plan view). */
  x: number;
  z: number;
  /** Base radius in metres. */
  radiusM: number;
  /** 0..1 — depth of the darkening relative to the derived shadow colour. */
  strength: number;
}

export interface BakePropShadowsOptions {
  /** Prop sources to bake for; the world builder passes `WorldParts.propSources`. */
  readonly sources: readonly IPropSource[];
  /** World / spawn context, the same one the props were built with. */
  readonly ctx: SpawnContext;
  /** Palette accessor for the derived shadow colour (design §4). */
  readonly colors: ColorSource;
}

export interface BakedPropShadows {
  /** Deterministic darken discs, one per scattered prop, in build order. */
  readonly discs: readonly PropShadowDisc[];
  /** `terrainShade × 0.75` (design §4) — the colour the bake darkens towards. */
  readonly color: HexColor;
}

/**
 * Discs for one already-built record list. Pure: same inputs, same output.
 *
 * `indexOffset` lets a caller mixing several families keep the decorative
 * jitter stream disjoint across families.
 */
export function shadowDiscsFor(
  family: PropFamily,
  props: readonly PropRecord[],
  seed: number,
  indexOffset = 0,
): PropShadowDisc[] {
  const jitterSeed = hashSeed(seed, SHADOW_STREAM);
  const radiusFactor = family === 'rock' ? ROCK_SHADOW_RADIUS_FACTOR : TREE_SHADOW_RADIUS_FACTOR;
  const strength = family === 'rock' ? ROCK_SHADOW_STRENGTH : TREE_SHADOW_STRENGTH;
  const discs = new Array<PropShadowDisc>(props.length);
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    // Instance scale folds into the disc size; jitter and angle come from a
    // dedicated hash so the shadow stream stays independent of prop scatter.
    const radiusM = clamp(radiusFactor * prop.scale, SHADOW_RADIUS_MIN_M, SHADOW_RADIUS_MAX_M);
    const offset = SHADOW_SUNWARD_OFFSET_FRACTION * radiusM;
    const jitter = (hashUnit(indexOffset + i, jitterSeed) - 0.5) * 0.12 * radiusM;
    const jitterAngle = hashUnit(indexOffset + i + 7919, jitterSeed) * Math.PI * 2;
    discs[i] = {
      x: prop.x + SUN_PLAN_DIR.x * offset + Math.cos(jitterAngle) * jitter,
      z: prop.z + SUN_PLAN_DIR.z * offset + Math.sin(jitterAngle) * jitter,
      radiusM,
      strength,
    };
  }
  return discs;
}

/**
 * Full bake entry point for the terrain build: runs each prop source exactly
 * as the world builder does, then returns every darken disc plus the derived
 * shadow colour.
 *
 * `IPropSource.build` is a pure seeded function of the context, so calling
 * this twice with the same context returns structurally identical discs. This
 * function itself touches no GPU state.
 */
export function bakePropShadows(options: BakePropShadowsOptions): BakedPropShadows {
  const discs: PropShadowDisc[] = [];
  let offset = 0;
  for (let i = 0; i < options.sources.length; i++) {
    const source = options.sources[i];
    const records = source.build(options.ctx);
    const family: PropFamily = source.id === ROCK_SOURCE_ID ? 'rock' : 'tree';
    const produced = shadowDiscsFor(family, records, options.ctx.seed, offset);
    for (let j = 0; j < produced.length; j++) discs.push(produced[j]);
    offset += records.length;
  }
  return {
    discs,
    color: options.colors.derived({ kind: 'bakedPropShadow' }),
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
