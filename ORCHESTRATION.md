# ZimboRush — Orchestration Plan & Task Registry

The orchestrator's live control file. **Read this before dispatching or merging anything.**
Baseline: `main` @ `20c6e83`. Workflow design: `ZimboRush - Agentic Worktree Workflow.md`.

Rules in force: **3 concurrent worktrees** · **review every task before merge** · §2.1 file set.

---

## 1. Status board

Legend: ✅ done · 🔄 in progress · ⏳ not started · 🔒 blocked

| # | Task | Design ref | Wave | Owner | Status |
|---|---|---|---|---|---|
| 1 | Scaffold (Vite + TS + three, IRenderer, WebGL2 adapter, loader) | §14.1 | — | orchestrator | ✅ |
| 2 | Telemetry + cadence probe + quality core + fixed loop | §14.2 | — | orchestrator | ✅ |
| 0 | Phase 0: baseline commit + merge-base gate | workflow §2 | — | orchestrator | ✅ |
| 3 | Freeze seams (contracts, rng, sceneGraph, world composition root) | §3 | S | orchestrator | 🔄 |
| 4 | Heightfield + Rng + RoadSpline | §14.3 | 1 | executor | ⏳ |
| 5 | Sky dome + sun disc + sunset lighting rig | §14.3 | 1 | executor | ⏳ |
| 6 | Distant hill ring | §14.3 | 1 | executor | ⏳ |
| 7 | Terrain mesh from heightfield | §14.3 | 2 | executor | ⏳ |
| 8 | Road ribbon + shoulders + wheel tracks | §14.3 | 2 | executor | ⏳ |
| 9 | Mist band + warm horizon fog | §14.3 | 2 | executor | ⏳ |
| 10 | Scripted fly-through rig (deterministic bench path) | §14.3/§12 | 3 | executor | ⏳ |
| 11 | Full StyleConfig + palette + scene assembly for step 3 | §14.3/§4 | 3 | orchestrator | ⏳ |
| 12 | **Step 3 gate**: sunset mood, facet side-by-side vs reference | §14.3 | — | orchestrator + owner | ⏳ |
| 13 | MSAA render-target path + `setMsaa` real + measurement | §14.4 | — | ⏳ |
| 14 | FP bike + camera rig + keyboard/touch input + interpolation | §14.5 | — | ⏳ |
| 15 | Arcade physics + mesh-vs-heightfield deviation check | §14.6 | — | ⏳ |
| 16 | Rival rider (spline-following) + blob shadows + dust sprites | §14.7 | — | ⏳ |
| 17 | Instanced scatter + baked prop shadows | §14.8 | — | ⏳ |
| 18 | Bench harness on the fly path (5 s warmup, 60 s window, 3-run median) | §14.9 | — | ⏳ |
| 19 | Synthesized engine audio, gesture-gated | §14.10 | — | ⏳ |
| 20 | Size gate + streaming test + 20-min soak | §14.11 | — | ⏳ |
| 21 | HUD speed number (DOM, step 5+ per design order) | §3 | — | ⏳ |

---

## 2. Ownership ledger — one writer per file

This is the whole conflict-prevention mechanism. **If a file is not listed, it belongs to the orchestrator and no subagent may touch it.**

| File / area | Owner | Notes |
|---|---|---|
| `src/main.ts` | **orchestrator only** | composition root — the single biggest hotspot. No subagent ever writes it. |
| `src/core/**` | orchestrator | loop, cadence, quality, telemetry — all verified |
| `src/renderer/IRenderer.ts` | orchestrator | frozen interface |
| `src/renderer/webgl2.ts` | orchestrator | verified |
| `src/renderer/contracts.ts` | **orchestrator** (wave S) | frozen seam; consumers read, never edit |
| `src/renderer/sceneGraph.ts` | **orchestrator** (wave S) | scene attachment seam |
| `src/world/contracts.ts` | **orchestrator** (wave S) | frozen world seams |
| `src/world/compose.ts` | **orchestrator** (wave S) | world composition root |
| `src/core/rng.ts` | **orchestrator** (wave S) | shared determinism seam |
| `src/game/track/heightfield.ts` | task 4 | |
| `src/game/track/road.ts` | task 4 | |
| `src/game/sky.ts` | task 5 | |
| `src/game/track/hills.ts` | task 6 | |
| `src/game/track/terrain.ts` | task 7 | |
| `src/game/track/roadMesh.ts` | task 8 | |
| `src/game/atmosphere.ts` | task 9 | |
| `src/game/bench/scripted.ts` | task 10 | |
| `src/styles/loadStyle.ts`, `public/styles/*.json` | task 11 | palette + full config |
| `src/game/bike/**`, `src/game/camera/**`, `src/game/input/**` | task 14 | later wave |
| `src/game/physics/**` | task 15 | later wave |
| `src/game/rival/**`, `src/game/fx/**` | task 16 | later wave |
| `src/game/scatter/**` | task 17 | later wave |
| `src/audio/**` | task 19 | later wave |
| `tsconfig.json`, `package.json`, `vite.config.ts` | orchestrator | config changes are serialized |

**Why this is enforceable:** the ownership ledger plus the seam contract files means two tasks in the same wave never name the same file. Each task's brief repeats its own row and names the siblings' rows as "do not touch".

---

## 3. The seam decision (why wave S exists)

Three tasks need to know about each other's data, but a child cannot call a sibling. The seam is therefore **frozen first, by the orchestrator, as an interface file**:

- A task **imports** the interface and **does not edit** it.
- If a task needs the interface changed, it **stops and reports** rather than editing — a change request comes back to me, I apply it, and I re-baseline before the next wave.
- Freezing the seam removes the single most common conflict in parallel work: two tasks editing the same type definitions.

Wave S is deliberately serial and small (4 files, no rendering logic) so it cannot itself become a conflict source.

### Seams frozen in wave S

1. **`src/renderer/contracts.ts`** — extends `StyleConfig` beyond `{id, clearColor}` for step 3 (sky/fog/light colors, optional `renderScale`, `msaa`). Draw-call/triangle budget constants.
2. **`src/renderer/sceneGraph.ts`** — the one place scene objects attach, with named child slots so two builders cannot collide on a name.
3. **`src/world/contracts.ts`** — `ITerrainSource`, `ISplineSource`, `IPropSource`, `IColorSource`, `SpawnContext`, `PropRecord`, `WorldParts`.
4. **`src/world/compose.ts`** — a plain function that checks every provider is non-null and returns `WorldParts`. **It contains no geometry**, so the orchestrator owning it does not violate "orchestrator writes no feature code".
5. **`src/core/rng.ts`** — shared seeded PRNG. Determinism is required by §3.2 of the design doc (seeded, repeatable tracks), and it is a hard dependency of four tasks; freezing it avoids four divergent copies.

---

## 4. Wave sequence

| Wave | Tasks | Rule |
|---|---|---|
| **S** | 3 (seams) | serial, orchestrator-only, must merge before wave 1 |
| **1** | 4, 5, 6 | 3 parallel worktrees; disjoint files |
| **2** | 7, 8, 9 | starts only after wave 1 merges (7 and 8 consume wave-1 seams) |
| **3** | 10 (parallel), 11 (serial) | fly rig is self-contained; the main.ts integration is orchestrator-only |

### Why tasks 7 and 8 wait for wave 1

`terrain.ts` (7) imports `heightfield.ts` (4). `roadMesh.ts` (8) imports `road.ts` (4). Merging a consumer before the interface it consumes is exactly the seam problem §7 of the workflow doc warns about. Wave 1 must be green on `main` first.

---

## 5. Per-task verification (orchestrator, independent)

Every task, in its own worktree, before any merge:

| Check | Pass condition |
|---|---|
| `npx tsc --noEmit` | no output, exit 0 |
| `npm run build` | succeeds, expected chunks |
| Behaviour | headless-Chrome CDP capture; asserted console/marker output from the brief |
| Budget | `npm run size` within the step's stated budget |
| Regression | previous steps' checks still green on integrated `main` |
| Independent read | 审阅者 briefed on the diff; reports evidence |
| Determinism (where claimed) | same seed twice → identical output |

Merge only after all of the above. One `--no-ff` merge per task, then re-run the full set on `main`.

---

## 6. Conflict policy

1. Prevent by partition — the ledger in §2 is the barrier.
2. Predict before merging: `git merge-tree <a> <b>` while branches are still cheap to redo.
3. Resolve textual conflicts myself, in the orchestrator.
4. **Escalate semantic conflicts** (branches disagree on behaviour) to you — never silently pick a winner.
5. Never resolve by discarding a side to quiet the merge.
6. Abandon cleanly (`git worktree remove` + branch delete) and report the abandonment.

---

## 7. Change log

| Date | Change |
|---|---|
| 2026-10-04 | Created. Phase 0 complete (`20c6e83`). Seam-freeze (wave S) adopted to remove `main.ts` and contract-file contention. |
