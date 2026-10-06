# Tactura Watch Simulator

A 3D web simulator of a Samsung Galaxy Watch 7 for testing the feel and flow of the Tactura gesture-to-speech pipeline without the physical watch. The full build spec is in [SPEC.md](SPEC.md).

> **Status: Phase 0 (scaffold and launch).** The shell, launchers and HUD frame exist. The watch arrives in Phase 1, gestures in Phase 2, the pipeline in Phase 3 and voice in Phase 4. Stage badges read `OFFLINE` until their stage is built.

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
| `1` to `6` | Fire gesture (Flick Up, Flick Down, Twist Right, Twist Left, Shake, Double Tap) | Phase 2 |
| `Space` | Commit the current buffer as a word | Phase 3 |
| `Backspace` | Remove the last gesture, or the last word if the buffer is empty | Phase 3 |
| `Tab` / `Shift+Tab` | Cycle candidates when several words match | Phase 3 |
| `Esc` | Clear the buffer | Phase 3 |
| `W A S D`, arrow keys | Orbit the camera | Phase 1 |
| Mouse drag / scroll | Orbit and zoom | Phase 1 |
| `R` | Reset camera to the hero angle | Phase 1 |
| `M` | Mute or unmute voice | Phase 4 |
| `[` / `]` | Collapse the left / right rail | **Now** |
| `?` or `H` | Help overlay | Phase 5 (shows a notice for now) |

Shortcuts are ignored while typing in a text field, and while Ctrl/Cmd/Alt is held so browser shortcuts keep working.

## Layout

```
simulator/
  Start Simulator (Windows).bat, Start Simulator (Mac).command   launchers
  index.html, vite.config.js, package.json
  public/            static files served as-is (favicon; lexicon data later)
  tools/             ensure-deps.mjs (launcher helper); lexicon builder later
  src/
    main.js          boot sequence
    core/            eventBus, store, clock, keyboard helpers
    scene/           three.js scene (SceneRoot now; watch, lights, camera later)
    ui/              Hud, components/, styles/ (tokens.css, base.css, hud.css)
  tests/             Vitest
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
