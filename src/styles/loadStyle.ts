import type { FullStyleConfig, HexColor, StylePalette } from '../renderer/contracts';

/**
 * Relative URL: resolves against the document, so it works in dev, in the
 * production build, and when the build is hosted at a sub-path. Same-origin
 * only — there are no external network requests.
 */
const STYLE_URL = 'styles/lowpoly.json';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The shape this loader accepts: the two fields every style must carry, plus any
 * of the extended fields `completeStyle` knows how to default. Returned as a
 * PARTIAL so the defaults live in one place (`styles/styleConfig.ts`) and this
 * module only has to guarantee that whatever IS present is the right type.
 */
export type LoadedStyle = Partial<FullStyleConfig> & { id: string; clearColor: HexColor };

/**
 * Fetches and validates the style JSON. Throws (with a descriptive message)
 * on HTTP failure, bad JSON, or a field of the wrong type.
 *
 * Fixed defect (visual patch, P3). This function used to return
 * `{ id, clearColor }` only — it destructured those two fields out and dropped
 * every other key. The consequence was that the palette, fog and light settings
 * in `public/styles/lowpoly.json` were **never read at all**: the whole scene
 * silently ran on `FALLBACK_PALETTE` / `FALLBACK_LIGHTING` from
 * `styleConfig.ts`, so any edit to the style JSON — the documented way to
 * re-skin the game ("style as config", design doc §4) — had no effect. It was
 * found by changing a palette value, seeing no pixel change, and reading the
 * loader instead of assuming a caching problem.
 *
 * It now validates and passes the extended fields through. Unknown keys are
 * ignored rather than rejected, so a style can carry authoring notes.
 */
export async function loadStyle(): Promise<LoadedStyle> {
  const response = await fetch(STYLE_URL);
  if (!response.ok) {
    throw new Error(`loadStyle: fetch "${STYLE_URL}" failed with HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  return validateStyle(data);
}

/** Requires a `#RRGGBB` string, or throws with the field name. */
function requireHex(value: unknown, field: string): HexColor {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new Error(`loadStyle: "${field}" must be a #RRGGBB string (e.g. "#FFC46B")`);
  }
  return value;
}

/** Requires a finite number, or throws with the field name. */
function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`loadStyle: "${field}" must be a finite number`);
  }
  return value;
}

/**
 * Reads the palette if present. Only the keys the contract declares are copied,
 * so a stray key cannot leak into the palette object; a missing key is left
 * absent for `withPaletteDefaults` to fill.
 */
function readPalette(value: unknown): Partial<StylePalette> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('loadStyle: "palette" must be an object');
  }
  const source = value as Record<string, unknown>;
  const keys: readonly (keyof StylePalette)[] = [
    'skyHorizon',
    'skyMid',
    'skyZenith',
    'sunDisc',
    'hillsDistant',
    'terrainLit',
    'terrainShade',
    'dirt',
    'road',
    'roadTrack',
    'foliage',
    'rock',
    'bikeMetal',
  ];
  const out: Partial<StylePalette> = {};
  for (const key of keys) {
    const raw = source[key];
    if (raw === undefined) {
      continue;
    }
    out[key] = requireHex(raw, `palette.${key}`);
  }
  return out;
}

function validateStyle(data: unknown): LoadedStyle {
  if (typeof data !== 'object' || data === null) {
    throw new Error('loadStyle: style JSON must be a non-null object');
  }
  const record = data as Record<string, unknown>;

  const id: unknown = record['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('loadStyle: "id" must be a non-empty string');
  }
  const clearColor = requireHex(record['clearColor'], 'clearColor');

  const out: LoadedStyle = { id, clearColor };

  const palette = readPalette(record['palette']);
  if (palette !== undefined) {
    out.palette = palette as StylePalette;
  }

  const fog = record['fog'];
  if (fog !== undefined) {
    if (typeof fog !== 'object' || fog === null) {
      throw new Error('loadStyle: "fog" must be an object');
    }
    const f = fog as Record<string, unknown>;
    out.fog = {
      color: requireHex(f['color'], 'fog.color'),
      nearM: requireNumber(f['nearM'], 'fog.nearM'),
      farM: requireNumber(f['farM'], 'fog.farM'),
    };
  }

  const sun = record['sun'];
  if (sun !== undefined) {
    if (typeof sun !== 'object' || sun === null) {
      throw new Error('loadStyle: "sun" must be an object');
    }
    const s = sun as Record<string, unknown>;
    out.sun = {
      color: requireHex(s['color'], 'sun.color'),
      intensity: requireNumber(s['intensity'], 'sun.intensity'),
      azimuthDeg: requireNumber(s['azimuthDeg'], 'sun.azimuthDeg'),
      elevationDeg: requireNumber(s['elevationDeg'], 'sun.elevationDeg'),
    };
  }

  const hemi = record['hemi'];
  if (hemi !== undefined) {
    if (typeof hemi !== 'object' || hemi === null) {
      throw new Error('loadStyle: "hemi" must be an object');
    }
    const h = hemi as Record<string, unknown>;
    out.hemi = {
      sky: requireHex(h['sky'], 'hemi.sky'),
      ground: requireHex(h['ground'], 'hemi.ground'),
      intensity: requireNumber(h['intensity'], 'hemi.intensity'),
    };
  }

  if (record['renderScale'] !== undefined) {
    out.renderScale = requireNumber(record['renderScale'], 'renderScale');
  }
  if (record['msaa'] !== undefined) {
    out.msaa = requireNumber(record['msaa'], 'msaa');
  }

  return out;
}
