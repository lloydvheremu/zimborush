# ZimboRush — Step 1: Project Scaffold

## 1. Pinned dependency versions (exact, no `^`/`~`)

| Package | Version | Section |
|---|---|---|
| three | **0.178.0** | dependencies (runtime) |
| @types/three | **0.178.0** | devDependencies |
| vite | **7.0.0** | devDependencies |
| typescript | **5.8.3** | devDependencies |
| fflate | **0.8.2** | devDependencies — the one allowed zip dependency, imported **only** by `scripts/size-report.mjs`, never from `src/`, so it can never appear in `dist/` |

Caveat (also listed in §Assumptions): I have no live registry access, so "current stable" is the latest I can vouch for from knowledge. Run `npm view <pkg> version` to confirm; `@types/three` should always match `three`'s minor version.

Two files beyond your listed structure were unavoidable: `package.json` (pinned versions and the `dev`/`build`/`size` scripts have nowhere else to live) and `tsconfig.json` (strict mode has nowhere else to live). They are the only additions — no README, no .gitignore, no tests, nothing else.

## 2. Files in full (structure order)

**package.json** *(substrate — see note above)*

```json
{
  "name": "zimborush",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "size": "npm run build && node scripts/size-report.mjs"
  },
  "dependencies": {
    "three": "0.178.0"
  },
  "devDependencies": {
    "@types/three": "0.178.0",
    "fflate": "0.8.2",
    "typescript": "5.8.3",
    "vite": "7.0.0"
  }
}
```

**tsconfig.json** *(substrate — see note above)*

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "useDefineForClassFields": true
  },
  "include": ["src", "vite.config.ts"]
}
```

**index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ZimboRush</title>
    <style>
      /* Canvas-only page: no menus, no HUD. */
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
      }
      body {
        /* The plain-text fallback message must stay readable on this background. */
        background: #000;
        color: #fff;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <canvas></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

**vite.config.ts**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works when hosted at any sub-path (web game portals).
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // three gets its own chunk (requirement); app code stays in the entry chunk.
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
```

**public/styles/lowpoly.json**

```json
{
  "id": "lowpoly",
  "clearColor": "#FFC46B"
}
```

**scripts/size-report.mjs**

```js
#!/usr/bin/env node
/**
 * ZimboRush — dist size report (runs after `vite build`; use `npm run size`).
 *
 * Metrics per file and in total:
 *   raw    — bytes on disk
 *   gzip   — node:zlib gzipSync, level 9
 *   brotli — node:zlib brotliCompressSync, default quality 11
 *   zip    — fflate zipSync (dev-only dependency, used exclusively by this
 *            script; it never enters the browser bundle)
 *
 * Zip semantics: the per-file "Zip (B)" column is a one-file archive of that
 * file (comparison only). The TOTAL row's zip is ONE archive of the entire
 * dist output — that is the reported zip size.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import process from 'node:process';
import { zipSync } from 'fflate';

const DIST_DIR = 'dist';

/** Recursively collect { rel, bytes } for every regular file under `dir`. */
function collectFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, base, out);
    else if (entry.isFile()) {
      out.push({ rel: relative(base, full).split(sep).join('/'), bytes: readFileSync(full) });
    }
  }
  return out;
}

const fmt = (n) => n.toLocaleString('en-US');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const files = collectFiles(DIST_DIR);
if (files.length === 0) {
  console.error(`size-report: "${DIST_DIR}/" is empty or missing — run "npm run build" first.`);
  process.exit(1);
}
files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

const rows = files.map((f) => ({
  rel: f.rel,
  raw: f.bytes.length,
  gzip: gzipSync(f.bytes, { level: 9 }).length,
  brotli: brotliCompressSync(f.bytes).length,
  zip: zipSync({ [f.rel]: f.bytes }).length,
}));

const totals = rows.reduce(
  (acc, r) => {
    acc.raw += r.raw;
    acc.gzip += r.gzip;
    acc.brotli += r.brotli;
    return acc;
  },
  { raw: 0, gzip: 0, brotli: 0 },
);

// One archive of the whole dist output — the reported zip size.
const distZip = zipSync(Object.fromEntries(files.map((f) => [f.rel, f.bytes])));

const NUM_W = 13;
const nameW = Math.max('File'.length, ...rows.map((r) => r.rel.length)) + 2;
const num = (n) => fmt(n).padStart(NUM_W);
const rule = '-'.repeat(nameW + NUM_W * 4);

console.log(`ZimboRush dist size report — ${rows.length} file(s) under ${DIST_DIR}/`);
console.log(
  `${'File'.padEnd(nameW)}${'Raw (B)'.padStart(NUM_W)}${'Gzip (B)'.padStart(NUM_W)}${'Brotli (B)'.padStart(NUM_W)}${'Zip (B)'.padStart(NUM_W)}`,
);
console.log(rule);
for (const r of rows) {
  console.log(`${r.rel.padEnd(nameW)}${num(r.raw)}${num(r.gzip)}${num(r.brotli)}${num(r.zip)}`);
}
console.log(rule);
console.log(`${'TOTAL'.padEnd(nameW)}${num(totals.raw)}${num(totals.gzip)}${num(totals.brotli)}${num(distZip.length)}`);
console.log('');
console.log(`Total raw:     ${fmt(totals.raw)} B  (${kb(totals.raw)})`);
console.log(`Total gzip:    ${fmt(totals.gzip)} B  (${kb(totals.gzip)})`);
console.log(`Total brotli:  ${fmt(totals.brotli)} B  (${kb(totals.brotli)})`);
console.log(`Zip (entire dist, one archive): ${fmt(distZip.length)} B  (${kb(distZip.length)})`);
console.log(
  'Note: the TOTAL "Zip (B)" is one archive of the whole dist output; per-file zip values are single-file archives, listed for comparison only.',
);
```

**src/main.ts**

```ts
import { PerspectiveCamera } from 'three';
import { loadEager } from './assets/loader';
import { WebGL2Renderer } from './renderer/webgl2';
import type { TierId } from './renderer/IRenderer';

/**
 * Opaque tier label passed to the renderer. "default" is a placeholder —
 * not a decision; the concrete tier set is settled elsewhere.
 */
const TIER: TierId = 'default';

const FOV_DEG = 70;
const NEAR = 0.1;
const FAR = 500;

function requireCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas');
  if (canvas === null) {
    throw new Error('main: no <canvas> element found in index.html');
  }
  return canvas;
}

/**
 * SINGLE ISOLATED FUNCTION — the whole WebGL2 availability policy.
 * Returns true when WebGL2 is available. When it is not, replaces the page
 * with a short plain-text message and returns false; the caller then stops
 * booting. Nothing throws on this path. v1 requires WebGL2; there is no
 * other backend. If that policy ever changes, change only this function.
 */
function ensureWebGL2OrStop(): boolean {
  const probe = document.createElement('canvas'); // throwaway probe; the real canvas stays untouched
  if (probe.getContext('webgl2') === null) {
    document.body.textContent =
      'ZimboRush needs WebGL2. This browser does not provide it, so the game cannot start here.';
    return false;
  }
  return true;
}

async function start(): Promise<void> {
  const canvas = requireCanvas();
  if (!ensureWebGL2OrStop()) {
    return; // message shown; stop quietly — no throw
  }

  // Eager phase: the style JSON is loaded and validated before the first frame.
  const eager = await loadEager();

  const renderer = new WebGL2Renderer();
  renderer.init(canvas, eager.style, TIER);

  const camera = new PerspectiveCamera(
    FOV_DEG,
    window.innerWidth / window.innerHeight,
    NEAR,
    FAR,
  );
  camera.position.set(0, 2.3, 6);
  camera.lookAt(0, 1.15, 0);

  // Window resize: re-size the drawing buffer and the camera projection.
  // The closure is created once at boot, never per frame.
  const onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.resize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  // Render loop. Zero per-frame allocation:
  // - `frame` is one function, created once and re-registered by reference;
  // - every call reuses the same renderer and camera objects;
  // - nothing inside constructs objects, arrays or closures.
  const frame = (): void => {
    renderer.render(camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Boot. A boot failure (e.g. style fetch) is reported on one console line.
start().catch((reason: unknown) => {
  console.error('[ZimboRush] boot failed:', reason);
});
```

**src/assets/loader.ts**

```ts
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
```

**src/renderer/IRenderer.ts**

```ts
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
```

**src/renderer/webgl2.ts**

```ts
import {
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Camera } from 'three';
import type { IRenderer, RenderStats, StyleConfig, TierId } from './IRenderer';

/** Colour of the placeholder proof mesh — not an art direction decision. */
const PLACEHOLDER_COLOR = '#8A6A4F';

/**
 * TODO(DPR) — PLACEHOLDER, NOT A DECISION.
 * Test devices and the DPR policy are deferred by the owner. Until they are
 * settled, the placeholder policy is: min(devicePixelRatio, 2).
 */
function placeholderDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/** WebGL2 adapter on top of three.js' WebGLRenderer. */
export class WebGL2Renderer implements IRenderer {
  private renderer?: WebGLRenderer;
  private scene?: Scene;
  private placeholderMesh?: Mesh;
  private placeholderGeometry?: IcosahedronGeometry;
  private placeholderMaterial?: MeshBasicMaterial;
  private cssW = 1;
  private cssH = 1;
  private renderScale = 1;
  private readonly statsObject: RenderStats = { backend: 'webgl2', drawCalls: 0, triangles: 0 };

  init(canvas: HTMLCanvasElement, style: StyleConfig, _tier: TierId): void {
    // _tier: accepted per the interface; no tier-dependent behaviour exists in this step.
    if (this.renderer !== undefined) {
      throw new Error('WebGL2Renderer.init: already initialized — call dispose() first.');
    }

    // Context-level antialias is OFF by requirement; multisampling is a
    // render-target concern, not a context-creation flag.
    const renderer = new WebGLRenderer({ canvas, antialias: false });
    this.renderer = renderer;

    const cssW = canvas.clientWidth > 0 ? canvas.clientWidth : window.innerWidth;
    const cssH = canvas.clientHeight > 0 ? canvas.clientHeight : window.innerHeight;
    this.cssW = cssW;
    this.cssH = cssH;
    const dpr = placeholderDpr();
    renderer.setPixelRatio(dpr * this.renderScale);
    renderer.setSize(cssW, cssH, false); // the page stylesheet owns the CSS size
    renderer.setClearColor(style.clearColor);

    // PLACEHOLDER SCENE — exists only to prove the pipeline renders; it is
    // not game content.
    const scene = new Scene();
    const geometry = new IcosahedronGeometry(1.1, 0);
    const material = new MeshBasicMaterial({ color: PLACEHOLDER_COLOR });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(0, 1.15, 0);
    this.placeholderGeometry = geometry;
    this.placeholderMaterial = material;
    this.placeholderMesh = mesh;
    scene.add(mesh);
    this.scene = scene;

    // Boot log — exactly one line.
    const gl = renderer.getContext();
    console.log(
      `[ZimboRush] backend=webgl2 glVersion=${String(gl.getParameter(gl.VERSION))} ` +
        `glRenderer=${String(gl.getParameter(gl.RENDERER))} ` +
        `maxTextureSize=${String(gl.getParameter(gl.MAX_TEXTURE_SIZE))} dpr=${dpr}`,
    );
  }

  realize(_diff: unknown): void {
    throw new Error('WebGL2Renderer.realize: not implemented until step 3');
  }

  render(camera: Camera): void {
    const renderer = this.requireRenderer();
    // Placeholder spin — mutation only; nothing is allocated per frame.
    const mesh = this.placeholderMesh;
    if (mesh !== undefined) {
      mesh.rotation.y = performance.now() * 0.0006;
    }
    renderer.render(this.requireScene(), camera);
  }

  resize(cssW: number, cssH: number): void {
    const renderer = this.requireRenderer();
    if (!Number.isFinite(cssW) || cssW <= 0 || !Number.isFinite(cssH) || cssH <= 0) {
      throw new RangeError('WebGL2Renderer.resize: cssW and cssH must be finite and > 0');
    }
    this.cssW = cssW;
    this.cssH = cssH;
    // DPR is re-read on every resize so display moves are picked up
    // (still the placeholder policy — see TODO above).
    renderer.setPixelRatio(placeholderDpr() * this.renderScale);
    renderer.setSize(cssW, cssH, false);
  }

  setRenderScale(s: number): void {
    if (!Number.isFinite(s) || s <= 0) {
      throw new RangeError('WebGL2Renderer.setRenderScale: s must be finite and > 0');
    }
    this.renderScale = s;
    this.resize(this.cssW, this.cssH);
  }

  setMsaa(_samples: number): void {
    throw new Error('WebGL2Renderer.setMsaa: not implemented until step 4');
  }

  stats(): RenderStats {
    const info = this.requireRenderer().info;
    // Same object every call, mutated in place — zero allocation.
    this.statsObject.drawCalls = info.render.calls;
    this.statsObject.triangles = info.render.triangles;
    return this.statsObject;
  }

  dispose(): void {
    // Idempotent: safe before init and after a previous dispose.
    this.placeholderMesh = undefined;
    if (this.placeholderGeometry !== undefined) {
      this.placeholderGeometry.dispose();
      this.placeholderGeometry = undefined;
    }
    if (this.placeholderMaterial !== undefined) {
      this.placeholderMaterial.dispose();
      this.placeholderMaterial = undefined;
    }
    this.scene = undefined;
    if (this.renderer !== undefined) {
      this.renderer.dispose();
      this.renderer = undefined;
    }
  }

  private requireRenderer(): WebGLRenderer {
    if (this.renderer === undefined) {
      throw new Error('WebGL2Renderer: not initialized — call init() first.');
    }
    return this.renderer;
  }

  private requireScene(): Scene {
    if (this.scene === undefined) {
      throw new Error('WebGL2Renderer: scene is missing — init() was not called.');
    }
    return this.scene;
  }
}
```

**src/styles/loadStyle.ts**

```ts
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
```

## 3. Commands to run

```bash
# Prerequisites: Node.js >= 20.19 and npm >= 7 (Vite 7 requirement; on Node 18, pin vite 6.3.5 instead).
npm install
npm run dev        # dev server; placeholder scene over the style clear colour
npm run build      # tsc --noEmit (typecheck) then vite build -> dist/
npm run size       # build + size report (raw / gzip / brotli / zip)

# Optional verification:
npx tsc --noEmit                                        # must print nothing, exit 0
grep -ri webgpu dist || echo "dist: no webgpu tokens"    # Windows: findstr /spi webgpu dist\*
```

## 4. Pass-criteria checklist

1. **`npm run dev` boots and shows the placeholder scene — YES (by construction).** `index.html` → `/src/main.ts` → `WebGL2Renderer.init` (clear colour from `lowpoly.json`, one flat-coloured low-poly icosahedron) → rAF loop. Needs one live run to observe; I could not execute a browser here.
2. **Backend log line — YES.** Exactly one `console.log` in `WebGL2Renderer.init` with `backend=webgl2`, the GL version string, renderer string, max texture size, and the DPR used.
3. **Separate chunk for three — YES (by construction).** `manualChunks: { three: ['three'] }`; appears as `dist/assets/three-<hash>.js` in the report's per-file table.
4. **`npm run size` prints all four metrics, total well under 1 MB — YES on the script (by construction); the number needs one run.** Expected ≈ 0.5–0.8 MB raw, ≈ 0.1–0.2 MB gzip/brotli/zip (estimate — see §5).
5. **WebGL2-unavailable path — YES.** The whole policy is one function, `ensureWebGL2OrStop()`: on absence it writes the plain-text message via `document.body.textContent` and returns `false`; `start()` returns immediately; nothing throws.
6. **TypeScript strict, zero errors and zero warnings — YES (by construction).** tsc has no warning tier; `npx tsc --noEmit` must print nothing and exit 0 (strict + noUnusedLocals + noUnusedParameters).
7. **No per-frame allocation — YES (by review).** How I checked: the per-frame path is only rAF-callback `frame` (one function, registered by stable reference) → `renderer.render(camera)` → adapter `render()`: `performance.now()` (primitive), `mesh.rotation.y` mutation, three render call. I read every statement on that path and grepped `src/` for `new `, object/array literals and arrow functions — none execute per frame (resize handler and boot allocations run once; `stats()` reuses one object; `updateProjectionMatrix` is event-driven).

**Hard-rule confirmation:** `dist/` contains **no WebGPU-related chunk** — no source file imports or references it, and the only three entry used is `'three'` (the WebGL renderer). Verify after build with `grep -ri webgpu dist` (expect no matches).

## 5. Assumptions and things I could not verify

- **Files beyond the listed structure:** only `package.json` and `tsconfig.json`, as unavoidable substrate (pinned versions, the three npm scripts, and strict mode have nowhere else to live). Nothing else was created.
- **"Current stable versions" could not be checked live** (no network access here). Pins are the latest stable versions known to me; run `npm view <pkg> version` to confirm. If `@types/three@0.178.0` is not published, move both `three` and `@types/three` to the nearest published matching pair. If the environment is Node 18, use vite `6.3.5`.
- **Not execution-verified:** I could not run a browser, dev server, build, or the size script here. Dev boot, chunk names and byte totals are construction-verified; the size estimates (≈0.5–0.8 MB raw, ≈0.1–0.2 MB compressed) come from experience with tree-shaken three WebGL bundles and must be replaced by the actual `npm run size` output.
- **Zip metric semantics** (documented in the script): per-file zip = a one-file archive (comparison only); the TOTAL zip = one archive of the whole `dist/` output.
- **`build` includes `tsc --noEmit`** before `vite build`, so the typecheck evidence lives inside the three required script names; `size` = build then report, as specified.
- **Placeholder scene includes a slow spin** of the proof mesh (one mutation per frame) to show the loop animates; delete the three lines in `render()` if a static mesh is preferred.
- **`index.html` carries a minimal `<style>` block** (canvas sizing + readable fallback text) — read as part of "canvas", since "nothing else" was defined as no menus/HUD.
- **The style JSON is fetched same-origin at runtime** (mandated by the spec); it fails on `file://` — serve over http(s). This is the only runtime fetch in the app; it is not an external request.
- **Tier label `'default'` and DPR policy `min(devicePixelRatio, 2)` are placeholders, not decisions** — the DPR one carries the required TODO comment in a single function.