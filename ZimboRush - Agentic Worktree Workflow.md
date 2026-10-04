# ZimboRush — Agentic Worktree Workflow

Orchestrator + verified subagents, each atomic task isolated in its own git worktree.
Status: **PROPOSED** — not active until the Phase 0 gate below is satisfied.

---

## 0. The blocker (measured, not assumed)

I tested worktree behaviour against this repo rather than reasoning about it. Two results matter:

| Test | Result | Meaning |
|---|---|---|
| `git worktree add -b task-a` from **unborn HEAD** | **exit 0 — succeeds** | Worktrees can be created, which was the opposite of my first assumption |
| Two worktrees commit independently, then `git merge-base task-a task-b` | **exit 1 — no common ancestor** | The fatal one: independent commits from unborn HEAD are **unrelated roots** |
| `git checkout main` (as merge target) | `error: pathspec 'main' did not match` | There is no `main` branch to merge into |

**Conclusion:** with no baseline commit, two subagents working in parallel produce two disconnected histories that have no merge base. A 3-way merge is impossible; every integration would be a manual file-by-file reconstruction, and "conflict detection" would have nothing to compare. Git version here is 2.51.0.

There is also uncommitted work: **23 untracked entries**, including the complete, verified Step 1 + Step 2 source. A worktree does not carry uncommitted files, so a task worktree created now would see an **empty tree** (only `.git`) — as my first test confirmed: `ls /tmp/wt-test-wt` showed nothing but `.git`.

**Therefore Phase 0 is mandatory and comes first.** No subagent wave starts before it.

---

## 1. Roles and authority

| Role | Who | Owns | Never does |
|---|---|---|---|
| **Orchestrator** | me (main session) | briefs, dispatch, independent verification, `git merge`, conflict resolution, final report | writes feature code inside a task worktree |
| **Executor** | 执行者 (`rw,exec`) | implementation inside its own worktree, its own commits | merges; pushes; touches another task's worktree |
| **Researcher** | 研究员 (`rw,web,exec`) | read-only investigation; may record facts to a workspace file | edits source |
| **Reviewer** | 审阅者 (`ro,web,exec`) | independent checks; reports evidence, no edits | edits source (read-only target) |
| **Architect** | 规划师 / 分析师 (`ro`) | task decomposition, dependency ordering | writes files (read-only target) |

**Why the executor does not run the acceptance test on its own work:** the agent that writes the code is the worst judge of whether it works. Verification is a separate phase with a different agent and an independent method. Executors still run local checks (typecheck, build) because a broken commit wastes a whole verify cycle — but those are self-checks, not acceptance.

---

## 2. Phase 0 — git baseline (prerequisite, orchestrator-only)

Destructive-adjacent: **undoable if wrong**. Must be applied from the exact approved revision.

1. **Decide what is tracked.** Measured state:

   | Path | Size | Proposal |
   |---|---|---|
   | `src/` `index.html` `vite.config.ts` `tsconfig.json` `package.json` `package-lock.json` `scripts/` `public/` | small | **track** |
   | `.pi/plan.md` | 16 KB | **track** (decision log) |
   | `dirt_racer-pi-context/` | 40 KB | **track** (source of truth per README) |
   | `README.md`, the two `*.md` docs | small | **track** |
   | 9 × `*.jpeg` art references | ~680 KB total | **track** — worktrees need them for the step-3 facet comparison |
   | `dist/` | 552 KB | ignored (already in `.gitignore`) |
   | `node_modules/` | 105 MB | ignored (already in `.gitignore`) |
   | `.zwork/` | — | ignored (already in `.gitignore`) |

2. **Create the baseline commit** on `main`, with `user.name`/`user.email` configured (none currently set, so a commit will fail without them).
3. **Verify the gate** — all three must hold before any wave:
   - `git log --oneline -1` prints one commit;
   - `git branch` shows `main`;
   - a scratch worktree created from `main` contains `src/main.ts` (proves the tree propagates, not just `.git`).
4. **Delete the scratch worktree.** Phase 0 is not done until the scratch check passes and is removed.

**Gate:** no subagent is dispatched until step 3 passes. If it fails, the plan stops and I report which check failed.

---

## 3. Phase 1 — briefs (one per atomic task)

Each brief carries the seven fields the delegation contract requires. The two that get skipped and must not be:

- **Boundary** — which files the task owns, and explicitly which sibling owns what it must not touch. Children are blind to each other; the partition exists only if written down.
- **Acceptance** — checkable criteria, one per line, taken from the design doc's per-step pass/fail column. An executor with no acceptance criteria cannot self-check, and the verify phase has nothing to test against.

Brief template (filled example in §10):

```
Goal:      <one sentence, executable by a stranger>
Boundary:  owns <files/modules>; sibling owns <other>; do not touch <the rest>
Facts:     <what is already settled — e.g. "Step 2 verified: tsc clean, 8/8 cadence self-check">
Acceptance: <checkable line>
            <checkable line>
Deliverable: <commits + a short answer with workspace-relative paths>
Forbidden: <specific bans beyond the boundary>
```

---

## 4. Phase 2 — parallel execution

**One task = one branch = one worktree**, named by the atomic task:

```bash
git worktree add ../zimborush-wt-<task> -b task/<task> main
```

- Executor works only inside its own worktree, committing there.
- Each task branch is cut from `main` at the same baseline, so all task branches share a real merge base — the exact thing §0 showed is missing today.
- `node_modules` is not shared: each worktree needs its own `npm install` or a reuse strategy (§8).
- Executors run `npx tsc --noEmit` before committing. A commit that fails typecheck is a wasted wave.

**Wave width:** dispatch in a wave, converge with `subagent_wait {all:true}`. Practical width is capped by RAM and disk, not by ambition (§8).

---

## 5. Phase 3 — independent verification (orchestrator, non-negotiable)

This is the heart of the request: **I verify; subagents do not mark their own work done.**

For each task branch I run the verification **myself, outside the executor's worktree**, so the artifact already on disk at task time cannot influence the result:

| Check | Method | Pass condition |
|---|---|---|
| Typecheck | `npx tsc --noEmit` in the task worktree | no output, exit 0 |
| Build | `npm run build` | succeeds; expected chunks present |
| Behaviour | drive the built app in headless Chrome over CDP (`?burn=`, `?stage=`, `?ladder=nosettle`) | asserted console output matches the brief |
| Budget | `npm run size` | within the step's stated budget |
| Regression | re-run the previous step's checks | still green |
| Independent read | dispatch 审阅者 against the diff | reports evidence, not opinion |

I record pass/fail **per criterion with the raw output**, not a summary verdict. A criterion I could not run is reported as not run — never as passed.

---

## 6. Phase 4 — merge (orchestrator-only)

Only after Phase 3 passes:

```bash
git checkout main
git merge --no-ff task/<task> -m "step N: <task>"
```

- Executors never merge, never push, never rebase another branch.
- One task per merge, so a bad integration is attributable to exactly one branch.
- `main` is the integration branch and is never left dirty.

---

## 7. Conflict policy

Conflicts are expected, not exceptional. Detection first, resolution second:

1. **Prevent by partition.** Overlap is a briefing error, not a merge skill. Two tasks may share a *seam* (e.g. an interface file) but never the same file's body. Interfaces are frozen in Phase 0 or by a dedicated interface task that must merge *before* its consumers.
2. **Detect before merging.** `git merge-tree task/a task/b` predicts a conflict without touching the working tree, so an incompatible pair is caught while both branches are still cheap to redo.
3. **Resolve in the orchestrator only.** Trivial conflicts (adjacent hunks, both-additive) I resolve directly.
4. **Escalate semantic conflicts.** When two branches disagree about *what the code should do* (not just which lines survive), I do not silently pick a winner. That is a design decision: I stop, state both sides with their evidence, and ask.
5. **Never resolve by discarding a side to make the merge quiet.** If a branch's work cannot be preserved, say so plainly.
6. **Abandon cleanly.** A task that cannot merge is removed with `git worktree remove` + branch delete, and its status is reported as abandoned — not omitted.

---

## 8. Isolation, throughput and measured limits

| Constraint | Measured value | Consequence |
|---|---|---|
| Free disk on `/home` | **17 GB** (88% used) | Comfortable but not unlimited |
| `node_modules` per worktree | **105 MB** | 4 concurrent worktrees ≈ 420 MB of duplicated dependencies |
| Node/npm | v24.20.0 / npm 11.19.0 | each worktree can `npm install` independently |
| Install time observed | ~22 s (warm cache) | worktree setup is cheap; plan for it per task |

**Proposed width: 3 concurrent worktrees** (orchestrator + 3 tasks ≈ 315 MB). Widen only after measuring real memory during a wave.

**Banned:** worktrees outside the project (they live beside it, e.g. `../zimborush-wt-<task>`), `git worktree` on a shared `node_modules`, committing `dist/` or `node_modules/`, and any subagent pushing or rewriting history.

---

## 9. Mapping to the design doc's implementation order

§14 of the design document already defines eleven steps with pass/fail checks — that is the task list. Natural atomic cuts:

| Design step | Task | Verifier |
|---|---|---|
| 3 World + fly-through | spline/heightfield; road+terrain; sky/sun; fly path | typecheck + `?fly=1` CDP capture + facet screenshot |
| 4 Style JSON + palette + MSAA | full `StyleConfig`; MSAA path + measurement | `?msaa=4` vs `0` pixel diff |
| 5 Bike + camera + ladder | FP bike/camera; input; `setMsaa` real | forced-ladder test (`fly` + `burn`) |
| 6 Physics | arcade physics; deviation check | heightfield deviation max ≤ 0.05 m, mean ≤ 0.02 m |
| 7–8 Rival, shadows, scatter | rival; dust; instancing | draw-call ≤ 15, tri ≤ 45k |

Interface tasks (`IRenderer` extensions, `StyleConfig` fields) merge **before** their consumers to avoid the §7 seam problem.

---

## 10. Worked example — the first real wave

**Phase 0 gate must pass first.** Then, for design step 3, three tasks cut by *independent source area*:

```
Task A — track/heightfield
  owns:      src/game/track/heightfield.ts, src/game/track/rng.ts
  not touch: src/renderer/**, src/game/track/road.ts (sibling B)
  acceptance: deterministic for a fixed seed (same output twice)
              heightfield sampled at grid vertices matches §6 tolerance later
  deliverable: commits on task/track-heightfield

Task B — road ribbon + terrain mesh
  owns:      src/game/track/road.ts, src/game/track/terrain.ts
  not touch: src/game/track/heightfield.ts (sibling A owns the interface)

Task C — sky/sun + lighting
  owns:      src/styles/lowpoly/*, src/game/sky.ts
  not touch: src/game/track/**
```

Then: converge → I verify each branch in its own worktree → merge A, then B, then C → re-run the whole check set on integrated `main`.

---

## 11. Open decisions

1. **Baseline scope** — confirm the §2.1 file set, especially the 9 art `.jpeg`s (680 KB, needed *inside* worktrees for step-3 facet comparison).
2. **Wave width** — 3 concurrent worktrees proposed; raise only after a measured wave.
3. **Reviewer on every task, or only on `main`?** Per-task costs a verify pass per branch; per-merge is cheaper but catches conflicts later.
4. **Does the orchestrator write code at all?** Proposed: only conflict resolution and interface seams, so verification stays independent.
