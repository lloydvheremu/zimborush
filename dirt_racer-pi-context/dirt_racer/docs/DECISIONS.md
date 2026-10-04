# DECISIONS

Treat "Settled" as final unless the owner reopens it. Do not change a decision on your own; propose it and ask.

## Settled
- **Strict size budget.** Core (initial) build roughly 5-8 MB. Everything else (extra bikes, tracks, weather) streams in after gameplay starts. Rough starting split (estimate, not fixed): engine ~2 MB, code/UI ~1 MB, one bike + one track ~3 MB, audio ~1 MB. The tightest portals set the budget.
- **Original assets only.** Name, art, bikes, UI, audio.
- **Art approach:** low-poly models, compressed textures, mono/compressed audio.
- **Multiplayer path:** ghost racing first, then small real-time lobbies. Library choice is postponed.
- **Rejected engines:** Babylon.js, Unity WebGL, Godot (too heavy for the budget; Unity WebGL is 8 MB+ before assets).
- **Portal order at launch:** CrazyGames first, then Y8, Kongregate, itch.io; apply to Poki and Facebook with the light core build; add each portal's SDK last.

## Adopted for the prototype (decided 2026-10-02, pending owner's final confirmation after Task 1 size check)
- **Engine: Three.js**, pinned version, code-only, Vite for building. Reasons: smallest measured footprint of the candidates, fully code-first (fits a local agent workflow), widely known by AI models (author's judgment, not measured). PlayCanvas remains the fallback if Three.js disappoints.
- **WebGL2 first.** This replaces the earlier plan of "WebGPU where supported with automatic WebGL2 fallback". WebGPU is evaluated only after its extra build size is measured, because Three.js ships its WebGPU renderer as a separate build (size unverified). Owner has not explicitly signed off on this change.
- **Framework-free game code** in `src/game/`, with `mount(canvas)` as the only entry point, so the project can be cloned into Google AI Studio (Vite + React) without React leaking into the game.
- **No WebAssembly** in the core build. Reconsider only if benchmarks show the CPU (update time) is the bottleneck, or for a small module loaded after gameplay starts (for example deterministic multiplayer simulation or replay compression).
- **No physics library.** Simple arcade logic (lanes, speed, collisions).
- **HUD/UI in HTML, CSS, SVG** with a system font stack.

## Open decisions
- Final art style (or styles): decided from benchmark results.
- Whether to accept Poki exclusivity (default exclusive deal is 5 years and would block CrazyGames and other portals). Do not assume.
- Engine confirmation: Three.js vs PlayCanvas, after the Task 1 size check.
- Multiplayer networking library (Poki Netlib, Photon, Colyseus, Nakama; the last two unverified).
- Game name availability and trademark check (UI working name: ZimboRush). Not checked.

## Known risks
- Real-time racing sync over the web (fallback: ghost racing).
- Size creep from art and audio.
- Portal approval is not guaranteed (Poki especially).
- Players leave if load takes more than roughly 10 seconds.
