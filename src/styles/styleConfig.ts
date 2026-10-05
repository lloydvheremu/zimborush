/**
 * Style layer — palette access and derived colours (design doc §4).
 *
 * Implements the frozen `ColorSource` seam. Geometry builders never hardcode a
 * palette value: they call `palette(key)` for an authored colour and
 * `derived(rule)` for a computed one. That is what makes "gameplay is
 * independent of visual style" true — swapping the style JSON re-skins the
 * whole scene without touching a builder.
 *
 * Derived rules follow design doc §4 and are deliberately NOT authored:
 *   treeTrunk       = dirt darkened (value x 0.72)
 *   cloud           = sunDisc lightened ~10%
 *   rockVariant     = rock darkened by level
 *   foliageVariant  = foliage darkened
 *   midHill         = mix(terrainShade, hillsDistant) by t
 *   bakedPropShadow = dirt darkened (x 0.62)
 *   blobShadow      = dirt darkened (x 0.45)
 *
 * The three brown rules read `dirt`, not `terrainShade`. Before the visual
 * patch `terrainShade` was the only brown in the palette, so trunks, shadows
 * and dust were all hung off it. Once `terrainLit`/`terrainShade` became the
 * olive GRASS pair (P3), leaving those rules on `terrainShade` would have made
 * tree trunks, prop shadows and the dust plume olive green — the exact defect
 * P3 was written to prevent. Baked and blob shadows use different factors
 * (0.62 / 0.45) rather than the old 0.75 / 0.6 because the reference shows
 * distinctly soft, clearly darker cast shadows on olive ground.
 *
 * Colour work uses three's Color so the mixing matches the renderer exactly.
 */

import { Color } from 'three';
import type { ColorSource, DerivedColorRule, FullStyleConfig, HexColor, StylePalette } from '../renderer/contracts';

/** Darken a colour by multiplying its RGB (value scale). */
function scale(hex: HexColor, factor: number, out: Color): HexColor {
  out.setStyle(hex);
  out.multiplyScalar(factor);
  return `#${out.getHexString()}`;
}

/** Mix two colours; `t` = 0 gives `a`, `t` = 1 gives `b`. */
function mix(a: HexColor, b: HexColor, t: number, out: Color, tmp: Color): HexColor {
  out.setStyle(a);
  tmp.setStyle(b);
  out.lerp(tmp, t < 0 ? 0 : t > 1 ? 1 : t);
  return `#${out.getHexString()}`;
}

/** Lighten toward white by a fraction. */
function lighten(hex: HexColor, amount: number, out: Color, tmp: Color): HexColor {
  return mix(hex, '#FFFFFF', amount, out, tmp);
}

/**
 * A `ColorSource` bound to one style config.
 *
 * Instances hold the config plus scratch `Color` objects, so `palette()` and
 * `derived()` allocate nothing per call. Build once at boot.
 */
export class StyleColorSource implements ColorSource {
  private readonly cfg: FullStyleConfig;
  private readonly scratchA = new Color();
  private readonly scratchB = new Color();

  constructor(config: FullStyleConfig) {
    this.cfg = config;
  }

  /** Authored palette value. Never a computed one. */
  palette(key: keyof StylePalette): HexColor {
    return this.cfg.palette[key];
  }

  /** Computed colour, by the fixed rules above. */
  derived(rule: DerivedColorRule): HexColor {
    const p = this.cfg.palette;
    const a = this.scratchA;
    const b = this.scratchB;
    switch (rule.kind) {
      case 'treeTrunk':
        return scale(p.dirt, 0.72, a);
      case 'cloud':
        return lighten(p.sunDisc, 0.1, a, b);
      case 'rockVariant': {
        // level 0 = base rock; each further level darkens a little more.
        const f = Math.pow(0.85, Math.max(0, rule.level));
        return scale(p.rock, f, a);
      }
      case 'foliageVariant':
        return scale(p.foliage, 0.85, a);
      case 'midHill':
        return mix(p.terrainShade, p.hillsDistant, rule.t, a, b);
      case 'bakedPropShadow':
        return scale(p.dirt, 0.62, a);
      case 'blobShadow':
        return scale(p.dirt, 0.45, a);
      default:
        // Exhaustive at compile time; this guards a future rule kind at runtime.
        return p.terrainShade;
    }
  }
}

/**
 * Validate the palette portion of a loaded style and fill any missing keys from
 * the fallback set, so a partial style JSON cannot produce `undefined` colours
 * deep inside geometry code.
 */
export function withPaletteDefaults(config: FullStyleConfig): FullStyleConfig {
  const d = FALLBACK_PALETTE;
  const p = config.palette;
  const merged: StylePalette = {
    skyHorizon: p.skyHorizon ?? d.skyHorizon,
    skyMid: p.skyMid ?? d.skyMid,
    skyZenith: p.skyZenith ?? d.skyZenith,
    sunDisc: p.sunDisc ?? d.sunDisc,
    hillsDistant: p.hillsDistant ?? d.hillsDistant,
    terrainLit: p.terrainLit ?? d.terrainLit,
    terrainShade: p.terrainShade ?? d.terrainShade,
    dirt: p.dirt ?? d.dirt,
    road: p.road ?? d.road,
    roadTrack: p.roadTrack ?? d.roadTrack,
    foliage: p.foliage ?? d.foliage,
    rock: p.rock ?? d.rock,
    bikeMetal: p.bikeMetal ?? d.bikeMetal,
  };
  return { ...config, palette: merged };
}

/**
 * Fallback palette — the design doc §4 ESTIMATES. Used only when a value is
 * absent from the style JSON; the JSON is the real source of truth.
 */
export const FALLBACK_PALETTE: StylePalette = {
  skyHorizon: '#F6C08C',
  skyMid: '#EA9E7C',
  skyZenith: '#D8988F',
  sunDisc: '#FFEDC6',
  hillsDistant: '#5A3644',
  terrainLit: '#8A7050',
  terrainShade: '#5B4A3A',
  dirt: '#9A7350',
  road: '#B08A63',
  roadTrack: '#8C6B4A',
  foliage: '#4F5A44',
  rock: '#6E5A66',
  bikeMetal: '#2A2622',
};

/** Sunset defaults for a style that does not specify fog/lights (doc §4). */
export const FALLBACK_LIGHTING = {
  fog: { color: FALLBACK_PALETTE.skyHorizon, nearM: 300, farM: 1500 },
  // Elevation 14 matches the angle sky.ts uses for the sun DISC, so the visible
  // sun and the key light agree. At 6 deg the light was near-horizontal and
  // upward-facing terrain received ~10% of it, which rendered the ground far
  // darker than terrainLit (measured #4C200B vs #C99A6B).
  sun: { color: FALLBACK_PALETTE.sunDisc, intensity: 1.6, azimuthDeg: 255, elevationDeg: 14 },
  hemi: { sky: FALLBACK_PALETTE.skyMid, ground: FALLBACK_PALETTE.terrainShade, intensity: 0.75 },
} as const;

/**
 * Build a full style config from a loaded style JSON object, filling defaults.
 * Pure data work — no rendering, no side effects.
 */
export function completeStyle(
  partial: Partial<FullStyleConfig> & { id: string; clearColor: HexColor },
): FullStyleConfig {
  const base: FullStyleConfig = {
    id: partial.id,
    clearColor: partial.clearColor,
    palette: partial.palette ?? FALLBACK_PALETTE,
    fog: partial.fog ?? FALLBACK_LIGHTING.fog,
    sun: partial.sun ?? FALLBACK_LIGHTING.sun,
    hemi: partial.hemi ?? FALLBACK_LIGHTING.hemi,
    renderScale: partial.renderScale ?? 1,
    msaa: partial.msaa ?? 0,
  };
  return withPaletteDefaults(base);
}
