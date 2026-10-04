import { loadStyle } from '../styles/loadStyle';
import type { StyleConfig } from '../renderer/IRenderer';

/**
 * Eager phase — everything that must exist before the first frame.
 * In this step that is exactly one item: the style JSON (fetched + validated).
 */
export interface EagerBundle {
  style: StyleConfig;
}

/** Loads the eager bundle. Called once at boot, before any rendering. */
export async function loadEager(): Promise<EagerBundle> {
  const style = await loadStyle();
  return { style };
}

/* ==========================================================================
 * STREAMING REGISTRY — EMPTY STUB (this step only)
 * --------------------------------------------------------------------------
 * Nothing is registered, nothing is streamed, nothing is fetched after boot.
 * Do not implement streaming here.
 * ========================================================================== */

/** Registry entry shape — intentionally empty in this step. */
export interface StreamingEntry {
  // intentionally empty
}

/** The streaming registry. Always empty in this step. */
export const streamingRegistry: readonly StreamingEntry[] = [];
