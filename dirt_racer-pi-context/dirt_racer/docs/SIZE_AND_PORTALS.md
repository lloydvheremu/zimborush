# SIZE AND PORTALS

Portal rules were researched in September 2026. **Re-verify before submitting anything.** Items marked (unverified) came from forum posts or community answers.

## Budget
- Core (initial) build: roughly 5-8 MB. The prototype should be far below this.
- Starting split (estimate): engine ~2 MB, code/UI ~1 MB, one bike + one track ~3 MB, audio ~1 MB.
- Tension to watch: Facebook Instant Games wants an initial bundle under 5 MB (ideally under 3 MB), which is below the upper end of the core budget.
- It is not verified whether each portal counts compressed (gzip/brotli) or raw bytes. Always report both.

## Reference sizes (not guarantees; measure our own build)
- Three.js: a minimal scene (renderer, camera, one mesh) measured about 118 kB gzipped on v0.180 and 125 kB on v0.181 (forum report from late 2025). The older "~185 kB" figure in earlier notes is unverified.
- PlayCanvas (fallback engine): the engine's own CI report on 1 Oct 2026 lists the full minified bundle at about 2.49 MB, 643 KB gzipped, 500 KB brotli. A tree-shaken build may be smaller (unverified).
- Three.js WebGPU renderer ships as a separate build; its size is not tracked in the sources found (unverified).

## Portals
| Portal | Constraints | Notes |
|---|---|---|
| CrazyGames | 50 MB initial download, 250 MB total build (with SDK), 20 MB initial for mobile homepage, under 1,500 files | Non-exclusive. Full Launch (monetization) requires their SDK. Multiplayer servers are the developer's responsibility (e.g. Photon). PEGI 12 compliant. Gameplay in one click. |
| Poki | Aim for under 8 MB initial | Invite-only, hand-curated. Prefers web exclusivity (default exclusive deal 5 years); a non-exclusive flat-fee license exists. No in-game purchases. External requests blocked by default. Username profanity filtering for multiplayer. Chat/UGC needs approval. Multiple UI languages expected. Free networking library (Netlib). |
| Facebook Instant Games | Zip up to 200 MB; initial bundle under 5 MB (ideally under 3 MB) | Own SDK. |
| Kongregate | Uploads up to 1 GB | Approved developers only. |
| itch.io | ~500 MB extracted, 200 MB per file, ~1000 files (unverified) | HTML5 games take donations only, no ad revenue. |
| Y8 | Size limit not found | HTML5/WebGL/Unity WebGL accepted. SDK required. No external links in games. |
| Game Jolt | ~3 GB (community answer, unverified) | |
| Newgrounds | ~250 MB (older forum post, unverified) | |

Not verified at all: Coolmath, VIVERSE, YouTube Playables, GameDistribution, GamePix, GameMonetize limits.

## Rules that follow from this
- No runtime external requests (no CDN, no web fonts).
- Keep the file count low (CrazyGames limit is under 1,500 files; itch.io about 1,000, unverified).
- Add each portal's SDK last, behind a thin adapter, so the game works without any SDK.
- Stream extra content after gameplay starts.
