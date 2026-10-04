# PROJECT: dirt_racer

## Goal
A first-person, multiplayer-by-default motorcycle racing game for the browser, published on web game portals. Original assets only.

Style inspiration (not to be copied): first-person view, multiple bikes, weather, traffic to weave through.

## Current status
Planning and research are done for portals and stack. Nothing is built yet. The next step is a small prototype that compares 9 art styles on the same scene, measuring fps, memory and download size for each. The results decide the final look.

## Core gameplay (target, in phases)
- First-person view from the rider's seat, with handlebars, mirrors, speedometer and tachometer.
- Two-lane highway with traffic to pass, plus rival racers ahead.
- Multiple bikes, multiple tracks, weather. Extra bikes, tracks and weather stream in after gameplay starts.
- Multiplayer: ghost racing first (race recorded runs), then small real-time lobbies.

## Product requirements that affect design
- One click to gameplay. Players leave if loading takes more than roughly 10 seconds.
- Content must be PEGI 12 friendly (CrazyGames requirement).
- Short UI labels, built so they can be translated (Poki expects multiple UI languages).
- Username profanity filtering is needed for multiplayer. Chat and user-generated content need portal approval.
- Mobile support is needed (touch controls), but is not part of the prototype.

## UI screens (reference designs made with Google Stitch, not yet imported)
Loading, Main menu, Garage (bike select with stat bars), Lobby (6 slots, username field with error state, Ready, ghost toggle), Race HUD, Results, and a developer overlay for style switching and performance stats.
UI look: flat vector, thick outlines, orange/magenta accents on near-black, one bold condensed font from the system font stack. Built with HTML/CSS/SVG.

## Art direction
Not decided. Nine candidate styles are compared in the prototype (see `docs/STYLES.md`). Low-memory styles are favored because of the size budget.

## Tools around the project
- Planning: Claude (chat).
- Execution: pi (this agent), using free models.
- Later editing: the repo is imported into Google AI Studio.
- Reference images and video tests: Nano Banana, Veo, Google Stitch.
