/**
 * FROZEN SEAM — world composition root.
 *
 * Ownership: orchestrator. This file contains NO geometry and NO colors: it
 * validates that every provider is present and returns them as `WorldParts`.
 * Keeping it in the orchestrator's hands means wave tasks never contend for it,
 * while `main.ts` still never learns about individual builders.
 *
 * Wiring the real builders into `WorldProviders` is done by the composition
 * root (task 11), after waves 1 and 2 have merged.
 */

import type { BufferGeometry } from 'three';
import type { ColorSource } from '../renderer/contracts';
import type { ISplineSource, ITerrainSource, IPropSource, WorldParts } from './contracts';

/**
 * The builders the world needs. Each is supplied by exactly one task; a wave
 * task supplies its own and leaves the others null until they merge.
 */
export interface WorldProviders {
  terrain: ITerrainSource | null;
  spline: ISplineSource | null;
  colors: ColorSource | null;
  terrainGeometry: BufferGeometry | null;
  roadGeometry: BufferGeometry | null;
  roadTintCount: number;
  hillGeometry: BufferGeometry | null;
  propSources: readonly IPropSource[];
}

/** A providers object with everything absent, ready to be filled in. */
export function emptyProviders(): WorldProviders {
  return {
    terrain: null,
    spline: null,
    colors: null,
    terrainGeometry: null,
    roadGeometry: null,
    roadTintCount: 0,
    hillGeometry: null,
    propSources: [],
  };
}

/** Which provider is missing, for a precise failure message. */
const REQUIRED: readonly (keyof WorldProviders)[] = [
  'terrain',
  'spline',
  'colors',
  'terrainGeometry',
  'roadGeometry',
  'hillGeometry',
];

/**
 * Assemble the world. Throws naming every missing provider, so a partial merge
 * fails with the exact list rather than a downstream `undefined` dereference.
 *
 * `requireProps` stays false for step 3: scatter arrives at step 8, so an empty
 * prop list is valid here.
 */
export function compose(providers: WorldProviders): WorldParts {
  const missing: string[] = [];
  for (let i = 0; i < REQUIRED.length; i++) {
    const key = REQUIRED[i];
    if (providers[key] === null || providers[key] === undefined) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `compose: world is incomplete — missing provider(s): ${missing.join(', ')}. ` +
        'A wave has not been merged yet.',
    );
  }

  return {
    terrain: providers.terrain as ITerrainSource,
    spline: providers.spline as ISplineSource,
    colors: providers.colors as ColorSource,
    terrainGeometry: providers.terrainGeometry as BufferGeometry,
    roadGeometry: providers.roadGeometry as BufferGeometry,
    roadTintCount: providers.roadTintCount,
    hillGeometry: providers.hillGeometry as BufferGeometry,
    propSources: providers.propSources,
  };
}
