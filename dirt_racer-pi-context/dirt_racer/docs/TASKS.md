# TASKS

Do ONE task at a time, in order. Do not start the next task until the current one is done and reported. Mark a task done here when finished, with the measured built size.

## Phases (overview, from the project plan)
0. Decide rules: exclusivity, originality, size budget. (done except Poki exclusivity, which is open)
1. Tech prototype: one bike riding on a road in first person, steady frame rate on a mid laptop and a phone; measure download size from day one. **<- current**
2. Vertical slice: one polished track, one bike, basic effects, one weather type; one-click load.
3. Single-player game: more bikes, tracks, weather (streamed), ghost races, mobile support.
4. Multiplayer: small lobbies, username profanity filter, CrazyGames invite features.
5. Launch: CrazyGames first, then Y8, Kongregate, itch.io; apply to Poki and Facebook with the light core build; add each portal's SDK last.

## Phase 1 tasks (style-comparison prototype)

### Task 1: Scaffold and size check
- Create a Vite project (TypeScript or plain JS), Three.js as the only runtime dependency, exact pinned version.
- Folder `src/game/` with `mount(canvas)` as its only entry point and no UI framework imports. A thin `src/main` calls it.
- Scene: an empty Three.js scene with a colored background renders.
- Scripts: `dev`, `build`, `size`. `size` reports raw, gzip and brotli for each file in `dist/` and the total.
- Create `docs/SIZE_LOG.md` and record the first measurement.
- Done when: the build works, the size report runs, and the result is logged. This is the decision gate for the engine choice (see `docs/DECISIONS.md`).

### Task 2: Road, camera and loop
- Fixed-timestep loop, render cap at 60 fps, first-person camera on a gently curving two-lane road with lane markings, sunset sky, hills, simple trees. All procedural.
- Seeded random generator utility (used by everything random).

### Task 3: Rider view and HUD
- Handlebars, hands, mirrors drawn procedurally; HTML/CSS/SVG HUD overlay with round speedometer (needle moves with speed), digital speed, tachometer, "POS 3/6", distance.
- Controls: arrow keys/WASD; touch (left/right half steers, hold accelerates).

### Task 4: Traffic and rivals
- 8-12 traffic vehicles (cars, a truck, a bus) in two lanes, 3 rival bikes ahead that can be overtaken. Simple arcade collisions, no physics library.
- Autopilot mode driven by the seeded generator for repeatable runs.

### Task 5: Performance panel
- Implement the live panel from `docs/BENCHMARK.md` (without the multi-style benchmark yet).

### Task 6: Style system and style 3 (low-poly)
- Implement the style interface from `docs/STYLES.md`, the key bindings 1-9, and style 3 as the baseline. Verify that switching styles frees resources (no leaks).

### Task 7 to 14: Remaining styles, one task each
- Styles 1, 2, 4, 5, 6, 7, 8, 9, in that order. After each one, record its size and a short benchmark note in `docs/SIZE_LOG.md`.

### Task 15: Benchmark run and export
- "Run benchmark" for all styles with the seeded autopilot, results table, and "Copy results as JSON".

## After Phase 1
Stop and report. The owner reviews the results with the planning assistant before any Phase 2 work starts.
