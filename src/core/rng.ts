/**
 * Deterministic seeded PRNG (design doc §3: "seeded and deterministic, so
 * benchmarks and future ghost races are repeatable").
 *
 * Frozen seam: every task that needs randomness imports this and does NOT
 * implement its own generator. Four independent generators would drift, and
 * two of them would inevitably disagree about what seed 1 means — which breaks
 * the reproducibility the design doc requires.
 *
 * Algorithm: mulberry32. Small, fast, no dependencies, and stable across
 * engines because it uses only integer ops on a 32-bit accumulator.
 */

/** A deterministic random stream. All methods advance the same state. */
export interface Rng {
  /** The seed this stream was created from. */
  readonly seed: number;
  /** Next float in [0, 1). */
  next(): number;
  /** Next float in [min, max). */
  range(min: number, max: number): number;
  /** Next integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number;
  /** Symmetric float in [-magnitude, magnitude]. */
  signed(magnitude: number): number;
  /** Current internal state, so a caller can snapshot and restore. */
  state(): number;
}

/**
 * Creates a deterministic stream. The same seed always yields the same
 * sequence, on every platform.
 */
export function createRng(seed: number): Rng {
  // Normalise to an unsigned 32-bit integer so a float or negative seed is
  // defined behaviour rather than an accident of bit patterns.
  let s = (Math.floor(seed) >>> 0) || 1;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed,
    next,
    range(min: number, max: number): number {
      return min + next() * (max - min);
    },
    int(minInclusive: number, maxExclusive: number): number {
      const span = maxExclusive - minInclusive;
      if (span <= 0) {
        return minInclusive;
      }
      return minInclusive + Math.floor(next() * span);
    },
    signed(magnitude: number): number {
      return (next() * 2 - 1) * magnitude;
    },
    state(): number {
      return s;
    },
  };
}

/**
 * Derives a stable seed from labelled parts, so independent features get
 * independent but reproducible streams:
 *
 *   const treeRng = createRng(hashSeed(baseSeed, 1)); // trees
 *   const rockRng = createRng(hashSeed(baseSeed, 2)); // rocks
 *
 * Without this, two features drawing from a shared stream would shift each
 * other's output whenever either one changed — breaking §3's repeatability.
 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < parts.length; i++) {
    let v = Math.floor(parts[i]) >>> 0;
    for (let b = 0; b < 4; b++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  return h >>> 0;
}

/**
 * Seeded value noise in one dimension, for repeatable scatter and terrain
 * variation. Not a general-purpose noise library — deliberately small.
 */
export function hashNoise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashUnit(i, seed);
  const b = hashUnit(i + 1, seed);
  // Smoothstep interpolation keeps the result continuous, which matters for
  // terrain that gets sampled at adjacent grid vertices.
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** Deterministic float in [0, 1) for an integer lattice point. */
export function hashUnit(i: number, seed: number): number {
  let h = (i | 0) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
