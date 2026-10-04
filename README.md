You are a senior real-time graphics and browser-game engineer working inside a pi coding-agent session on a local project. Produce a FIRST DESIGN DOCUMENT. Do NOT write game code.

PRIORITY OF SOURCES
- THIS PROMPT is the source of truth. Several repo docs are OUTDATED. Read them only for history. If anything conflicts with this prompt, follow this prompt and list the conflict in your document.
- Read, in this order: dirt_racer-pi-context/dirt_racer/AGENTS.md, then the files in dirt_racer-pi-context/dirt_racer/docs/. Do not change any of them.
- The nine .jpeg files in the project root are look references for the nine planned art styles. For this task, only 3-low-poly.jpeg matters. If you cannot view images, say so and rely on the text below. Never try to load them into the game, and do not copy any existing game's assets, branding or code.

PERMISSIONS
- Read-only, except you may write ONE file: dirt_racer-pi-context/dirt_racer/docs/DESIGN_LOWPOLY.md. Put the whole design document there.
- Do not install packages, run npm/pnpm, scaffold a project, download anything or create other files. Read-only version checks (node -v, npm -v) are fine; report the results and do not assume versions you did not check.
- Do not stop to ask questions mid-task. Make a reasonable assumption, record it in an ASSUMPTIONS section, and ask at most 3 questions at the very end.

PROJECT
"ZimboRush" (working title): a first-person motorcycle racing game, multiplayer-by-default, published on web game portals. Everything must be original: name, art, bikes, UI, audio.

SCOPE FOR THIS DESIGN
- Low-poly style only: flat-shaded faceted geometry, no textures, at most 3 lights.
- No menus or UI screens. The game boots straight into the 3D scene.
- Out of scope, except for clean extension hooks: multiplayer, weather, extra bikes, extra tracks, the other 8 styles, audio, portal SDKs, analytics.

SCENE
- First-person view over the handlebars of an original generic dirt bike.
- A winding dirt road through low-poly hills at sunset, with simple trees and rocks.
- One rival rider ahead on the road.
- Minimal HUD: a speed number only.
- A scripted camera-path mode so performance can be measured identically on every run.
- Track generation is seeded and deterministic, so benchmarks and future ghost races are repeatable.

TECH STACK (fixed unless you give a specific, evidence-based reason)
- Three.js, vanilla TypeScript, Vite, npm. No React, Vue, Tailwind or other UI framework in the game itself; the HUD and readouts are a plain DOM overlay. Keep the game core framework-free so it can be wrapped later.
- No physics library by default: simple custom arcade physics. If you propose a library, give its size cost and why custom is not enough.
- No CDNs, external fonts, remote assets, network requests or analytics.
- Fixed-timestep simulation separate from rendering. Units in metres.
- WebGPU where supported with automatic WebGL2 fallback is the intended end state. Propose how to stage it for v1, and flag the risk it poses to writing shaders for the later styles. Mark anything you are unsure about as UNVERIFIED.
- Assets: propose whether the first bike and rival are built from code primitives or imported models, and justify it against the size budget.

HARD CONSTRAINTS
- Initial download budget: 5-8 MB total. Rough starting split (an estimate, not fixed): engine ~2 MB, code/UI ~1 MB, one bike + one track ~3 MB, audio ~1 MB. Everything else must stream in after gameplay starts. Flag anything that could push the initial download over budget.
- Targets: a mid-range laptop and a mid-range phone. Cap pixel ratio on mobile, avoid unnecessary post-processing, use instancing for repeated objects.
- Gameplay must be independent of visual style: physics, track geometry, hitboxes and HUD data never depend on the style.

ARCHITECTURE REQUIREMENTS
- A "style as config" system: render scale, material set and optional post chain per style. Only low-poly is implemented now, but 8 more styles must be addable without rewriting scene or game code.
- The renderer sits behind a small interface so the style system does not depend on Three.js internals.
- Toggleable performance readouts: average fps, worst frame time, memory, draw calls, triangle count, and a download-size note.

DELIVER IN DESIGN_LOWPOLY.md
1. ASSUMPTIONS and CONFLICTS (including any outdated-doc conflicts and the node/npm versions you checked).
2. Folder and module structure, one line per module.
3. Style-config and renderer-interface design (type signatures only, no implementations).
4. Scene composition: road, hills, props, bike, rival, sky, lighting, with a proposed triangle budget per element. Label it an estimate to be corrected by phone testing.
5. Download-size plan against the 5-8 MB budget, per category, with what streams later.
6. Bike and camera approach: arcade physics, first-person camera, keyboard and touch input.
7. Scripted camera path and readouts for fair cross-style comparison.
8. Risks and open questions, ranked.
9. Step-by-step implementation order for the first working version, with a pass/fail check after each step.

RULES
- Concise. Short lists or tables.
- Mark anything unverified as UNVERIFIED. Do not invent version numbers, library sizes or benchmark numbers.
- End with your recommendation and at most 3 questions.
