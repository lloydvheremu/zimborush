import type { Camera } from 'three';

/**
 * Opaque quality-tier label. The concrete tier set is decided outside this
 * step; treat it as an id and do not branch on its value here.
 */
export type TierId = string;

/**
 * Style config — the minimal shape required by this step, produced and
 * validated by `styles/loadStyle.ts`. `clearColor` is a `#RRGGBB` string
 * used as the render clear colour.
 */
export interface StyleConfig {
  id: string;
  clearColor: string;
}

/** Backend statistics for one rendered frame. */
export interface RenderStats {
  backend: string;
  drawCalls: number;
  triangles: number;
}

/** Rendering backend contract. One implementation exists in this step. */
export interface IRenderer {
  /** Create the context, apply the style's clear colour, size the buffer. Throws on double init. */
  init(canvas: HTMLCanvasElement, style: StyleConfig, tier: TierId): void;
  /** Apply a style delta to live rendering state. */
  realize(diff: unknown): void;
  /** Draw one frame. Must not allocate. */
  render(camera: Camera): void;
  /** Resize from CSS pixel dimensions; the DPR policy is applied internally. */
  resize(cssW: number, cssH: number): void;
  /** Buffer scale on top of the DPR policy; 1 = unscaled. */
  setRenderScale(s: number): void;
  /** Multisample sample count. */
  setMsaa(samples: number): void;
  /** Backend statistics. Returns a reused object — callers must not retain it. */
  stats(): RenderStats;
  /** Release all GPU resources. Idempotent. */
  dispose(): void;
}
