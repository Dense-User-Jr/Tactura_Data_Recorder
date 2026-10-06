# Tactura Watch Simulator

A 3D web simulator of a Samsung Galaxy Watch 7 for testing the feel and flow of the Tactura gesture-to-speech pipeline without the physical watch. The full build spec is in [SPEC.md](SPEC.md).

> **Status: Phase 2 (gestures).** Keys 1–6 (or the gesture tiles) fire the six gestures: the arm and watch animate, the tile flashes, the case rim glows red and a UI tick plays. The pipeline (classifier → bins → decoder, trace, transcript) arrives in Phase 3 and voice in Phase 4. Stage badges read `OFFLINE` until their stage is built. The watch screen shows a standby clock until the Tactura screen app lands in Phase 3.

## Launch

You need **Node.js 20.19+ or 22.12+** (any current LTS from [nodejs.org](https://nodejs.org/en/download) works). Install it once. The launcher checks for it and opens the download page if it's missing or too old.

| Platform | Do this |
|---|---|
| Windows | Double-click `Start Simulator (Windows).bat` |
| macOS | Double-click `Start Simulator (Mac).command` |

The first launch installs dependencies (about a minute). Later launches start in a few seconds. Your browser opens automatically, usually at http://localhost:5173 (Vite picks the next free port if 5173 is busy). To stop the simulator, press **Ctrl+C** in the terminal window or close it.

**macOS blocked the file?** If macOS says the `.command` file can't be opened (Gatekeeper, common after downloading a ZIP), **right-click it → Open** once, then confirm. After that a double-click works. If it says the file isn't executable, run `chmod +x "Start Simulator (Mac).command"` once in Terminal.

## Developer scripts

Run these inside `simulator/`:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest unit tests |

The launchers call `tools/ensure-deps.mjs`, which runs `npm ci` only when `node_modules/` is missing or `package-lock.json` changed since the last install (tracked in `node_modules/.tactura-install-stamp`).

## Controls

| Key | Action | Available |
|---|---|---|
| `1` to `6` | Fire gesture (Flick Up, Flick Down, Twist Right, Twist Left, Shake, Double Tap). Holding a key fires once. Tiles in the left rail are clickable too | **Now** |
| `Space` | Commit the current buffer as a word | Phase 3 |
| `Backspace` | Remove the last gesture, or the last word if the buffer is empty | Phase 3 |
| `Tab` / `Shift+Tab` | Cycle candidates when several words match | Phase 3 |
| `Esc` | Clear the buffer | Phase 3 |
| `W A S D`, arrow keys | Orbit the camera (A/D yaw, W/S pitch) | **Now** |
| Mouse drag / scroll | Orbit and zoom | **Now** |
| `R` | Reset camera to the hero angle | **Now** |
| `M` | Mute or unmute voice | Phase 4 |
| `[` / `]` | Collapse the left / right rail | **Now** |
| `?` or `H` | Help overlay | Phase 5 (shows a notice for now) |

Shortcuts are ignored while typing in a text field, and while Ctrl/Cmd/Alt is held so browser shortcuts keep working. Gesture keys use physical key positions, so they work on any keyboard layout.

The viewport's top-right corner has the case finish (Silver, Green, Cream) and the `ARM` toggle. With the arm on (default), the watch lies face up on a forearm and the camera looks from the wearer's side; with it off, the watch stands upright like a product shot. Both choices are remembered per browser and move into the settings panel in Phase 5.

The viewport's bottom-right readout shows drawn frames per second. It reads `IDLE` when nothing is moving: the 3D view only redraws when something changes, so an idle sim costs no GPU time.

## Layout

```
simulator/
  Start Simulator (Windows).bat, Start Simulator (Mac).command   launchers
  index.html, vite.config.js, package.json
  public/            static files served as-is (favicon; lexicon data later)
  tools/             ensure-deps.mjs (launcher helper); lexicon builder later
  src/
    main.js          boot sequence and wiring
    config/          gestures.js (ids, keys, glyphs), gesture_bins.json (bins, spec §8.5)
    core/            eventBus, store, clock, keyboard helpers, prefs
    input/           InputSource (interface), KeyboardInput (keys 1–6 + tiles), CameraKeys
    pipeline/        types.js (shared data types, spec §8.1); stages arrive in Phase 3
    scene/           SceneRoot (renderer, post, render-on-demand), CameraRig, lighting,
                     WristMannequin (arm rig), GestureAnimator, Annotations, SoftBloomPass,
                     watch/ (WatchModel, geometry, materials)
    screen/          WatchScreen (the 480 × 480 display canvas)
    ui/              Hud, uiSounds, components/, styles/ (tokens.css, base.css, hud.css)
  tests/             Vitest (core, gesture clip motion)
```

SPEC.md §5 has the full target structure.

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-05 | Keyboard input only for v1 (keys 1 to 6 in the Kotlin enum order) | Fastest path to testing UX flow |
| 2026-10-05 | Space commits, Backspace undoes, Tab cycles ties | Word boundary and correction in the sim. The real watch's end-of-word mechanism is still undecided |
| 2026-10-05 | JS + three.js + Vite, self-hosted, double-click launchers | Team knows JS, easy launch on Windows and macOS |
| 2026-10-05 | Procedural watch model first, downloaded GLB allowed if it looks better and fits the aesthetic | Control over look and per-part animation |
| 2026-10-05 | Neural voice (Kokoro, `af_heart`) with system voice fallback | "Make the voice sound good" |
| 2026-10-05 | Lexicon from CMUdict + wordfreq, filtered at runtime by the bin config | No existing word-list file in the repo. Runtime filtering lets bins change freely |
| 2026-10-05 | Sim stand-ins for classifier and decoder, with honesty badges | Sim must run even when project code is broken, and must never pretend |
| 2026-10-05 | Minimum Node is **20.19+ or 22.12+**, not just "20". The launchers check that exact range | Vite 8 requires it. Node 20 itself reached end-of-life in April 2026, so the README points people at the current LTS |
| 2026-10-05 | Vitest **4.x**, not 5.x | Vitest 5 dropped Node 20, which would break the Node 20 support above |
| 2026-10-05 | Both launchers call one shared `tools/ensure-deps.mjs` for the install-stamp check, and install with `npm ci` | One implementation for Windows and macOS; `npm ci` installs exactly the committed lockfile |
| 2026-10-05 | `simulator/.gitattributes` pins launcher line endings (CRLF `.bat`, LF `.command`) | A `.command` with CRLF fails in bash, and an LF `.bat` can misbehave in cmd, whatever each teammate's `core.autocrlf` is |
| 2026-10-05 | Badges have a fourth look, `pending` (dim), shown as `OFFLINE` before a stage exists and as `LOADING` while it loads | Honesty: a stage that isn't built must not read as a stand-in or as running |
| 2026-10-05 | Small `FPS · DPR · GL` readout in the viewport corner (not in the §6.2 layout) | Makes the 60 fps acceptance check visible. Easy to hide behind a setting in Phase 5 |
| 2026-10-05 | Boot wordmark and terminal banner use a hand-drawn 5×7 dot glyph table (`src/ui/dotMatrix.js`) instead of sampling the Doto font | Individual dots can animate, and the same table renders the ASCII banner. All other display text uses Doto |
| 2026-10-05 | Extra `tests/core.test.js` for the event bus and store | So `npm test` is meaningful from Phase 0 |
| 2026-10-05 | **Presentation frame:** at rest the watch stands upright (12 o'clock up, face toward the hero camera) and the camera orbits the vertical axis, like a product shot. Read physically, the camera is the wearer looking down at a face-up wrist | Keeps 12 o'clock at the top of the screen while orbiting, and puts the contact shadow on a floor below the watch. Phase 5's synthetic IMU will use gravity along world −Z, so the rest reading matches the recordings' face-up `(0.3, 0.6, 9.7)` |
| 2026-10-05 | **Reflections come from a small code-built studio** (dark room plus softbox panels through PMREMGenerator) instead of three's `RoomEnvironment` | Same technique, still no HDR file. RoomEnvironment's evenly bright grey room washed the AMOLED blacks to grey and made the aluminum read flat white |
| 2026-10-05 | Bloom clamps radiance in its bright-pass and runs at half resolution (`SoftBloomPass`); strength 0.09, threshold 1.4 | Specular glints reach 50+ and flooded the frame with glow. Half resolution cut bloom's cost with no visible change |
| 2026-10-05 | 4× MSAA only below device pixel ratio 1.75 | On an Intel Arc iGPU at DPR 2, MSAA alone took the frame rate from 200 to 55 fps, and 1:1 crops looked the same without it |
| 2026-10-05 | The 3D view renders on demand: only when the camera, an animation, or a texture changes | An idle sim costs no GPU time. Measured on Intel Arc iGPU with continuous redraw: 226 fps at DPR 1, 156 at 1.25, 116 at 1.5, 240 at 2 |
| 2026-10-05 | Key and rim lights ride with the camera; the studio reflections stay fixed in the world | Every orbit angle stays lit like a studio shot, while reflections still slide across the metal as you orbit |
| 2026-10-05 | The strap is a closed loop around a wrist-sized cross-section (about 61 × 40 mm) | Reads as worn, and the Phase 2 forearm passes through it. Consequence: the sensor dome faces into the loop, so it's visible through the strap's side opening, not straight from behind |
| 2026-10-05 | Display material is boosted 1.5× | Post-processing tone-maps the whole frame (ACES), which would otherwise dim the AMOLED whites to ~90% grey. Blacks stay pure black |
| 2026-10-05 | The watch screen shows a built-in standby clock, and the HUD screen mirror is wired now (spec lists it for Phase 3) | A dark screen would undercut the product-render look. The standby face is the screen's "no app" state; `APP: NONE` stays honest until the Tactura app mounts in Phase 3 |
| 2026-10-05 | Clock colon drawn as two dots instead of Doto's `:` glyph | At weight 900 and 118 px, Doto's colon read as a smudge |
| 2026-10-05 | The IMU callout anchors below the clock digits rather than at the exact case center | Its marker sat on top of the time. The IMU's real board position isn't known anyway |
| 2026-10-05 | Finish picker lives in the viewport's top-right until the Phase 5 settings panel; the choice is remembered in localStorage | Phase 1 needs a finish switcher before settings exist |
| 2026-10-05 | Camera readout (`YAW / PITCH / DIST`) under the viewport label, and a controls hint along the bottom edge (hidden below 1280 px wide) | Makes the hero angle and orbit state legible. The hint stands in for the Phase 5 help overlay |
| 2026-10-05 | **Shake is a rapid left-right roll about the forearm axis (X)**, not "side to side about Y" as §10.5 says. Kept ±12°, 3.5 cycles, ~450 ms, decaying; the envelope is normalized so the strongest swing reaches the full ±12° | Russell: "like twisting your hand very fast left and right, I believe". There's no Shake recording yet, so revisit once one exists. The profile peaks near 10 rad/s on gyro_x, in the range of the real twists |
| 2026-10-05 | **With the arm shown, the watch lies face up on a level forearm** and the camera sits where the wearer's eyes would be. With the arm hidden, the Phase 1 upright product view stays. The `ARM` toggle animates between them | In the upright view, physical "up" points at the camera, so Flick Up came toward you and Flick Down appeared to rise on screen. Face up matches the recordings' rest pose: Flick Up rises, Double Tap dips down |
| 2026-10-05 | Arm-mode hero: from the elbow side and above (yaw −22°, pitch 40°, distance 4.8), orbiting a point over the wrist. The spec's hero (keys visible) applies with the arm hidden | A real hand is ~185 mm long; the product hero cropped it and flicks didn't read. In this view the side keys face away |
| 2026-10-05 | The arm is drawn "ghost" style: near-black body, light rim at the silhouette, sparse hairline sections, separate fingers | Spec allows matte grey or hairline wireframe. Solid matte grey read as a foam paddle and competed with the watch |
| 2026-10-05 | Twist timing: 180 ms eased out-stroke, 60 ms hold, underdamped spring return (overshoot ≈ 5%). Unit tests lock the recorded constraints | Main stroke peaks ≈ 10.6 rad/s (recordings: 8–17) and the return stroke ≈ 71% of it (recordings: 60–75%) |
| 2026-10-05 | A gesture fired mid-animation hands over from the current pose over 200 ms | No snapping, and back-to-back twists stay near real twist speeds (~20 rad/s vs 17 recorded) |
| 2026-10-05 | Edge glow is a thin red ring on the case's upper shoulder, peaking HDR-bright so the bloom catches it | Reads as "the rim lit up". ACES tone mapping shifts the brightest moment slightly toward orange-red |
| 2026-10-05 | Double Tap's glass ripple bends the glass normals and adds a faint light ring at the wavefront | The dark studio leaves almost no reflection to distort, so the normal ripple alone was invisible |
| 2026-10-05 | Tile clicks emit `RawInput` with `source: 'mouse'`; keys emit `'keyboard'` | Matches §8.1's source list and keeps the two honest in the trace later |
| 2026-10-05 | `pipeline/types.js` and `config/gesture_bins.json` exist from Phase 2 | Input already emits `RawInput`, and the tiles show each bin's phonemes. Bin validation comes with the BinMapper in Phase 3 |
| 2026-10-05 | Phase 2 wiring: an input event drives the animation, tile flash and tick directly | Phase 3 inserts the pipeline (classifier → bin mapper → decoder) between input and the trace/screen; the animation keeps showing the physical input |
