# ZimboRush — Visual & Controls Patch (orchestrator prompt)

You are the orchestrator for ZimboRush. Work under the existing rules in `ORCHESTRATION.md` and `ZimboRush - Agentic Worktree Workflow.md` (max 3 worktrees, one writer per file, you verify every merge yourself, executors never merge). This prompt is the source of truth for this patch. If it conflicts with an older doc, follow this prompt and list the conflict in your report.

## 0. Images attached to this message

- **Image A = TARGET.** `3-low-poly.jpeg`, an AI-generated reference that I made myself (original, safe to use for art direction). It is what the game must look like.
- **Image B = CURRENT.** A screenshot of the running build. It is the **failing** result. Save a copy of it as the baseline for before/after comparisons.

If you cannot view images, say so in your first line and use the written description below. Do not pretend to have compared them.

**Target, in words (Image A):** first-person view over the handlebars of a dirt bike. Wide pale handlebar with black grips, a red front fender and number plate at the bottom centre, brown fork tubes. A brown dirt road winds away through large, gently faceted **olive-green rolling hills**. Behind them, **layered purple-maroon ridgelines** fade into a **peach-to-pink sunset sky** with a low sun and 2 low-poly clouds. A rival rider sits mid-distance with a small dust puff. **Large** conifers and rounded trees, plus boulders, stand **close to the road**, with a few small grass tufts. Shadows are soft and cast; the lit and shaded sides of the facets contrast clearly.

**Current, in words (Image B):** the camera faces away from the road. The ground is a flat, uniformly dark orange-brown. There is no bike or handlebar. Only a thin, bright-yellow horizon strip is visible, with no purple hills. A blocky teal rival is at the far left. A few tiny dark trees sit at the horizon. The sky is saturated orange where the target is peach-pink.

## 1. Non-negotiables

- Original assets only. Never copy any other game's assets, branding or code.
- Initial-download budget stays 5–8 MB; this patch should add only a few KB of code. **No GLB/OBJ imports in this patch.** If any task would add more than ~20 KB raw, stop and report.
- Budgets (from `BUDGET` in `renderer/contracts.ts`): ≤ 45,000 triangles (currently 34,346) and ≤ 15 draw calls (currently 14). Report the new totals after every merge.
- Zero per-frame allocation. No new dependencies. No React or UI framework. No external requests.
- Frozen seams stay frozen (`core/rng.ts`, `renderer/contracts.ts`, `renderer/sceneGraph.ts`, `world/contracts.ts`, `world/compose.ts`). The **only** seam change this patch authorises is the palette `dirt` key in task P3, made by the orchestrator. Any other need for a seam change: stop and report.
- Everything unverified must be labelled UNVERIFIED. Do not invent measurements. A check you could not run is reported as "not run", never as passed.
- Do not restart or rewrite the codebase. This is a refactor-and-fix patch.

## 2. Why the previous verification missed this

Previous gates checked pixel colours and counts on software rendering, never the **composition** against the reference. From now on **every task ends with a screenshot gate** (section 4). A task is not done until I approve its screenshot.

## 2a. Research first, reuse first, do not reinvent the wheel

This is a refactor of the existing codebase using public knowledge, not a rebuild. Before each task, **search for an existing solution** and report what you found. Only write new code for what the search does not cover.

**Process for every task (P0–P5 and Wave D):**
1. Search the web (and GitHub) for existing implementations, techniques and write-ups of the specific problem: e.g. first-person motorcycle/vehicle camera rigs and lean, pure-pursuit path following, minimum-curvature or smooth closed-spline road generation, low-poly flat-shaded terrain with a hill ring and fog/haze, instanced low-poly trees and rocks, handlebar/cockpit overlays, dust and skid effects. Start with the official three.js documentation and examples.
2. For each candidate record: URL, **licence (verified from the repo or page, otherwise write UNVERIFIED)**, what it does, what you would take from it (an idea, a formula, or actual code), and the size/dependency cost.
3. Pick one approach and say why. List what you rejected and why.
4. Adapt it to our constraints. Do not paste in code you have not read, and do not add dependencies.

**Licence and originality rules:**
- Only adopt code under permissive licences (MIT, BSD, Apache-2.0, or CC0). **Never copy GPL/AGPL or unlicensed code.** Unverified licence means ideas only, no code.
- Copied or closely adapted code needs an attribution comment (source URL and licence) and an entry in a new `THIRD_PARTY.md`.
- Algorithms and techniques (pure pursuit, B-spline curvature limits, billboard dust) are not copyrightable. Prefer re-implementing them in our own style over importing code.
- Third-party **assets** (models, textures, audio) are out of scope for this patch. The project rule is original assets only, and whether CC0 packs count is my decision, not yours. Do not add any.
- Never use any other game's assets, branding or code, including Traffic Rider's.
- Our hard constraints still win over any reference: no framework in the game core, no new runtime dependencies, no GLBs, size budget intact, zero per-frame allocation, deterministic seeded generation.

**Known starting references (found by search; read them, do not fork them):**

| Source | Use it for | Licence |
|---|---|---|
| `1391819/interactive-low-poly-environment` | Material and lighting choices for the low-poly look (Basic / Lambert) | MIT (© Roberto Nacu) |
| `davidnekovarcz/three-js-traffic-run` | Module layout of a TypeScript three.js racing game (track, collision, scene) | MIT |
| `Caesor/racing-game` | Keyboard car-control structure (dated, 2015) | MIT |
| `pmndrs/racing-game` | Ideas for dust, trails and skids only. It uses React Three Fiber, which we cannot use | Assets CC0; repo licence not confirmed, UNVERIFIED |
| `brunosimon/folio-2019` | Vehicle controls ideas | Licence not confirmed, UNVERIFIED, so ideas only |

These are weak matches. None is a first-person bike game in this style, so expect to find better, more specific references yourself and prefer them.

**If you have no web access**, say so in your first line and tell me which tasks that blocks. Do not substitute memory for sources, and do not invent URLs or licences.

## 3. Findings to VERIFY before editing

These come from reading the code, not from running it. For each, reproduce it with a measurement or screenshot first. If a finding is wrong, say so and do not "fix" it.

| ID | Claim | Where | Evidence to produce |
|---|---|---|---|
| F1 | **Heading convention mismatch.** Physics, spline, rival and the road tangent use `heading = atan2(z, x)`, forward `(cos h, sin h)`. `placeBikeCamera` uses forward `(sin h, cos h)`: 90° off and mirrored. `fx/blobShadow.ts` and `fx/dust.ts` also assume `(sin h, cos h)` but are fed the `atan2(z, x)` heading. | `main.ts`, `fx/blobShadow.ts`, `fx/dust.ts` | Dot product of camera forward and road tangent at `s = 0` (expected ≈ 0, not ≈ 1) |
| F2 | **Camera far plane clips the hills.** `FAR = 500`, but the hill ring spans 232–780 m, so its tall outer part is clipped. Fog is 120–420 m, so the rest is fully fog-coloured. | `main.ts`, `hills.ts`, style JSON | Screenshot at `?view=overview`; compute hill fraction inside the frustum |
| F3 | **Camera roll sign.** `lean > 0` means leaning right, but `camera.rotateZ(+roll)` appears to roll the camera left. | `main.ts` | Drive a right turn; confirm the horizon tilts the wrong way |
| F4 | **Road centreline has near-cusp kinks** (your own note in `roadMesh.ts`: 96–168° turn between rows). `road.ts` scales control points by `cosA`, which can pull them close together. | `road.ts` | Report max \|curvature\| and minimum turn radius over the lap |
| F5 | **Off-road cap is 30 km/h** (8.4 m/s). With F1 and F4, the bike leaves the 7 m road almost immediately. | `physics.ts` | Fraction of steps `onRoad === false` under a scripted drive |
| F6 | **No first-person bike exists.** The `bike` scene slot is never filled and no task built it. `InterpolatedPose` has no `steer` field. | `main.ts`, `bike/state.ts` | Confirm the slot is empty |
| F7 | **Palette is brown/orange everywhere.** The target ground is olive green. `dust.ts` colours dust with `terrainLit`, so recolouring the ground would turn dust green. | `lowpoly.json`, `styleConfig.ts`, `dust.ts` | Sampled hexes vs target (see P3) |
| F8 | **Terrain is nearly flat** (±7 m over 384 m; face slopes 3–7°). The target has hills that enclose the road. | `heightfield.ts` | Silhouette angle from the start camera |
| F9 | **Props are tiny and far from the road.** Clearance is 6 m + 3.5 m, 120 trees over ~350 m, scale 0.8–1.25. | `props.ts`, `actors.ts` | Count props within 30 m of the road |

Report a verdict (confirmed / refuted / partly) for F1–F9 **before** starting any wave.

## 4. Screenshot gate (applies to every task)

1. Capture PNGs at the **same aspect ratio as Image A** (~1024×559), fixed seed `2026`, hands-off. Use the start camera (`?view=start`) and the overview (`?view=overview`). Capture on the deterministic fly path (`?fly=1`) at 3 fixed times as well.
2. Produce a side-by-side PNG: target on the left, current on the right.
3. Report these numbers as **proxies only, not proof**:
   - Region mean colours for sky-top, sky-horizon, far-hills band, near-ground left, near-ground right and road, for both target and current. **Sample the target hexes from Image A by eyedropper; do not guess them.**
   - The angular height above the horizon of the nearest ridge silhouette on each side of the road.
   - Count of props within 30 m of the road.
   - Triangles and draw calls.
4. Include a one-line verdict per element: sky / hills / ground / road / props / bike / rival / lighting, each "matches", "close" or "off".
5. **I make the final visual call.** Never write "matches the reference" on your own authority.

Software rendering (SwiftShader) is fine for colour and composition but says nothing about performance. Do not report frame times as evidence.

## 5. Tasks

Direction convention (decision): **keep the physics convention** (`h = atan2(z, x)`, forward `(cos h, sin h)`) everywhere. Do not change physics or the spline to suit the camera.

### Wave A — alone, because everything depends on it

**P0. One heading convention** (orchestrator: camera in `main.ts`; executor 1: `fx/blobShadow.ts`; executor 2: `fx/dust.ts`)
- Fix the camera forward vector, the blob-shadow long axis and the dust spawn direction to use the physics convention. Fix any doc comments that state the old one.
- Acceptance:
  - at `s = 0`, camera forward · road tangent ≥ 0.99
  - with `?auto=1` the road appears centred and runs up the middle of the frame
  - the rival's blob shadow aligns with the rival mesh
  - dust spawns behind the rival, not beside it
  - `tsc` clean; budgets unchanged
- Forbidden: touching physics, the spline, or the rival mesh's rotation (it is already correct).

### Wave B — up to 3 worktrees in parallel (after P0 is merged and I approve its screenshot)

**P1. Controls and rideability** (orchestrator: camera roll in `main.ts`; executor: `road.ts`; executor: `physics.ts`)
- Verify F3, F4 and F5 first. Then:
  - Fix the roll sign if F3 is confirmed.
  - Constrain the centreline so max |curvature| ≤ 1/25 m⁻¹ (ESTIMATE; tune it) and report the real value. It must stay seeded and deterministic, and `pointAt(0)` must equal `pointAt(lengthM)`.
  - Review the off-road penalty. Propose values but **do not change §11 design numbers without my approval**; give me before/after lap behaviour.
- Add an **autopilot harness** (orchestrator-only, uncommitted, served by Vite, like your other harnesses). It is a pure-pursuit controller feeding the real `BikeInput` through the real `bike.step`.
- Acceptance:
  - the autopilot completes a full lap
  - ≥ 99% of steps are on-road (ESTIMATE)
  - peak speed on the road reaches ≥ 80 km/h
  - A/D steer toward the matching side
  - the camera rolls into turns
  - a keyboard-driven manual test is reported separately and honestly as "not run by me" if you cannot do it
- If the autopilot cannot finish a lap, the track is at fault, not the input code. Say so.
- **Touch input** (task 25) stays out of this patch. Its ergonomics are UNVERIFIED and I will playtest first.

**P2. First-person bike** (new file `src/game/bike/fpBike.ts`; small addition to `bike/state.ts` to carry `steer` into `InterpolatedPose`; orchestrator wires it into `main.ts`; add a ledger entry)
- Build handlebars, grips, fork tubes and a red front fender/number plate from code primitives, as in Image A. Fill the empty `bike` slot.
- Bars rotate with steer and tilt with lean. Eyeline, bar position and size must look like Image A (bars across the lower third, fender bottom-centre).
- Acceptance:
  - ≤ 2.5k triangles
  - one draw call
  - vertex colours only
  - no per-frame allocation
  - no near-plane clipping of the bars at any steer or lean angle
  - the accent colour is sampled from Image A's red (it was TBD in the design doc)

**P3. Palette and lighting** (orchestrator: `contracts.ts` seam, `styleConfig.ts`, `lowpoly.json`; executor: `dust.ts` colour source)
- Sample the target colours from Image A by eyedropper: sky top / mid / horizon, sun, near hills, far hills, road, foliage, rocks, accent.
- Make `terrainLit` / `terrainShade` the **grass** pair. Add one new palette key, `dirt`, for road shoulders, tree trunks and dust. Update the derived rules and fallbacks accordingly. This is the one authorised seam change.
- Retune sun elevation/intensity and the hemisphere light so lit and shaded facets contrast like Image A. Record why in a comment. Previous finding: a 6° sun left up-facing terrain at ~10% light.
- Acceptance: the region mean colours are close to the sampled target values (report the deltas); dust is tan, not green; I approve the screenshot.

### Wave C — after Wave B is merged and approved

**P4. Terrain shape, far plane, fog** (executors: `heightfield.ts`, `hills.ts`; orchestrator: `main.ts` `FAR`, style JSON fog, `sky.ts` invariants)
- Make hills enclose the road: raise the low-frequency amplitude and shorten the wavelengths. Blend the corridor edge into the hill ring so there is no seam (the ring starts at height ≈ 0).
- Raise `FAR` above the ring's outer radius and update the invariants documented in `sky.ts` (dome, sun orbit).
- Move the fog out so the far purple hills stay visible. If fog cannot do it alone, say what you propose instead.
- Starting points (ESTIMATE; tune from screenshots): `FAR` ≈ 1000, fog ≈ 150–1000 m.
- Acceptance:
  - from the start camera, at least one ridge silhouette rises above the horizon on each side of the road
  - the purple-maroon band is visible
  - the horizon line is no longer a bright flat strip
  - **re-run the terrain-mesh vs `heightAt` deviation check** (max ≤ 0.05 m, mean ≤ 0.02 m). It is not on your status board and the new octaves may break it at 4 m cells. If it fails, report the options (reduce fine-octave amplitude, or finer grid with its triangle cost). Do not silently loosen the tolerance.
  - triangles and draws stay within budget

**P5. Props** (executor: `scatter/props.ts`, `world/actors.ts` is orchestrator)
- Larger trees and rocks, with a density bias toward 8–30 m from the road; reduce the road clearance; keep at least 2 tree and 3 rock variants. Per-instance triangle caps and total instance counts stay as they are.
- Add the rock and tree colour variation seen in Image A, via the palette.
- Acceptance: at least N props are visible within the first 100 m of the start view (propose N from Image A; ESTIMATE); no prop sits on the road; budgets unchanged.

### Wave D — later, one at a time

- Rival model: replace the 19-box figure with a bike-shaped silhouette (wheels as short prisms, rider posture). Keep it ≤ 4k triangles, one draw.
- Task 20b: apply baked prop-shadow discs to the terrain vertex colours (the target shows soft cast shadows).
- Then: bench harness, CI size gate, streaming test. The soak test stays blocked on devices.

## 6. Reporting format (after every task)

1. Files changed (and ownership-ledger updates).
2. F-finding verdicts for this task, with the evidence.
2a. Research log: sources searched, candidates with URL and licence (verified or UNVERIFIED), what you chose, what you rejected, and any code or formula taken (with its `THIRD_PARTY.md` entry). If you wrote something new, say what you searched for first and why nothing fit.
3. Screenshots: start view, overview, side-by-side with Image A, and the proxy numbers.
4. Triangles, draw calls, dist size (raw / gzip / brotli / zip).
5. `npx tsc --noEmit` and `npm run build` results, as run by **you**, not the executor's claim.
6. What you did **not** run, and why.
7. Anything that needs my decision.

## 7. Stop and ask me if

- A frozen seam needs to change (other than the one authorised key).
- A budget is exceeded or would be.
- A screenshot gate fails twice in a row on the same element.
- You cannot view Image A.
- The only suitable reference has a GPL/AGPL, unknown or unverified licence and you would need its code, or a task needs a new dependency.
- You are about to write a substantial new system without having searched for an existing approach first.
- Two branches disagree about behaviour (semantic conflict).
- Any claim above turns out to be wrong. Say which, with evidence, and propose the corrected plan.
