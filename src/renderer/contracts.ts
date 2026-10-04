/**
 * FROZEN SEAM — renderer contracts.
 *
 * Ownership: orchestrator. Consumers IMPORT these types and never edit them.
 * A task that needs a change here must stop and report instead of editing.
 *
 * This extends the Step-1 `StyleConfig` ({ id, clearColor }) with the fields
 * step 3 and step 4 need, without touching `IRenderer.ts` — the renderer
 * interface stays exactly as verified in Step 1.
 */

/** Renderer backend id. v1 ships 'webgl2' only (settled). */
export type BackendId = 'webgl2';

/** A `#RRGGBB` string. */
export type HexColor = string;

/**
 * Palette keys, authored (design doc §4). Values live in the style JSON, not
 * in code — "style as config" is the settled architecture.
 */
export interface StylePalette {
  skyHorizon: HexColor;
  skyMid: HexColor;
  skyZenith: HexColor;
  sunDisc: HexColor;
  /** Purple-maroon distant hill band — authored, not derived. */
  hillsDistant: HexColor;
  terrainLit: HexColor;
  terrainShade: HexColor;
  road: HexColor;
  roadTrack: HexColor;
  foliage: HexColor;
  rock: HexColor;
  bikeMetal: HexColor;
}

/**
 * Style configuration for step 3+. `id` and `clearColor` are required so
 * Step-1 code keeps working unchanged.
 */
export interface FullStyleConfig {
  id: string;
  /** Render clear colour, `#RRGGBB`. */
  clearColor: HexColor;
  palette: StylePalette;
  /** Fog colour and near/far in metres. */
  fog: { color: HexColor; nearM: number; farM: number };
  /** Directional sun: position is a direction, intensity 0..n. */
  sun: { color: HexColor; intensity: number; azimuthDeg: number; elevationDeg: number };
  /** Hemisphere fill light. */
  hemi: { sky: HexColor; ground: HexColor; intensity: number };
  /** Buffer scale on top of the DPR policy. 1 = unscaled. */
  renderScale: number;
  /** Multisample count; 0 disables the offscreen resolve pass. */
  msaa: number;
}

/**
 * Colour source for geometry builders. Implemented by the style layer (task 11)
 * so geometry code never hardcodes a palette value.
 */
export interface ColorSource {
  /** Resolve a palette key to a `#RRGGBB` string. */
  palette(key: keyof StylePalette): HexColor;
  /** Derived colours follow fixed rules (design doc §4), never authored. */
  derived(rule: DerivedColorRule): HexColor;
}

/** Derived-colour rules, fixed by design doc §4. */
export type DerivedColorRule =
  | { kind: 'treeTrunk' }
  | { kind: 'cloud' }
  | { kind: 'rockVariant'; level: number }
  | { kind: 'foliageVariant' }
  | { kind: 'midHill'; t: number }
  | { kind: 'bakedPropShadow' }
  | { kind: 'blobShadow' };

/**
 * Render budgets. Estimates from design doc §5, to be corrected by phone
 * testing; code may read them but must not hardcode its own copies.
 */
export const BUDGET = {
  /** Planning ceiling before the 50k phone cap. */
  trianglesCeiling: 45_000,
  /** Phone triangle cap. */
  trianglesPhoneCap: 50_000,
  /** Draw-call total budget. */
  drawCallsTotal: 15,
  /** Draw calls on the low tier (dust off). */
  drawCallsLowTier: 14,
  /** Hard draw-call cap including streamed content. */
  drawCallsCap: 25,
  /** Dust sprite quads (step 7). */
  dustQuads: 12,
} as const;
