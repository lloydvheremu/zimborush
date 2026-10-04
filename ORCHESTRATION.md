# ZimboRush — Orchestration Plan & Task Registry

The orchestrator's live control file. **Read this before dispatching or merging anything.**
Design doc: `ZimboRush v1 Design Document.md` · Workflow: `ZimboRush - Agentic Worktree Workflow.md`

Rules in force: **3 concurrent worktrees** · **review every task before merge** · §2.1 file set.

---

## 1. Status board

Legend: ✅ done · 🔄 in progress · ⏳ not started · 🔒 blocked · ❌ abandoned

| # | Task | Design ref | Wave | Owner | Status |
|---|---|---|---|---|---|
| 1 | Scaffold (Vite + TS + three, IRenderer, WebGL2 adapter, loader, size script) | §14.1 | — | orchestrator | ✅ |
| 2 | Telemetry + cadence probe + quality core + fixed-timestep loop | §14.2 | — | orchestrator | ✅ |
| 0 | Phase 0: git baseline commit + worktree merge-base gate | workflow §2 | — | orchestrator | ✅ |
| 3 | Freeze seams (rng, contracts ×2, sceneGraph, compose) | §3 | S | orchestrator | ✅ |
| 4 | Heightfield + RoadSpline | §14.3 | 1 | 执行者 | ✅ |
| 5 | Sky dome + sun disc + sunset lighting | §14.3 | 1 | 执行者 | ✅ |
| 6 | Distant hill ring | §14.3 | 2 | 执行者 | ✅ |
| 7 | Terrain mesh from heightfield | §14.3 | 2 | 执行者 | ✅ |
| 8 | Road ribbon + shoulders + wheel tracks | §14.3 | 2 | 执行者 | ✅ |
| 9 | Style layer (ColorSource, palette, completeStyle) + style JSON | §14.4 | 3 | orchestrator | ✅ |
| 10 | WorldView mesh factory + `setScene` seam — **scene became visible** | §14.3 | 3 | orchestrator | ✅ |
| 11 | **Step 3 gate**: sunset scene renders end to end | §14.3 | 3 | orchestrator | ✅ |
| 12 | MSAA render-target path + real `setMsaa` + `?msaa=N` | §14.4 | 3 | orchestrator | ✅ |
| 13 | Deterministic scripted fly-through rig | §14.3/§12 | 4 | 执行者 | ✅ |
| 14 | Arcade bike physics + interpolated snapshot state | §14.6 | 4 | 执行者 | ✅ |
| 15 | Synthesized engine audio (gesture-gated) | §14.10 | 4 | 执行者 | ✅ |
| 16 | FP camera rig + keyboard input + HUD speed number | §14.5 | 3 | orchestrator | ✅ |
| 17 | Rival rider (spline-following, curvature speed, rubber-band) | §14.7 | 5 | 执行者 | ✅ |
| 18 | Instanced prop scatter + baked prop shadow data | §14.8 | 5 | 执行者 | ✅ |
| 19 | Dust sprites + blob shadows | §14.7 | 5 | 执行者 | ✅ |
| 20 | Bench harness 3-run median on the fly path | §14.9 | — | ⏳ |
| 21 | Streaming test (a style module loading post-boot) | §14.11 | — | ⏳ |
| 22 | Size gate as CI check (compressed / zip / raw) | §14.11 | — | ⏳ |
| 23 | 20-min soak on real hardware | §14.11 | — | 🔒 needs devices |
| 24 | Step 3 visual approval: facet scale + palette vs `3-low-poly.jpeg` | §14.3 | — | 🔒 owner |
| 25 | Touch input (auto-throttle, screen halves) | §11 | — | ⏳ ergonomics UNVERIFIED |
| 26 | WebGPU adapter | deferred | — | ⏳ settled as never in initial download |

**Not wired into the scene yet:** the scatter (`props.ts`, `shadows.ts`), dust and blob
shadows (`fx/`) and the rival (`rival/`) are merged and typecheck clean, but `main.ts`
does not instantiate them. Wiring them is the next orchestrator task (see §5).

---

## 2. Ownership ledger — one writer per file

**If a file is not listed, it belongs to the orchestrator and no subagent may touch it.**

| File / area | Owner | Notes |
|---|---|---|
| `src/main.ts` | **orchestrator only** | composition root — the single biggest hotspot |
| `src/core/**` | orchestrator | loop, cadence, quality, telemetry, rng |
| `src/renderer/**` | orchestrator | IRenderer, webgl2, sceneGraph, contracts |
| `src/world/**` | orchestrator | contracts, compose, view |
| `src/styles/**` | orchestrator | styleConfig, loadStyle |
| `src/game/hud/**`, `src/game/input/**` | orchestrator | HUD, keyboard |
| `src/game/track/heightfield.ts`, `road.ts` | task 4 (merged) | |
| `src/game/sky.ts` | task 5 (merged) | |
| `src/game/track/hills.ts` | task 6 (merged) | |
| `src/game/track/terrain.ts` | task 7 (merged) | |
| `src/game/track/roadMesh.ts` | task 8 (merged) | |
| `src/game/bench/scripted.ts` | task 13 (merged) | |
| `src/game/bike/**` | task 14 (merged) | |
| `src/audio/engine.ts` | task 15 (merged) | |
| `src/game/rival/**` | task 17 (merged) | |
| `src/game/scatter/**` | task 18 (merged) | |
| `src/game/fx/**` | task 19 (merged) | |
| `tsconfig.json`, `package.json`, `vite.config.ts` | orchestrator | config changes are serialized |

---

## 3. Frozen seams

Frozen by the orchestrator in wave S and merged before any parallel wave. Consumers
import them; a task that needs a change **stops and reports** instead of editing.

| Seam | Contents |
|---|---|
| `src/core/rng.ts` | `createRng`, `hashSeed`, `hashNoise1` — the only determinism source |
| `src/renderer/contracts.ts` | `FullStyleConfig`, `StylePalette`, `ColorSource`, `DerivedColorRule`, `BUDGET` |
| `src/renderer/sceneGraph.ts` | 10 named slots with fixed render order |
| `src/world/contracts.ts` | `ITerrainSource`, `ISplineSource`, `IPropSource`, `PropRecord`, `SpawnContext`, `WorldParts` |
| `src/world/compose.ts` | provider validation; contains no geometry |

**Semantic frozen into the contract:** `ISplineSource.pointAt` is **plan-view with y = 0**
and is NOT ground height. Consumers add `terrain.heightAt(x, z)` themselves. Added after
wave 1, when a verification harness assumed otherwise and reported a false 5.9 m deviation.

---

## 4. Verification record

Every merge was gated on the orchestrator re-running checks, never on an executor's claim.

| Wave | Task | Independent result |
|---|---|---|
| S | seams | tsc clean; **12/12** rng determinism checks (mean 0.50097, label separation, state round-trip) |
| 1 | 4 heightfield+road | **14/15** — road is a closed loop (0.000 m seam gap), 96×96 grid, heights −7.19..+7.07 m, deterministic |
| 1 | 5 sky+sun | **11/11** — 848 tris ≤ 1500, 3 draws, 2 lights, dome r=400 < far 500, sun 6° |
| 2 | 6 hills | 4992 tris, 2 tints, inner radius 232 m (> 192 m corridor half-extent) |
| 2 | 7 terrain | 18,432 tris exactly; vertices on `heightAt` to 2.4e-7 m |
| 2 | 8 road ribbon | 3920 tris, 3 tints; draped on `heightAt` to 2.6e-7 m |
| 2 | integrated | **10/10** — all builders agree; scene total 27,344 tris vs 45k ceiling |
| 3 | 10 setScene | found + fixed: renderer drew its own placeholder, world invisible (100% clear colour) |
| 3 | 12 MSAA | found + fixed: ShaderMaterial blit skipped sRGB conversion (frame #320D03 vs #7A401D → now #7A401C vs #7A401D) |
| 4 | 13 fly | 14.3 m/s, 60 s loop, deterministic |
| 4 | 14 bike | off-road penalty confirmed in-scene: HUD 30 km/h = the 8.4 m/s off-road cap |
| 4 | 15 audio | 1 file, no binary media, gesture-gated |
| 5 | 17/18/19 | all three tsc clean; branches byte-verified before merge |

### Bugs found by measuring, not by trusting logs

1. **World never rendered** — `WebGL2Renderer` drew its own step-1 placeholder scene.
   Fixed by adding `setScene(scene)` to `IRenderer`. Verified: 1 → 1264 distinct colours.
2. **Double colour multiplication** — materials set a colour *and* geometries carried
   vertex colours, so the road rendered ~35% too dark. Materials are now white.
3. **Sun too low** — 6° elevation left upward-facing terrain at ~10% light (ground
   `#4C200B` vs `terrainLit #C99A6B`). Raised to 14° to match the sun disc angle.
4. **MSAA colour space** — hand-written `ShaderMaterial` blit skipped sRGB conversion,
   darkening the whole frame. Replaced with `MeshBasicMaterial({ map })`.
5. **Cadence probe hung on a hidden tab** — the duration cap sat after the visibility
   early-return, so `await probeCadence()` never resolved and boot never completed.

---

## 5. Next actions (in order)

1. **Wire the merged-but-unused modules into `main.ts`** — rival, scatter, dust, blob
   shadows. Needed before the step-3 visual gate can be judged, since the reference
   image shows a rival and props.
2. **Baked prop shadows onto terrain vertex colours** (`shadows.ts` returns the discs;
   `terrain.ts` owns the writable colour buffer).
3. **Bench harness** (§14.9): 5 s warmup, 60 s window, 3-run median, JSON log line.
4. **Step 3 visual gate** — owner approval of facet scale and palette vs the reference.
5. **Steps 11/22:** size gate as a CI check, streaming test, then the soak on real devices.

---

## 6. Conflict policy

1. Prevent by partition — §2 is the barrier.
2. Predict before merging: `git merge-tree <a> <b>`.
3. Resolve textual conflicts in the orchestrator.
4. **Escalate semantic conflicts** (branches disagree on behaviour) to the owner.
5. Never resolve by discarding a side to quiet the merge.
6. Abandon cleanly (`git worktree remove` + branch delete) and report it.

**Stray-file incident (wave 5):** two executors' `write` calls resolved to the primary
workspace instead of their worktree. Both strays were verified byte-identical to the
committed branch versions (sha256 `33ac31a0…`, `8c02b5d8…`) before removal, so no work
was lost. **Mitigation for future briefs:** state the absolute worktree path as the only
write target.

---

## 7. Change log

| Date | Change |
|---|---|
| 2026-10-04 | Created. Phase 0 complete. Seam-freeze (wave S) adopted. |
| 2026-10-04 | Waves 1–2 merged (6 scene modules, 10/10 integrated verification). |
| 2026-10-04 | Step 3 live: scene renders. Steps 4–10 merged (MSAA, fly rig, bike, audio). |
| 2026-10-04 | Wave 5 merged (rival, scatter, fx). Steps 20–23 remain open; soak blocked on hardware. |
