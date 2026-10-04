# dirt_racer: agent instructions

Working title: dirt_racer (UI/brand working name: ZimboRush).
A first-person, multiplayer-by-default motorcycle racing game for web game portals. It runs in the browser.

Current phase: PROTOTYPE. We are building a style-comparison tool (9 art styles, live switching, with fps/memory/size readouts). It is not the full game yet.

## Read first
- Always read before starting a task: `docs/PROJECT.md`, `docs/DECISIONS.md`, `docs/TASKS.md`.
- Read when relevant: `docs/SIZE_AND_PORTALS.md`, `docs/STYLES.md`, `docs/BENCHMARK.md`.

## Hard rules (never break these)
1. **Originality.** Everything is original: name, art, bikes, UI, audio, code. Never copy, trace or imitate Traffic Rider assets, branding or code. It was only a style reference for first-person view, multiple bikes and weather.
2. **Size budget.** Core (initial) build target is 5-8 MB total, and the prototype should be far smaller. Every dependency or asset needs a reason. After any change that adds code or assets, report the built size (raw, gzip, brotli) and the change.
3. **One runtime library only: Three.js** (pinned exact version). No other runtime dependency (no physics engine, audio library, UI framework, state library, CSS framework) without asking first.
4. **Framework-free game code.** Everything under `src/game/` must not import React or any UI framework. It exposes one entry point, `mount(canvas)`. The repo will later be imported into Google AI Studio (which generates Vite + React), and React is only allowed in that wrapper, never inside `src/game/`.
5. **No runtime external requests.** No CDN scripts, web fonts or remote images. Use a system font stack. (Poki blocks external requests by default.)
6. **Procedural first.** No image, model, font or audio files unless a task says so. Build geometry, textures and HUD in code, canvas or SVG.
7. **No WebAssembly** in the core build. No physics library; write simple arcade logic.
8. **Frame rate.** Target 60 fps (cap at 60 on high-refresh displays), never below 30 fps on a mid-range laptop. Use a fixed-timestep simulation.
9. **Never invent facts** about portal rules, library sizes or browser support. If you are unsure, say so and mark it "unverified" in docs.

## Stack
- Language: TypeScript (strict) or plain JS modules, built with Vite. Vite and TypeScript are build-time only.
- Renderer: Three.js, WebGL2 first. WebGPU is evaluated later, only after its size is measured (see `docs/DECISIONS.md`).
- HUD and UI: HTML, CSS and SVG overlay. No framework.
- Audio: native Web Audio API (not needed yet).
- Multiplayer: later. Ghost racing first. Do not add networking code yet.

## Commands
These do not exist yet. Task 1 in `docs/TASKS.md` creates them. When they exist, update this section.
- `npm run dev`: dev server
- `npm run build`: production build into `dist/`
- `npm run size`: report size of `dist/` (raw, gzip, brotli, per file and total)

## How to work
- Do one task from `docs/TASKS.md` at a time. Do not start the next task or add features that were not asked for.
- Keep changes small and focused. Do not rewrite files you were not asked to change.
- Before editing, state which files you will touch. After editing, list the files changed and run the build and size check.
- If a requirement is ambiguous or two docs conflict, ask one short question instead of guessing.
- Do not read, print or commit secrets or API keys.
- Keep `docs/` accurate: if you change a decision, a command or a size number, update the relevant doc.

## Definition of done (every task)
- It builds with no errors or warnings you introduced.
- The built size was measured and reported.
- It stays framework-free inside `src/game/`.
- It follows all hard rules above, and you list any rule you could not meet.
