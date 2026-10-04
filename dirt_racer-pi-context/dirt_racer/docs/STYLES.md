# STYLES

The prototype renders the SAME scene in 9 styles and switches between them live (keys 1-9). The goal is to compare frame rate, memory and download size per style, then pick the look for the real game.

## Shared scene (identical in every style)
First-person view from the rider's seat on a two-lane highway at sunset: handlebars and hands, two side mirrors, round speedometer, 8-12 traffic vehicles (cars, a truck, a bus), 3 rival bikes ahead, roadside trees, distant hills, orange-pink-purple sky.
Benchmark mode uses a seeded random generator and an autopilot, so every style sees identical traffic and camera path.

## Style interface
Each style is its own module in `src/game/styles/` with the same shape:
- `id`, `name`
- `setup(ctx)`: create materials, render targets, shaders
- `render(ctx, dt)`: draw one frame
- `dispose()`: free ALL textures, geometries, materials and render targets (no leaks when switching)
Keep each style's code small. Report each style's source size (raw and gzip).

## The 9 styles
| # | Style | Implementation notes |
|---|---|---|
| 1 | 8-bit pixel | Render to a 256x144 target, upscale with nearest-neighbor, quantize to a fixed 16-color palette in a shader, no anti-aliasing, sky in hard color bands. |
| 2 | 16-bit pixel | 384x216 target, 64-color palette, ordered (Bayer) dithering, layered parallax sky/hills. |
| 3 | Low-poly | Flat-shaded faceted geometry, no textures, at most 3 lights. Baseline look; build this first. |
| 4 | Flat vector cartoon | Unlit solid colors, thick outlines (inverted-hull), no gradients. |
| 5 | Cel-shaded | 3-band toon shading plus outlines, native resolution. |
| 6 | Hand-drawn sketch | Edge-detection post-process, procedural paper grain, posterized watercolor-like fills. |
| 7 | Voxel | InstancedMesh cubes, hard cap of 20,000 instances. |
| 8 | Minimal silhouette | 3 colors only (dark navy, hot orange, warm off-white), stepped sky bands, solid silhouettes. |
| 9 | PS1 retro | 320x240 target, vertex snapping, low-res nearest-filtered procedural textures, distance fog, dithered color. |

## Expectations (unverified until benchmarked)
Styles with few or no textures and a low-resolution target (1, 2, 3, 4, 8) are expected to be cheapest in memory. Post-processing styles (6) and instanced-voxel (7) may cost more at full resolution. Do not assume; the benchmark decides.

## Rules
- No external image, model or font files. Everything procedural.
- No framework in `src/game/`.
- Do not add styles or features beyond this list.
