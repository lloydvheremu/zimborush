# ZimboRush — v1 Design Document (Patched, Complete)

Replaces the consolidated v1 document and all deltas. One document, current truth.

## Changelog

| Fix | Section(s) | Change |
|---|---|---|
| 1 | §5 | Triangle budget re-cut: sum ≈ **43.9k** vs 45k planning ceiling (50k phone cap unchanged, PROPOSED) |
| 2 | §5 | Full itemized draw-call table: **15 draws** (14 low tier); rocks correctly counted as 3 draws |
| 3 | §9 | Cadence measured in a **bare rAF loop before first render**, snapped to known rates, frozen; overload + Low Power Mode policies stated |
| 4 | §12, §14 | Deterministic scripted fly-through built at **step 3**; used for steps 3–5; step-9 bench reuses the same path |
| 5 | §14 | Terrain-mesh vs analytic-height deviation check at **step 6**, tolerance 0.05 m max / 0.02 m mean (ESTIMATE) |
| 6 | §7 | Per-style gate reworded: two explicit outcomes — **phone-supported** or **desktopOnly** |
| 7 | §6 | Styles split: **config-only** (3, 4, 5, 8) vs **code-module** (1, 2, 6, 7, 9); each code module ≤ 1 MB streamed gate |
| 8 | §4 | Trunks, clouds, rival, shadows: derived; distant purple-maroon hills: authored → **authored palette 12 → 13** |
| 9 | §5 | Shadows: baked terrain shading + blobs; dust ≤ 12 sprites, 1 draw, counted in both tables, cut first on low tier; both DEFAULTs pending owner approval |
| 10 | §4, §14 | Flat shading via fragment-derivative normals; step-3 side-by-side facet check vs reference |
| 11 | §10, §14 | Size gate reports **compressed transfer, zip size, raw size** (portal metric UNVERIFIED) |

---

## 2. Status

**SETTLED (locked, do not re-argue):**

| Item | Value |
|---|---|
| Name | ZimboRush |
| Engine | Three.js |
| Rendering | WebGL2 first; WebGPU is an optional later adapter, lazy-loaded, **never in the initial download** |
| Frame rate | 60 fps target |
| Audio | Synthesized engine sound, no audio files |
| Initial build | 5–8 MB; everything else streams after gameplay starts |
| Styles | Nine art styles, built one by one, cheapest first; fallback: only the cheapest styles |
| Originality | All assets original; reference image is the owner's own AI-generated low-poly image |

Everything outside this table is **PROPOSED**. Deferred items in §3.

## 3. Scope, deferred items, module structure

**Scope (PROPOSED, unchanged):** first-person view over handlebars of an original dirt bike; winding dirt road through low-poly hills at sunset; one rival; DOM speed-number HUD; boots straight into the scene; multiplayer hooks only; Vite build.

**DEFERRED (owner set aside):** candidate floor devices (iPhone X, Galaxy S10), the DPR 2.0 cap, and all pixel-count claims. Device-dependent gates below read "on the chosen test devices (TBD)"; thresholds are refresh-rate-relative. The candidate devices and DPR policy move into the Deferred bucket until the owner picks hardware.

```text
src/
├─ main.ts               boot: loader ∥ cadence probe → style → loop
├─ assets/loader.ts      eager boot manifest + streaming registry
├─ core/loop.ts          fixed 60 Hz sim + interpolated variable-rate render
├─ core/quality.ts       cadence probe, ladder state machine, burn flag
├─ core/rng.ts, core/events.ts
├─ renderer/             IRenderer, webgl2 adapter, sceneGraph, primitives
├─ styles/               loadStyle.ts (JSON), lowpoly/ (style 1 bindings)
├─ styles/modules/       streamed code-module styles (2, 6, 7, 9) — post-boot only
├─ game/track/           spline, heightfield, scatter + shadow bake
├─ game/bike/            physics, input, state (prev+curr snapshots)
├─ game/rival/, game/camera/fpRig.ts, game/fx/dust.ts
├─ game/bench/scripted.ts  deterministic fly-through (built at step 3)
├─ game/hud/speed.ts, game/telemetry.ts
├─ audio/engine.ts, net/transport.ts (stub)
```

## 4. Art direction, palette, flat shading (PROPOSED)

Reference: the owner's own AI-generated low-poly image — FP handlebars, winding dirt road, rival mid-distance, rolling faceted hills, trees, rocks, warm sunset sky, sun near horizon, **purple-maroon distant hills**, soft cast shadows, dust puffs behind the rival.

**Authored palette — 13 colors (was 12; +1):**

| Key | Est. hex | Note |
|---|---|---|
| skyHorizon / skyMid / skyZenith | #FFC46B / #FF9552 / #E07A5F | warm-only sky gradient, no purple in sky (ESTIMATE) |
| sunDisc | #FFE9C4 | emissive |
| **hillsDistant** | #6E4A5E | **new, authored**: the purple-maroon distant hill band in the ref |
| terrainLit / terrainShade | #C99A6B / #8A6A4F | |
| road / roadTrack | #C4A269 / #A5854F | |
| foliage / rock / bikeMetal / accent | #5E6B45 / #9A8B7A / #2E2A26 / TBD | accent = the only saturated color in view |

**Derived (engine code, fixed rules — never authored):** tree trunks = terrainShade × 0.85 value; clouds = sunDisc lightened ~10%; rival jersey = accent hue-rotated 180°; rival bike = bikeMetal; blob shadow = terrainShade × 0.6 value, fixed alpha (~0.35, ESTIMATE); baked prop shadow = multiplicative darkening (~×0.75, ESTIMATE); mid hills = mix(terrainShade, hillsDistant) by distance band; fog = skyHorizon; hemisphere sky/ground = skyMid / terrainShade; rock variants ×0.85 / ×0.70; foliage variant ×0.85.

**Flat shading (fix 10):** materials use `flatShading: true` (Lambert-family, PROPOSED) — face normals are computed in the fragment shader from screen-space derivatives (dFdx/dFdy, core WebGL2). Geometry stays **indexed** with vertex colors; no per-face vertex duplication (small buffers), no textures. Step 3 gate: side-by-side render of the ~96×96 corridor against the reference at a matched camera — judge facet scale/smoothness (ref = large gentle facets); adjust grid density or noise amplitude until the owner approves.

## 5. Scene budgets: triangles, draw calls, shadows, dust (PROPOSED)

**Triangle budget — sum ≈ 43.9k vs 45k planning ceiling (10% headroom under the 50k phone cap):**

| Element | Est. tris | Change from 50.1k |
|---|---|---|
| Sky dome + sun disc + 0–3 cloud slabs | ~1.5k | unchanged |
| Terrain corridor, 96×96 cells | ~18.4k | was "20k" (padded; 96×96 = 18,432 exactly) |
| Distant hill ring | ~5k | was 6k — fewer ring segments |
| Road ribbon + shoulders + tracks | ~4k | unchanged |
| Trees, 2 instanced variants | ~6k | was 8k — ~120 instances total (~50 tris each) |
| Rocks, 3 instanced variants | ~2.5k | was 3k — ~70 instances (~35 tris each) |
| FP bike visible parts | ~2.5k | unchanged |
| Rival bike + rider | ~4k | was 5k — simplified merge |
| Blob shadows (player + rival) | 4 tris | was ~0.1k — props now baked (below) |
| Dust sprites (≤ 12 quads) | 24 tris | new, counted (fix 9) |
| **Total** | **≈ 43.9k** | grass stays 0 on low tier |

**Draw-call budget — 15 total, cap 25 (~10 spare for streamed content):**

| # | Element | Draws |
|---|---|---|
| 1–3 | sky dome, sun disc (emissive), merged cloud slabs | 3 |
| 4–6 | terrain, hill ring, road ribbon | 3 |
| 7–8 | trees A, trees B (instanced) | 2 |
| 9–11 | rocks A, B, C — **3 separate instanced draws** | 3 |
| 12–13 | FP bike (merged), rival (merged) | 2 |
| 14 | blob shadows (player + rival, one buffer) | 1 |
| 15 | dust sprites (≤ 12 quads, one dynamic buffer) | 1 |
| — | HUD (DOM) | 0 |
| | **Total: 15** (14 on low tier — dust off) | |

**Shadows (DEFAULT, pending owner approval):** static props (trees, rocks) get shadow shading **baked into terrain vertex colors** at track build — each prop darkens a soft ellipse of terrain vertices (slight anti-sunward offset, ESTIMATE), deterministic from the seeded scatter, zero runtime cost. Player bike + rival use blob shadow quads.

**Dust (DEFAULT, pending owner approval):** ≤ 12 sprite quads (N = 12, ESTIMATE) spawned behind the rival, **one draw call**, ring buffer updated in place (no allocation). Transparent overdraw is why it is **cut first on the low tier** (off at start there), and it is the first ladder cut on any tier that has it.

## 6. Style system: config-only vs code-module (fix 7)

"Style = JSON config" holds only for config-only re-skins. The nine styles split (numbering per owner's plan; names are placeholders):

| Style | Type | Needs | Delivery |
|---|---|---|---|
| 1 — low-poly sunset (v1) | code-module, **in initial build** | flat-shading path, MSAA render-target pipeline, vertex colors | part of the 5–8 MB bundle |
| 2, 6, 7, 9 | code-module | render targets, custom shaders, post, or different geometry | streamed ES module, **≤ 1 MB compressed each** (gate) |
| 3, 4, 5, 8 | config-only | palette, fog, sky, lights, material slots, tiers | JSON, a few KB, streamed |

```ts
interface StyleModule {
  id: string;
  init(ctx: StyleModuleContext): Promise<void>;  // registers materials / post / geometry providers
  dispose(): void;
}
// dynamic import after gameplay starts; never in the initial download
```

Build order is cheapest-first (settled): v1, then config-only styles, then code modules — exact roster/sequence is an open item. Fallback (settled): if code modules overrun, ship v1 + config-only styles only.

## 7. Per-style gate (fix 6)

Every style ships in one of exactly two outcomes — nothing is blocked from merging:

- **(a) phone-supported** — on the chosen test devices (TBD): bench average frame time ≤ 1/T (§9); 20-min soak with the ladder never beyond stage 4; streamed addition within its size gate (≤ 1 MB code module / negligible JSON).
- **(b) flagged desktopOnly** — fails any phone criterion, but passes the same criteria on desktop (60 fps at desktop render scale, soak, size). The portal routes it to capable devices; it never silently runs slow on phones.

Both outcomes additionally require: backend parity screenshot diff within tolerance **when more than one backend exists** (WebGPU is deferred, so this criterion is inactive in v1) and originality review.

## 8. Renderer, MSAA, interpolation (PROPOSED)

`IRenderer` (init / realize / render / resize / setRenderScale / **setMsaa** / stats / dispose) as in the prior doc. v1 ships the WebGL2 adapter only (settled); the WebGPU adapter is a later streamed module implementing the same interface.

**MSAA architecture:** context always created with `antialias: false`. When style msaa > 0, the scene renders to a multisampled offscreen render target, resolved and copied to the canvas in one fullscreen pass; when msaa = 0, direct to the default framebuffer (no extra pass). `setMsaa` recreates the target at runtime — no context loss. The ladder's MSAA cut removes a fullscreen pass, which is why it sits late in the order. Open measurement: resolve+copy cost on the chosen devices (step 4); fallback = msaa 0 on the low tier.

**Interpolation:** sim fixed 60 Hz; render consumes interpolated poses (bike, rival, camera) between previous and current sim states. Required for the ladder's half-rate stage, high-refresh displays, and bench presentation. Snapshots mutated in place — zero per-frame allocation (hard rule).

## 9. Cadence detection & quality ladder (fix 3)

**Cadence probe — before the scene ever renders:** during asset load, a bare rAF loop (no rendering work) runs in parallel with the fetches; the first frame waits for it. Collect ≥ 30 interval samples (or ~1 s, ESTIMATE) while the document is visible; take the **median** and discard outliers beyond ±25%; **snap** to the nearest of {60, 90, 120, 144, 165} within ±8% (ESTIMATE) — unsnapped values are used raw and flagged `cadenceSnapped: false`. R is then **frozen**; re-probe only on visibility-regain or orientation change, never from in-game frame times.

**Why this fixes the misread:** an overloaded device inflates in-game frame times, so in-game minimum intervals could look like a 30 Hz display and relax the thresholds. With R frozen from the idle pre-render probe, overload during gameplay is correctly seen as overload, and the ladder engages.

**Performance target T = min(R, 60)** (implements the settled 60 fps target, refresh-relative below 60; v1 does not chase native rates above 60 — high-refresh presentation is PROPOSED for later).

**iOS Low Power Mode:** LPM caps rAF at 30 on a 60 Hz panel; the probe reads 30, R = 30, T = 30 — the game asks for 30, thresholds **tighten to the 30 fps goal rather than relaxing**, and `suspectedLowPowerMode` is logged (UNVERIFIED heuristic — no web API exposes panel rate or LPM state). LPM also slows CPU/GPU clocks, so ladder stages remain available below 30.

**Ladder (one-way per session, reset on reload; 10 s warmup, 5 s rolling frame count, 5 s hold — all ESTIMATE; disabled in bench):**

| Stage | Trigger (rolling avg frame time) | Action |
|---|---|---|
| 0 | — | style defaults; dust on if tier enables it |
| 0.5 | > 1.2 × (1/T) | dust off (if on) |
| 1–4 | persists | render scale 1.0 → 0.9 → 0.8 → 0.7 → 0.6 |
| 5 | persists | prop draw distance × 0.6 (fog hides the cut) |
| 6 | persists | MSAA → 0 (drops the resolve+copy pass) |
| 7 | > 1.5 × (1/T) | render at R/2 (only when R ≥ 60); sim stays 60 — terminal |

Protected from degradation: sky, sun, road, rival, FP bike, palette, sim rate. Deterministic verification via `?burn=N` (busy-wait N ms/frame): ladder must descend in the locked order, log every transition, and show no allocation spikes.

## 10. Assets, streaming, size plan & size gate (fix 11)

Loader phases: **eager** (style 1 JSON + engine + two bike GLBs — vertex-colored, no textures) before first frame; **streamed** (styles 2–9 modules/JSON, extra bikes, track chunks, hi-detail props) after gameplay starts (settled). No progress UI.

Size estimate: engine ~2 MB + code/UI ~1 MB + bikes ~0.5–1.5 MB + track ~KBs (procedural from seed) + audio 0 MB = **~2–3.5 MB compressed (ESTIMATE)**.

**Size gate — three numbers reported on every CI build:**

| Metric | Definition | CI limit (ESTIMATE) |
|---|---|---|
| Compressed transfer | as actually served (gzip or brotli — host-dependent, UNVERIFIED) | ≤ 4 MB |
| Zip size | zip of build output (some portals re-count uploads) | reported |
| Raw size | uncompressed bytes on disk | ≤ 8 MB |

UNVERIFIED: which metric any given portal counts — report all three until confirmed per portal. CI also asserts the WebGPU chunk is absent from the initial manifest (settled).

## 11. Bike, camera, input, rival (PROPOSED, carried)

Arcade physics at fixed 60 Hz (2D position, heading, speed, lean; y from the analytic heightfield; grip/accel penalties off-road; 2D circle collisions with props). FP camera rig on the interpolated pose: smoothed yaw, roll ≈ 0.35 × lean (capped ~6°), FOV 68→78 with speed, small roughness bob. Input: W/S/A/D keyboard; touch = auto-throttle, screen halves steer, both thumbs brake (ergonomics UNVERIFIED — playtest at step 5). Rival: spline-following with a curvature-based speed profile and ±8% rubber-band (ESTIMATE), implementing the same `RiderInput` interface a networked player would.

## 12. Bench, telemetry, scripted fly-through (fix 4)

`game/bench/scripted.ts` is built at **step 3**: a deterministic fly-through — camera follows the road spline at fixed arc-length speed with fixed look-ahead, seeded, input disabled, ~60 s loop, quality pinnable via URL (`?fly=1&msaa=4`). The same path serves:

- **Step 3** — scene/terrain performance and the facet side-by-side;
- **Step 4** — MSAA 4× vs 0 (identical pixels both runs);
- **Step 5** — forced-ladder test (fly + burn — no player input variance);
- **Step 9** — full bench: 5 s warmup, 60 s window, JSON log line {style, backend, R, snapped, tag, avg ft, p95, worst, draws, tris, transfer, heap?}, 3-run median.

Telemetry overlay (toggle key / 3-finger tap): avg fps, worst + p95 frame time, draw calls, triangles, transfer MB, heap where available (Chromium-only, degrade gracefully), R + snapped flag. Zero per-frame allocation.

## 13. Risks (re-ranked)

| # | Risk | Mitigation |
|---|---|---|
| 1 | Test devices TBD — no concrete device gates yet | All thresholds refresh-relative; owner picks hardware |
| 2 | Thermal throttling on chosen phones | 20-min soak gate (step 11) + ladder |
| 3 | MSAA resolve+copy pass cost | Step-4 measurement; fallback msaa 0 |
| 4 | Size metric ambiguity (portal counts zip/raw) | Report all three; UNVERIFIED |
| 5 | GC hitches on phones | No-alloc rule; worst-frame gates (steps 5, 8) |
| 6 | Cadence edge cases (odd rates, load-time spikes) | Median + snap + frozen R; step-2 validation |
| 7 | Baked shadows / dust look wrong | Both are DEFAULTs pending owner approval; steps 7–8 |
| 8 | Bench run-to-run variance | p95 + worst logged, 3-run median (step 9) |
| 9 | Terrain mesh deviates from height function | Step-6 deviation check with tolerance |
| 10 | Style code modules exceed 1 MB | Settled fallback: cheapest styles only |

## 14. Implementation order (pass/fail per step)

1. **Scaffold:** Vite + three eager chunk; `IRenderer` + WebGL2 adapter (WebGL2 required — no fallback in v1, settled); eager loader. ✅ boots on laptop + a phone; WebGL2 logged; cold load measured in all three size metrics.
2. **Telemetry + cadence probe + quality core.** ✅ overlay stable; `?burn=8` ≈ +8 ms avg; probe snaps 60 on a 60 Hz display and native on any high-Hz display available; probe defers while hidden.
3. **World + scripted fly-through:** spline, heightfield, road, terrain, hills, sky/sun; deterministic fly path. ✅ sunset mood; T met on available phone(s) at PROPOSED render scale; facet side-by-side vs reference approved by owner.
4. **Style JSON + palette + MSAA decision:** full `StyleConfig` realized; palette side-by-side vs reference; MSAA 4× vs 0 on the fly path. ✅ look changes via JSON only; MSAA default locked with numbers; low-tier fallback rule recorded.
5. **FP bike + camera + input + interpolation + ladder:** forced-ladder test (fly + burn). ✅ rideable lap; 5-min comfort OK; smooth at half-rate render; ladder order + logs correct.
6. **Physics + terrain deviation check (fix 5):** off-road, prop collisions; mesh-vs-H at all grid vertices + cell centers: **max ≤ 0.05 m, mean ≤ 0.02 m (ESTIMATE)**; road-on-terrain sampled the same way. ✅ no clipping; off-road slows; tolerances met.
7. **Rival + blob shadows + dust.** ✅ smooth laps, overtaking possible; dust ≤ 12 quads, 1 draw, visible mid/high tier.
8. **Instanced scatter + baked prop shadows.** ✅ ≤ 15 draw calls (14 low tier); ≤ 45k tris phone profile; baked shadows approved.
9. **Bench harness on the fly path.** ✅ two consecutive runs within ~5% avg frame time (UNVERIFIED target — tune).
10. **Synth engine audio.** ✅ gesture-gated start; zero bytes added.
11. **Size + streaming + soak:** three-metric CI gate; streamed test asset loads post-boot; WebGPU chunk absent from initial manifest; 20-min soak on chosen test devices (TBD); style 1 evaluated against the §7 gate. ✅ all gates green.

## 15. Remaining unknowns (each tied to a step)

- Test devices + DPR policy — blocks concrete gates (steps 2, 3, 11; owner decision)
- Palette hexes vs reference (step 4)
- MSAA 4× cost on chosen devices → low-tier default (step 4)
- Facet smoothness match to reference (step 3, owner approval)
- LPM probe heuristic + snap tolerance ±8% (step 2, needs an iOS device)
- Terrain deviation tolerances 0.05 / 0.02 m (step 6, ESTIMATE)
- Dust sprite count N = 12, shadow offset/opacity (steps 7–8, owner approval)
- Bench variance target ~5% (step 9)
- Synth sound acceptability (step 10)
- 50k cap / 25-draw validity on chosen devices (steps 3, 8)
- Which size metric portals count (step 11 + portal research)
- Style roster, names, build sequence (post-v1)

## 16. Over-budget risk flags

- **No fix adds initial bytes:** dust and baked shadows are runtime-free; fly-through, probe, and size gate are code at KB scale.
- **Watch:** the MSAA render-target path must not pull unneeded three.js modules into the eager chunk — tree-shaking verified at step 11.
- **Reporting risk, not byte risk:** if a portal counts **raw** size, the effective headroom inside 5–8 MB shrinks (raw ≈ 2× compressed, ESTIMATE) — UNVERIFIED per portal.
- GLB bike bloat remains the main real byte risk (~0.5–1.5 MB, step 11 audit).
- Style code modules are streamed by design; the only way they break the initial budget is if shared dependencies get promoted into the core — forbidden by the §6 gate.
