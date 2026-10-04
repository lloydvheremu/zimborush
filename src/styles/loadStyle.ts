import type { StyleConfig } from '../renderer/IRenderer';

/**
 * Relative URL: resolves against the document, so it works in dev, in the
 * production build, and when the build is hosted at a sub-path. Same-origin
 * only — there are no external network requests.
 */
const STYLE_URL = 'styles/lowpoly.json';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Fetches and validates the style JSON. Throws (with a descriptive message)
 * on HTTP failure, bad JSON, or a shape that does not match StyleConfig.
 */
export async function loadStyle(): Promise<StyleConfig> {
  const response = await fetch(STYLE_URL);
  if (!response.ok) {
    throw new Error(`loadStyle: fetch "${STYLE_URL}" failed with HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  return validateStyle(data);
}

function validateStyle(data: unknown): StyleConfig {
  if (typeof data !== 'object' || data === null) {
    throw new Error('loadStyle: style JSON must be a non-null object');
  }
  const record = data as Record<string, unknown>; // guarded above; values are re-checked below
  const id: unknown = record['id'];
  const clearColor: unknown = record['clearColor'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('loadStyle: "id" must be a non-empty string');
  }
  if (typeof clearColor !== 'string' || !HEX_COLOR.test(clearColor)) {
    throw new Error('loadStyle: "clearColor" must be a #RRGGBB string (e.g. "#FFC46B")');
  }
  return { id, clearColor };
}
