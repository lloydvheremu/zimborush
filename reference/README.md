# ZimboRush reference library

Owner-supplied art direction. **Not shipped** — this folder is outside `public/`
and nothing here is built into `dist/`. Kept in the repo so the direction
survives across sessions.

| File | What it is |
|---|---|
| `01-bike-model-sheet.png` | Bike model sheet, 9 views: side, front, rear, top, 3/4 with rider, plus three in-game framings (following, cornering, on-board). The on-board shots in the bottom row are the primary reference for the first-person bike (Q3). |
| `02-gameplay-canyon-montage.png` | Three in-game frames. Best single reference for composition: valley floor, layered ridges, rival mid-distance, boulder and tree scale relative to the bike, dust plumes. |
| `03-prop-lineup-lighting-palette.png` | **The authored palette swatches** plus the lighting study, plus a prop lineup with per-prop triangle counts and metre grid. The most load-bearing sheet — see the palette table below. |
| `04-modular-track-tiles.png` | Modular track pieces with triangle counts. Not used by the current track (ours is a closed spline, not tiles) — kept for style reference. |
| `05-rocks.png` | Rock variations with triangle counts: pebble cluster 15, large boulder 58, slab racks 53, rock arch 88, hoodoo 88/80, cliff segment 120. |
| `06-man-made-props.png` | Man-made props: tire stack 75, checkpoint arch 98, fuel barrels 60, grandstand bench 85, sign post 45, wooden fence 110, start gantry 250. |
| `07-vegetation.png` | Trees and scrub: tall conifer 56, conifer 56, rounded oak 72, scrub bushes 35, grass tufts, moss rock. |
| `08-rider-variants-poses.png` | Rider gear colours (teal-blue, green, yellow) and poses. The teal-blue gear is what our rival already approximates. |
| `09-ground-tiles.png` | Localised ground variations: lit/shade grass, dirt road, dirt track, rocky, cracked rock, boulder field, and the **grass↔dirt transition tiles** — directly relevant to Q2's "blend dirt vs grass". |

## The authored palette (from `03`)

Sampled from the swatch band (y = 480..510) by contiguous-run detection, not by
eye. These are the owner's authored values and they **supersede** the estimates
that `public/styles/lowpoly.json` was carrying.

| Swatch | Hex | Maps to palette key |
|---|---|---|
| Sky Horizon | `#EDC0AA` | `skyHorizon` |
| Sky Mid | `#E6A981` | `skyMid` |
| Sky Zenith | `#EAA284` | `skyZenith` |
| Sun | `#F6E7D0` | `sunDisc` |
| Far Hills | `#673949` | `hillsDistant` |
| Near Hills | `#767A5A` | `hillsNear` (new key) |
| Grass Lit | `#989444` | `terrainLit` |
| Grass Shade | `#8B8E6E` | `terrainShade` |
| Dirt Road | `#836B58` | `road` |
| Rock | `#817264` | `rock` |
| Foliage | `#5D8A63` | `foliage` |
| Red Accent | `#C93F3B` | `accent` (new key; was TBD in the design doc) |

Two observations that correct the previous patch:

1. **The ground is olive-green, not tan.** `Grass Lit #989444` and
   `Grass Shade #8B8E6E` are unambiguous greens. Patch 1's `#8A7050` / `#5F4A39`
   were sampled from a rendered JPEG's soft gradients and came out too brown.
2. **The near hills are olive-green and the far hills are maroon.** The two
   hill bands are different colours, not one colour under haze. Our derived
   `midHill` rule mixed grass shade with the distant maroon, which cannot
   produce `#767A5A`.

## Per-prop triangle budgets (from `03`, `05`, `07`)

| Prop | Tris | Prop | Tris |
|---|---|---|---|
| Rider | 34 | Rock arch | 88 |
| Bike | 48 | Hoodoo | 88 / 80 |
| Conifer | 42 | Cliff segment | 120 |
| Brodleaf (rounded) | 60 | Tall conifer | 56 |
| Boulder | 58 | Rounded oak | 72 |
| Slab rock | 53 | Scrub bushes | 35 |
| Pebbles | 5 | Wildflowers | 36 |
| Grass tufts | 5 | Moss rock | — |
| Fallen log | — | | |

The metre scale bar on each sheet reads **8 m across the full sheet width**
(1024 px), i.e. ~0.0078 m/px on the displayed sheets.
