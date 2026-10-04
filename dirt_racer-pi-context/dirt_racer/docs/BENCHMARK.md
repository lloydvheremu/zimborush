# BENCHMARK

A live performance panel plus a repeatable benchmark, so the 9 styles can be compared fairly on frame rate, memory and size.

## Frame-rate targets
- Target 60 fps, cap rendering at 60 on high-refresh displays, fixed-timestep simulation.
- Minimum 30 fps. PASS for a style means its 1% low FPS is at least 30 during the benchmark.
- Dynamic resolution scaling is OFF by default and always OFF during the benchmark (it would distort comparisons).
- Cap devicePixelRatio at 1.5.

## Live panel (always visible, for the active style)
- FPS (1-second average), 1% low FPS, frame time in ms (update + render submit).
- JS heap MB via `performance.memory`. This API is Chrome-only and non-standard; show "N/A" elsewhere.
- Three.js `renderer.info`: draw calls, triangles, geometries, textures.
- Estimated GPU memory MB, computed from texture sizes (width x height x 4 bytes, plus about one third for mipmaps when used), render-target sizes and geometry buffer sizes. Label it "estimate".
- Style size: bytes of that style's source code (raw and gzip, using `CompressionStream`) plus bytes of its procedural textures.
- Separate lines for the Three.js size and total page transfer size (`PerformanceResourceTiming`). Show "N/A" with the reason if the browser does not report it.
- A red warning when FPS stays under 30 for 3 seconds.

## Benchmark run
- Button "Run benchmark": for each style, run 15 seconds (discard the first 3 s as warmup) using the seeded autopilot, so every style sees identical traffic and camera path.
- Results table per style: avg FPS, 1% low, min FPS, peak JS heap, GPU memory estimate, draw calls, triangles, style size, PASS/FAIL.
- Button "Copy results as JSON" so results can be pasted back into planning.

## Measurement caveats
- Numbers are only comparable on the same device, in the same browser, in the same run session.
- The Google AI Studio preview runs inside an embedded frame, so its numbers are not representative. Measure the built output in Chrome on real target devices (a mid-range laptop and a phone).
- Real download size must be measured on the built `dist/` folder (`npm run size`), not on source files.
- A prompt or code cannot guarantee a frame rate. Only the benchmark shows it.
