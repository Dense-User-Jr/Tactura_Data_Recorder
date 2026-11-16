# Tactura gesture recognition v2: implementation plan

Russell Mehta. Written Nov 10, 2026. Last updated Nov 15, 2026.

> **Where the build stands (Nov 11).** Phases 0 and 1 are done. Phase 2 runs on the Galaxy Watch 7: calibration, blueprint Classify and the "no gesture" answer all work. The **Wrong?** correction is not built yet, and nothing from phases 3 to 5 is started. The diagrams and formulas in this file render on GitHub.
>
> **Update (Nov 15).** A scored run five days after calibration gave 54 of 60 with no recalibration of the flicks and twists. The two wrong names were shakes cropped on the wrong stroke. The recipe now cuts one clip per strong stroke (step 3b), confirmed on the watch that evening. Eigengestures (step 7) and a "strong enough" rule (step 6) were built the same night and wait for their watch test. See "Working order" near the end.

## The one-minute version

We are replacing the 500-tree model with personal gesture blueprints that the watch learns from each user in about three minutes.

- **The problem.** The current model learned how the recorder held his arm, not the gestures. On a new person it scored 25 of 51 (49%). It also named a gesture for a motionless arm every single time.
- **The fix.** Each user shows the watch every gesture a few times. The watch saves one blueprint per gesture, then matches each new movement to the closest blueprint.
- **Two rules make it work.** Look only at motion, never at arm angle. Line every movement up in time before comparing.
- **What it scored.** Built from only 3 of Russell's reps per gesture, it got about 96% on his remaining gestures in laptop tests.
- **On the watch.** With Russell's own blueprints the watch named 41 of 50 gestures correctly and gave zero wrong names. The old model got 25 of 51 with 26 wrong names.
- **What stays.** The recording app, the CSV format, the capture timing and every existing file stay. The new pieces sit beside the current classifier until they prove themselves.

These numbers come from two people and one evening of testing. Treat them as a strong signal, not a final result.

## What we found

The current model works exactly as coded, but it learned the wrong thing: the resting arm angle of each recording batch. The full write-up is `claude/classifier-diagnosis-2026-11-10.md`, a doc in the Tactura project on claude.ai. It is not in this repo. The short version is below.

**The watch app itself is fine.** Dhruv's 11/9 fix made Classify see the same input as training. Re-running all 77 of Russell's watch windows through the laptop model gave the same answer 77 of 77 times. The ONNX file matches the joblib file to six decimal places.

**The training data has a hidden shortcut.** All 250 recordings were made by one person on one evening, 50 of one gesture and then 50 of the next. The arm rested at a slightly different angle in each batch. The accelerometer measures gravity, so it records that angle.

| Test on the 250 training recordings | Accuracy |
| --- | --- |
| Shuffled split (looks great, but misleading) | 96% |
| Train on each gesture's first 35, test on its last 15 | 75% |
| Using only the first 0.2 s, before any gesture starts | 80% |
| Using only the last 1 s, after the gesture is over | 85% |

Guessing would score 20%. A model that scores 80% before the gesture begins is reading the arm, not the motion.

**The watch test confirmed it.** Russell wore the Galaxy Watch 7 on his left wrist and ran 51 labeled gestures plus 20 still-arm windows.

| What Russell did | What the watch said |
| --- | --- |
| Flick Up, 10 times | Correct 10 of 10 |
| Flick Down, 10 times | Correct 0 of 10 |
| Twist Right, 10 times | Correct 3 of 10 |
| Twist Left, 11 times | Correct 9 of 11 |
| Shake, 10 times | Correct 3 of 10 |
| Arm tilted, no motion, 10 times | "Flick Down" 10 of 10 |
| Arm flat on desk, no motion, 10 times | A twist every time, twice above 97% confidence |

**Each fix we tried, on Russell's data.**

| Approach | How it was tested | Accuracy |
| --- | --- | --- |
| Current forest | Trained on Dhruv, tested on Russell's 51 | 49% |
| Forest with the accelerometer hidden | Same | 73% |
| Blueprints, compared slot by slot | Russell's first 3 reps, tested on his other 36 | 64% |
| Blueprints, frequency fingerprint | Same | 97% |
| Blueprints, cropped around the action with a small slide | 3 random reps, tested on the rest, averaged over 20 draws | 96%, worst draw 94% |

**People do the gestures differently.** Russell's shake rotates about five times faster than Dhruv's (about 37 against 8 rad/s). His flick down registers on the twist axis. A blueprint built from Russell's shakes matched 0 of 50 of Dhruv's. This is why one shared model struggles and personal blueprints do not.

**The new recipe on the watch (11/10, late evening).** Russell calibrated 5 gestures with 5 reps each in 3 minutes 16 seconds, then ran the same scorecard as before.

| What Russell did | Old model, 7:15 pm | His blueprints, 10:48 pm |
| --- | --- | --- |
| Flick Up | 10 of 10 | 10 of 10 |
| Flick Down | 0 of 10 | 10 of 10 |
| Twist Right | 3 of 10 | 10 of 10 |
| Twist Left | 9 of 11 | 10 of 10 |
| Shake | 3 of 10 | 1 of 10, the other 9 ignored |
| Gestures given a wrong name | 26 | 0 |
| Still arm named as a gesture | 20 of 20 | 1 of 11, a faint twitch, fixed by lowering the limit to 90% |

The blueprints also held across sittings. Applied to the windows recorded three hours earlier, they named 41 of 41 flicks and twists correctly and ignored 20 of 20 still-arm windows. The watch and the laptop gave identical answers on all 69 windows from the evening test.

Shake failed because it is not one motion yet. Russell's shakes ranged from 0.8 to 4 wiggles per second and from 16 to 37 rad/s over the evening. Calibration now checks that each rep can be recognised from the other four, drops the odd one out, and asks for another.

**After pinning shake down (11/10, 11 pm).** Shake was defined as "3 quick wiggles" and recalibrated on its own. In the next round the watch got 26 of 31 right: Shake 7 of 10, Flick Up 5 of 5, Flick Down 4 of 5, Twist Left 5 of 5 and Twist Right 5 of 6. Four real gestures were ignored and one shake was named Twist Left. The wording "3 quick wiggles" is a placeholder until the team agrees on a definition.

## The new idea in plain words

The watch should recognise your gestures the way a bank recognises your signature: by comparing against samples you gave it.

| The bank | Tactura |
| --- | --- |
| You sign a few times when you open the account. | You do each gesture a few times when you first open the app. This is calibration. |
| A new signature is compared with your samples. | A new movement is compared with your saved blueprints. The closest one wins. |
| It does not matter where on the page you sign. | It does not matter whether you start the gesture early or late. The watch lines things up first. |
| The colour of the paper is ignored. | The resting angle of your arm is ignored. Only motion counts. |
| A scribble that matches nothing is rejected. | A movement that matches no blueprint is ignored. So is a still arm. |

**The recipe in four steps**

1. **Look only at motion.** Use the gyroscope (how fast the wrist is rotating). Leave out the accelerometer, because it carries the arm angle.
2. **Find the action and crop around it.** Locate the moment the wrist moves the most. Keep a short clip centred on that moment.
3. **Average a few reps into a blueprint.** One blueprint per gesture, per person.
4. **Pick the closest blueprint, or say nothing.** If no blueprint is close, or the wrist never moved much, the answer is "no gesture".

**Why not just retrain the forest?**

- It needs many varied recordings from many people to stop finding shortcuts. We have four people.
- It has five possible answers and cannot say "nothing happened".
- It is trained on a laptop, converted, and bundled into the app. Blueprints are learned on the wrist.

The forest stays in the app for now so we can compare the two side by side.

## The pipeline

Every movement passes two gates before it gets a name: it must be loud enough, and it must match one of your blueprints.

```mermaid
flowchart TD
    CAL["Calibration, once per user<br/>5 reps of each gesture"] --> BP[("Your blueprints<br/>one per gesture")]
    G["1. Gyro stream<br/>rotation speed, 50 readings a second"] --> M["2. Motion level<br/>how hard is the wrist turning?"]
    M -->|"peak is at least 1.0 rad/s"| C["3. Crop around the action<br/>1.2 s centred on the peak"]
    M -->|"too quiet"| X1(["Ignored: the wrist stayed still"])
    C --> D["4. Compare with blueprints<br/>distance to each one, small slide allowed"]
    BP --> D
    D -->|"closest one is within 90% of its size"| N["5. Gesture name"]
    D -->|"nothing is close"| X2(["Ignored: no blueprint matched"])
    N --> W["Phoneme bins and word decoder<br/>separate work"]
```

Read it top to bottom. Calibration happens once and feeds the blueprints. The numbered steps happen for every movement.

1. **Gyro stream.** The watch reads rotation speed 50 times a second. In the button version this is the 3 second window the app already captures. In real-time mode it is a rolling buffer.
2. **Motion level.** One number that says how hard the wrist is turning. A still arm stays near zero, so it stops here and is ignored.
3. **Crop around the action.** Keep 1.2 seconds centred on the loudest moment. Early or late no longer matters.
4. **Compare with blueprints.** Measure how far the clip is from each blueprint, allowing a small slide. If nothing is close, it is ignored.
5. **Gesture name.** The closest blueprint wins. The name then goes to the phoneme bins and the word decoder, which are separate work.

The math for each box is in the next section.

## The math, step by step

Every step is plain arithmetic: add, average, subtract, compare. Each one has a sentence, a formula, and the number we tested with.

**What the watch gives us.** Fifty times a second, the gyroscope reports how fast the wrist is rotating around three axes, in radians per second. One reading is three numbers. A 3 second window is 150 readings.

```math
g_t = \left(g^{x}_t,\; g^{y}_t,\; g^{z}_t\right)
```

### Step 1. Motion level

How hard is the wrist turning right now? Square the three numbers, add them, average over a short stretch, and take the square root. The averaging stops one jittery reading from looking like a gesture.

```math
m_t = \sqrt{\frac{1}{W}\sum_{k=-3}^{3}\lVert g_{t+k}\rVert^{2}}, \qquad W = 7 \text{ readings} = 140 \text{ ms}
```

### Step 2. Find the action

The action is where the motion level peaks. If even the peak is quiet, nothing happened.

```math
t^{*} = \arg\max_t \, m_t, \qquad \text{gesture present only if } m_{t^{*}} \ge \theta, \quad \theta = 1.0 \text{ rad/s}
```

Measured: Russell's still arm never went above 0.44 rad/s. The gentlest real gesture from either person reached 1.68. The threshold sits in the gap.

### Step 3. Crop

Keep 30 readings before the peak and 30 after. That is 1.2 seconds on three axes, so every clip is a list of 180 numbers with the big swing in the same place.

```math
x = \left(g_{t^{*}-30},\; \dots,\; g_{t^{*}+29}\right) \in \mathbb{R}^{180}
```

![One Twist Left from the 11/10 watch test: raw rotation, motion level, its peak, and the 1.2 second clip](img/find-the-action.png)

The grey line is the raw rotation. The blue line is the motion level from step 1, and the dot is its peak from step 2. The shaded band is the clip from step 3, and the dashed red line is the motion threshold. Had Russell started 300 ms later, the band would simply sit 300 ms further right, and the clip inside it would look the same. The picture is drawn from the real recording by `python ML\plot_find_the_action.py`.

### Step 3b. One clip per strong stroke

Some gestures have two strokes of about the same strength. A shake is a left stroke and then a right stroke. "The loudest moment" is then a coin flip between them, and the clip lands about a third of a second apart from one rep to the next. The slide in step 5 can only correct a tenth of a second.

So the recipe does not guess. A stroke counts as strong when its motion level reaches 60% of the peak and it is the highest point within 160 ms on either side. Every strong stroke gets its own 1.2 second clip, up to three.

```math
\text{strong strokes} = \left\{\, t \;:\; m_t \ge 0.6\, m_{t^{*}} \ \text{ and } \ m_t = \max_{|k-t|\le 8} m_k \,\right\}
```

A twist or a flick has one dominant stroke, so it usually gives one clip that matters and nothing changes. When there are several clips, step 6 compares every clip with every blueprint and keeps the single best fit. During calibration, the clip that best fits the earlier reps of the same gesture is the one saved, so all reps of a two-stroke gesture end up centred on the same stroke.

Measured on the 11/15 run with the blueprints already on the watch: both misnamed shakes became Shake, at 75% and 71% match, and nothing else changed (56 of 60, no wrong names).

### Step 4. Blueprint

A blueprint is the average of a few clips of the same gesture, number by number. It is your typical version of that gesture.

```math
\mu = \frac{1}{n}\sum_{i=1}^{n} x_i
```

### Step 5. Distance, with a small slide

To compare a clip with a blueprint, subtract them number by number, square, average, and take the square root. The result is in rad/s and reads as "on average these two disagree by this much". Because the peak finder can be off by a hair, we try sliding the clip up to 100 ms each way and keep the best fit.

```math
d(x,\mu) = \min_{-5 \le s \le 5}\; \sqrt{\frac{1}{180}\sum_{j=1}^{180}\left(x^{(s)}_j-\mu_j\right)^{2}}
```

Here the clip with a superscript s means the clip shifted by s readings. Measured: a gesture sits a median 0.6 rad/s from its own blueprint and 2.7 rad/s from the nearest wrong one.

### Step 6. Decide

The closest blueprint wins, but only if it is close enough. Otherwise the watch says nothing.

```math
\hat{g} = \arg\min_{g}\; d(x,\mu_g), \qquad \text{answer } \hat{g} \text{ only if } d(x,\mu_{\hat{g}}) \le \tau_{\hat{g}}
```

The limit is a percentage of the gesture's own size. A clip must miss its closest blueprint by no more than 90% of that blueprint's size, where size is the root mean square of the blueprint. A fixed limit in rad/s was tried first and failed: 1 rad/s is a tiny miss for a twist, but it is the whole gap between Flick Up and Flick Down. With the percentage rule, wrong names fell from 4% to 0%, 12% of real gestures were ignored, and a gesture with no blueprint was ignored every time. The limit sits below 100% on purpose: a clip of no motion is exactly 100% away from every blueprint, so at 100% a faint twitch once passed as a Flick Up on the watch.

Since 11/15 there is a second rule, "strong enough": the clip's own size must be at least 60% of the winning blueprint's size. It exists because eigengestures (step 7) forgive part of the gap between a clip and a blueprint, and for a small gesture that can include most of the gap to no motion at all.

```math
\text{answer } \hat{g} \text{ only if } \ d_{\text{eig}}(x,\mu_{\hat{g}}) \le 0.9\,\text{size}(\mu_{\hat{g}}) \ \text{ and } \ \text{size}(x) \ge 0.6\,\text{size}(\mu_{\hat{g}})
```

### Step 7. Eigengestures (built 11/15)

The average says "here is your typical flick". Eigengestures add "and here are the ways you usually differ from it". A person's reps are not scattered evenly around their average. They are stretched in a few directions, and a rep that sits far out along one of those directions is still a normal rep for that person.

**Finding the directions.** Take the reps after lining up and subtract the blueprint from each one. The directions are the top eigenvectors of the covariance of those differences.

```math
e_i = x_i-\mu, \qquad C = \frac{1}{n}\sum_{i=1}^{n} e_i\,e_i^{\top}, \qquad C\,v_k = \lambda_k v_k, \qquad \sigma_k = \sqrt{\lambda_k}
```

Each direction is a list of 180 numbers with length 1. The spread says how far the reps typically sit along it. We keep the top 2. With n reps there are at most n minus 1 directions, so the code finds them from the small n by n table of dot products between reps, using a simple method (Jacobi rotations) that is written the same way in Python and Kotlin.

**Comparing.** Line the clip up with the blueprint the plain way (step 5). Then measure how much of the leftover follows each direction, remove that part, and measure what remains. The removal is capped at 1.5 times the spread, so a movement far outside the user's habits still counts as different.

```math
c_k = v_k^{\top}(x-\mu), \qquad r = (x-\mu) - \sum_{k=1}^{2}\operatorname{clip}\left(c_k,\,\pm 1.5\,\sigma_k\right)v_k, \qquad d_{\text{eig}}(x) = \frac{\lVert r\rVert}{\sqrt{180}}
```

Step 6 now uses this distance for both picking and judging.

**What it found.** In Russell's 11/15 afternoon Flick Up, the first direction holds 62% of the variation between reps, and 86% of it is on the twist axis. It is neither "stronger or weaker" nor "earlier or later". The math found that the main way his flick varies is how much forearm twist leaks into it. One real flick that missed the blueprint by 74% of its size missed by 48% once the two directions were forgiven.

It needs at least 3 reps to give any direction and 5 to be meaningful. Calibration already asks for 5.

### Step 8. Learning over time

Every gesture the user confirms or corrects is one more rep. Folding it into the average takes one line.

```math
\mu \leftarrow \mu + \frac{x-\mu}{n+1}, \qquad n \leftarrow n+1
```

Later, a new user can start from a shared team blueprint instead of from nothing. The shared blueprint counts as a fixed number of reps, and each real rep pulls the result toward the user. This is the prior-then-posterior idea.

```math
\mu_{\text{user}} = \frac{\kappa\,\mu_0 + \sum_{i=1}^{n} x_i}{\kappa + n}
```

### In reserve: the frequency fingerprint

Describing a clip by how much of each wiggle speed it contains also ignores timing, because a delay changes only the phase of the Fourier transform and not its size.

```math
x(t-\tau)\;\longleftrightarrow\; e^{-i 2\pi f \tau}\,X(f) \quad\Rightarrow\quad \lvert X(f)\rvert \text{ is unchanged by a delay}
```

It scored 97% in the same test. Its weakness is that a signal and its mirror image have the same fingerprint, so in theory it cannot tell Twist Left from Twist Right. Cropping keeps direction, so cropping is the main path and frequency stays available as a second opinion.

### Settings we tested with

| Setting | Value | Why |
| --- | --- | --- |
| Sensor rate | 50 readings a second | Measured on both watches |
| Motion smoothing | 7 readings (140 ms) | Middle of the range we tried (60 to 300 ms) |
| Motion threshold | 1.0 rad/s | Between the loudest still arm (0.44) and the quietest gesture (1.68) |
| Clip length | 60 readings (1.2 s) | Results held from 0.6 s to 2.0 s |
| Slide when comparing | 5 readings each way (100 ms) | Gave 96 to 97% with a worst draw of 94% across the smoothing settings tried |
| Strong stroke | At least 60% of the peak, highest within 8 readings (160 ms) each way, at most 3 per window | First guess, set on 11/15. Not tuned yet |
| Reps per gesture | 5, with 3 as the minimum | 3 is enough for the average, 5 allows eigengestures |
| Eigen directions | 2 | Russell's pick on 11/15 after a sweep of 1 to 4. The first helps most inside one sitting, the second on a new sitting. More than 2 kept adding a few points but accepted more odd movements |
| Eigen cap | 1.5 times the spread seen in calibration | First set to 2, then tightened by Russell on 11/15 after the first real random-movement test. Caps from 1.5 to none changed accuracy by at most 2 points, and a tighter cap leaked less |
| "Strong enough" limit | A clip must be at least 60% of the blueprint's own size | Added 11/15 as a guard for eigengestures at 50%, raised to 60% the same night. On the watch it stopped 5 of 20 movements that should be ignored |
| "Close enough" limit | Within 90% of the blueprint's own size | Russell's rule. Laptop: 88% correct, 12% ignored, 0% misnamed. Watch: 41 of 41 flicks and twists in each of two sittings |
| Weight of the shared blueprint | Open | Needs data from more people |

## How it fits the current codebase

Nothing in the recording or classifying code is rewritten. Three new Kotlin files sit beside the current classifier and read the same captured events, so the old path keeps working the whole time.

```mermaid
flowchart TD
    UI["RecorderUi.kt<br/>buttons and screens"] --> SVC["RecordingService.kt<br/>countdown, then one 3 second capture"]
    SVC --> CAP["SensorCapture.kt<br/>raw gyroscope and accelerometer events"]
    CAP --> REC["Record<br/>CsvStorage.kt saves a labeled CSV"]
    CAP --> OLD["Classify, old path<br/>GestureFeatures.kt, then OnWatchGestureClassifier.kt"]
    CAP --> MC["MotionClip.kt<br/>find the action, crop the clip"]
    MC --> GB["GestureBlueprints.kt<br/>build, compare, decide"]
    BS["BlueprintStore.kt<br/>your saved reps, on the watch"] <--> GB
    GB --> CALI["Calibrate<br/>adds a rep to a blueprint"]
    GB --> CLS["Classify, new path<br/>a gesture name, or no gesture"]
    classDef fresh stroke-width:3px
    class MC,GB,BS fresh
```

The capture at the top is shared. Record, today's Classify and the new blueprint path all branch off after the same 3 second window, so they always see identical data. The three new files have the thick border. All names are Kotlin files under `wear/src/main/kotlin/com/gesturedatarecorder/`.

**Files that stay exactly as they are**

| File | Why it is left alone |
| --- | --- |
| `SensorCapture.kt` | Holds the raw events and builds the CSV text. The CSV format must not change. |
| `GestureFeatures.kt` and `GestureFeaturesParityTest.kt` | The forest's 192 numbers and the test that guards them. Still needed while the forest stays. |
| `OnWatchGestureClassifier.kt` | The forest and its loader. Kept as a comparison until phase 2 passes. |
| `RecordingRepository.kt`, `MainActivity.kt` | App state and permissions. They already do what we need. |
| `ML/train_gesture_classifier.py`, `ML/export_gesture_model.py` | The forest's training and export. Untouched. |
| `recordings/`, `simulator/` | Existing data and the simulator. Untouched. |

**New files**

| File | What it does | Phase | Status |
| --- | --- | --- | --- |
| `ML/blueprint_reference.py` | The recipe in Python: motion level, crop, blueprint, distance, decide. The source of truth. | 0 | Built |
| `ML/evaluate_blueprints.py` | Scores the recipe on the recordings with honest splits. | 0 | Built |
| `ML/dump_reference_clips.py`, `ML/dump_reference_blueprints.py` | Write reference clips, blueprints and decisions for the Kotlin parity tests. | 1 | Built |
| `MotionClip.kt` | Kotlin port of steps 1 to 3. Takes the captured events, returns a 180-number clip, or nothing if the arm was quiet. No Android code inside, so it can be unit tested on a laptop. | 1 | Built |
| `GestureBlueprints.kt` | Kotlin port of steps 4 to 6 and 8. Builds blueprints, measures distance, picks a gesture or "no gesture", updates an average, and finds the odd rep out during calibration. | 1 | Built |
| `MotionClipParityTest.kt`, `GestureBlueprintsParityTest.kt` | Check the Kotlin numbers against the Python numbers on real recordings. | 1 | Built |
| `BlueprintStore.kt` | Saves and loads the user's calibration reps as a small JSON file in app-private storage, and builds the blueprints from them. | 2 | Built |
| `ui/TacturaTheme.kt` | The Tactura look for the watch screens: colors, the Doto and Space Mono fonts, cut-corner buttons. | 2 | Built |
| `ML/plot_find_the_action.py` | Draws the "find the action" chart in this doc from a real recording. | Docs | Built |
| `MotionGate.kt` | The rolling buffer and quiet-loud-quiet logic for real-time mode. | 4 | Planned |

**Files that get small additions**

| File | What is added | What is not touched |
| --- | --- | --- |
| `RecordingModels.kt` | A third session mode, `CALIBRATE`, next to `RECORD` and `CLASSIFY`. Calibration progress in `RecordingStatus`. | The `Gesture` enum and its labels |
| `RecordingService.kt` | One new branch after the capture for `CALIBRATE`. In the `CLASSIFY` branch, the blueprint answer is used when blueprints exist, and the forest answer is logged beside it. | The countdown, the 3 second capture, the sensor setup, `PREPARE_SECONDS` and `CAPTURE_MS` |
| `CsvStorage.kt` | A `GestureCalibration` folder constant, and file names for calibration reps and "no gesture" windows. The context file comes in phase 3. | The existing folders, numbering and save logic |
| `RecorderUi.kt` | A **Calibrate** button on the home screen, a "no gesture" result, and redo and reset for calibration. The screens were also restyled to the Tactura look. The **Wrong?** control is still to come. | What each button does, and the countdown and capture flow, which calibration reuses |
| `AndroidManifest.xml`, `strings.xml` | The app is now named Tactura and has its own icon. | The package name, so installs still update in place |
| `README.md` | A Calibrate section and the new folder. | Everything else |

**The rule we keep.** The repo already works this way for the forest's features: Python is the source of truth, Kotlin is a line-by-line port, and a unit test fails if they ever disagree. The blueprint code follows the same pattern, so a change on one side cannot silently drift from the other.

**One housekeeping item before anyone else builds.** `local.properties` is committed and points at Dhruv's Android SDK folder. Each person needs their own path there, and the file should come out of version control.

## Calibration on the watch

Calibration is a guided run of Record: the watch names a gesture, you do it, and after a few reps it builds your blueprint. It reuses the capture the app already has.

**What the user does**

1. Tap **Calibrate** on the home screen.
2. The watch shows the first gesture name, for example "Twist Left, rep 1 of 5".
3. Same three short buzzes, then the strong buzz. Do the gesture once.
4. The watch checks the rep. If the wrist never moved enough, it says "Didn't catch that" and repeats the rep.
5. If a rep looks very different from the earlier ones, it asks for one more instead of averaging in a mistake. A rep with two equally strong strokes is first lined up with the earlier reps (step 3b), so it is no longer dropped for that reason.
6. After the last rep of the last gesture, the watch builds and saves the blueprints. Classify now uses them.

With 5 gestures, 5 reps each and about 7 seconds per rep, calibration takes about 3 minutes. With 3 reps it takes under 2.

While calibrating, the countdown screen shows how to do the gesture once the team has agreed a definition. Today only Shake has one: "3 quick wiggles".

**What gets saved**

| What | Where | Why |
| --- | --- | --- |
| Every calibration rep as a raw CSV, in today's exact format, labeled with the gesture you were asked to do | `/sdcard/Download/GestureCalibration/` | Raw data with a true label, for the future shared dataset |
| The calibration clips for each gesture | App-private storage on the watch, one small JSON file | Loaded each time the app starts. The blueprints are rebuilt from them. |

**Fixing a wrong answer (not built yet)**

The Classify result screen will get one extra control: **Wrong?** Tapping it shows the gesture list. Picking the right gesture does two things.

- It saves that window with the true label and a note that the user corrected it.
- It folds the window into the right blueprint (step 8 of the math).

This is the simple, explicit version of learning over time. A quieter version comes later: once the word decoder exists, undoing a gesture or committing a word tells the watch the same thing without a prompt.

**Redo and reset.** The user can recalibrate one gesture or all of them. Recalibrating replaces the blueprint and keeps the old raw CSVs.

## Real-time mode

Real-time mode removes the button and the countdown: the watch listens all the time and reacts when it sees a burst of motion. It comes after the button version works, and none of it is built or tested yet.

**How it works**

1. **Sensors stay on.** The watch keeps only the last 2 seconds in memory, like a dashcam that keeps overwriting itself.
2. **It tracks the motion level** from step 1 of the math on every new reading.
3. **Quiet turns loud.** When the level crosses the threshold, a gesture has started.
4. **Loud turns quiet again.** When the level stays below the threshold for about 200 ms, the gesture is over.
5. **Crop, compare, decide.** The watch crops 1.2 s around the peak and runs steps 3 to 6 of the math.
6. **Short pause.** It ignores motion for a moment so one gesture is not counted twice.

The same "find the action" step that lines gestures up is also the trigger. Nothing new has to be invented, only run continuously.

**Cost.** Comparing one clip against five blueprints with eleven slide positions is about ten thousand subtractions. That is far less work than the forest the watch runs today.

**Real problems to solve**

| Problem | First idea |
| --- | --- |
| Everyday motion is also loud (walking, reaching for a cup) | The "close enough" limit in step 6 rejects movements that match no blueprint. It needs testing with real daily motion. |
| Gestures back to back | Require a short quiet gap between gestures, and tell users so. |
| Battery, with sensors always on | Measure it. If it is bad, add a "listening" toggle or a wake gesture. |
| Tuning the trigger by feel | Dhruv's planned live streaming to a laptop shows the motion level on a big screen. It is a tuning tool and is not needed once tuned. |

**Where it goes in the code.** A new session mode in `RecordingService` keeps the sensor listeners registered and feeds each reading to a small new class, `MotionGate`, which holds the rolling buffer and the quiet-loud-quiet logic. Everything after the gate is the same code as the button version.

## The data we keep

Every calibration rep and every classified window is saved as raw sensor data with context, so the team can pool it later and train a stronger shared model. Using the product builds the dataset. The raw CSVs are saved today. The context file is phase 3 and is not built yet.

**Rule 1: always keep the raw recording.** Blueprints and other patterns are today's best guess. We only caught the arm-angle problem because the raw recordings were still there to re-test. Derived patterns can be saved too, but never instead of raw.

**Rule 2: the CSV format does not change.** The header and columns stay exactly as they are, so the training script, the plotting tool and all 250 existing recordings keep working. Context goes in a small companion file, not in new CSV columns.

**The context saved with each recording**

| Field | Example | Why it matters |
| --- | --- | --- |
| Recording file | `0012_twist_left_20261112_193000.csv` | Links the context to the raw data |
| User | `u07` (an anonymous code, never a name) | Lets us test on people the model has not seen |
| Wrist | left | Mirrors the motion |
| Watch model | Galaxy Watch 7 | Different sensors, different mounting |
| Session | `2026-11-12-a` | Lets us test across days, which a shuffled split hides |
| Intended gesture | TWIST\_LEFT | The true label |
| How we know | calibration prompt, user confirmed, or user corrected | A corrected mistake is the most useful example there is |
| What the watch predicted | TWIST\_RIGHT, distance 1.9 | Shows where the model is weak |
| App version | 1.1 | Capture details can change between versions |

**Where files go on the watch**

| Folder | Contents | Status |
| --- | --- | --- |
| `/sdcard/Download/GestureDataRecorder/` | Record mode training CSVs | Exists today, unchanged |
| `/sdcard/Download/GestureClassify/` | Every classified window | Exists today, gains the context file |
| `/sdcard/Download/GestureCalibration/` | Calibration reps | New |

Each folder gets one context file, `context.jsonl`, with one line per recording. Pulling a folder with `adb pull` brings both.

**Before collecting from people outside the team.** Ask for consent in the app, store only the anonymous code, and ask Prof. Nishida whether publishing with this data needs ethics approval. It is cheap to settle now and painful to fix later.

## Build phases and how we test each one

We build in six small phases, and each one has a test that must pass before the next starts. Phases 0 to 2 are the December demo. Phases 3 to 5 are what comes after.

| Phase | What gets built | It is done when | Status (Nov 11) |
| --- | --- | --- | --- |
| 0. Prove it on the laptop | `ML/blueprint_reference.py` (the recipe in Python, the source of truth) and `ML/evaluate_blueprints.py` (the scoring) | Anyone on the team can run one command and get the numbers in this doc from the recordings in the repo | Done |
| 1. Port to the watch code | `MotionClip.kt`, `GestureBlueprints.kt` and a parity test | The Kotlin code gives the same clips and distances as the Python on real recordings, checked by a unit test | Done. The parity tests pass. |
| 2. Calibrate and classify on the watch | Calibrate mode, blueprint-based Classify, the "no gesture" answer, the **Wrong?** correction | A teammate who is not in any training data calibrates, then passes the scorecard below | Running on the watch. **Wrong?** is not built. Russell scored 41 of 50 right after calibrating, below the 90% target, and no teammate has tried it yet. |
| 3. Learn and log | Corrections update blueprints. Context files are written for every recording. | A corrected gesture is recognised next time, and a pulled folder has a context line per CSV | Not started |
| 4. Real-time listening | `MotionGate` and the always-listening mode | Ten gestures in a row with no button, plus one minute of ordinary arm movement with at most one false gesture | Not started |
| 5. Upgrades | Eigengestures, a shared starting blueprint, the frequency second opinion | Each one beats the plain average on data from at least three people, or it is dropped | Not started |

**The phase 2 scorecard**

| Check | Target |
| --- | --- |
| 10 reps of each calibrated gesture, done right after calibration | At least 90% correct |
| The same 10 reps on a different day, without recalibrating | At least 85% correct |
| Still arm in three poses (flat, tilted, hanging), 10 windows | 0 gestures named |
| Arm moved between poses without a gesture, 10 windows | At most 1 gesture named |

The targets are proposals for the team to set. The watch test on 11/10 took about 25 minutes for 77 windows, so this scorecard fits in one sitting.

**Testing rules, learned the hard way**

- **Never trust a shuffled split of one sitting.** It scored 96% on a model that scored 49% on a real person. Test on a different day or a different person.
- **Always include "nothing happened" windows.** A model that cannot say "no gesture" looks fine until someone holds still.
- **Report every gesture separately.** An average hid the fact that Flick Down scored 0 of 10.
- **Write down the truth as you go.** The watch only saves what it guessed. After phase 3 the context file does this for us.
- **One knob at a time.** One early result here swung from 80% to 100% with a single smoothing setting. A number that depends on one lucky setting is not a result.

## Working order (Nov 15)

The demo target is solid personal gesture recognition with the math front and center. So the order below makes the current five gestures provably reliable before anything new is added. Where it disagrees with the phase table above, this order wins. It is a working proposal and the team can change it.

| Order | Work | Why here |
| --- | --- | --- |
| 1, done 11/15 | Scorecard on the current blueprints, then pull the data | An informal check on 11/15 named every gesture correctly using the 11/10 blueprints with no recalibration. It was not scored. A scored run turns that into evidence and brings the redone Shake reps to the laptop. |
| 2, parts A and B built 11/15 | Measure, then test fixes on the laptop | See how close each gesture lands to its limit. Flicks are small (about 1 rad/s), so normal variation between reps uses 36 to 67% of their size against the 90% limit. Twists use 9 to 33%. Eigengestures (step 7) get tested here first. |
| 3 | The **Wrong?** correction | Blueprints that learn while worn. `GestureBlueprints.update` already exists and nothing calls it yet. |
| 4 | Real-time listening | Phase 4 as written. |
| 5 | Chords with the accelerometer | Parked. See the next section. |

### Scorecard, Nov 15 (step 1, done)

Russell, Galaxy Watch 7, left wrist. Flick Up, Flick Down, Twist Left and Twist Right used the 11/10 blueprints with no recalibration, five days later. Shake was recalibrated a minute before the run. Truth comes from the order he did the gestures in. No "nothing" windows were run this time. All 60 windows gave the same answer on the laptop as on the watch.

| Gesture | Correct | Ignored | Misnamed | Match shown on the watch |
| --- | --- | --- | --- | --- |
| Twist Left | 12 of 12 | 0 | 0 | 59 to 83% |
| Twist Right | 12 of 12 | 0 | 0 | 50 to 81% |
| Flick Up | 14 of 14 | 0 | 0 | 11 to 55% |
| Flick Down | 8 of 12 | 4 | 0 | 11 to 39% |
| Shake | 8 of 10 | 0 | 2, both called Twist Left | 58 to 81% |
| **Total** | **54 of 60 (90%)** | **4** | **2** | |

**What the data showed**

- **Twists survive five days.** Same match range as on 11/10.
- **The two misnamed shakes were good shakes, cropped in the wrong place.** Russell's shake is a left stroke then a right stroke, about equally loud. "Find the action" centres the clip on the louder one. Eight times that was the right stroke, as in calibration. Twice it was the left stroke, which moved the clip by about 340 ms. The slide in step 5 only corrects 100 ms. A shake cropped around its left stroke looks like a Twist Left. Allowed to slide further, both clips match the Shake blueprint, missing it by 50% and 38% of its size.
- **Flicks sit at the limit.** Today's flicks were about 25 to 30% smaller than on 11/10. Today's Flick Down was mostly on the y axis (78%), where the 11/10 calibration was mostly on x (60%). But a blueprint built from the first five of today's reps did not clearly do better on the rest: Flick Down 4 of 7 against 3 of 7 with the old one, Flick Up 7 of 9 against 9 of 9. Today's flicks miss a blueprint built from each other by a median 55% (up) and 69% (down) of its size. So the main issue is variation between reps of a small gesture, more than a stale calibration. This is one split on few windows, so treat it as a pointer.
- **Arm tremor is measurable but small.** The resting motion level was 0.06 rad/s, against 0.04 on 11/10. A flick is about 0.8.

The pulled files are in `classify_logs_v3/` (files 0117 to 0176) and `calibration_logs_v2/`.

### Alignment fix, Nov 15 (step 2, part A)

The scorecard left two separate problems. A: a clip can be centred on the wrong stroke. B: flicks are barely bigger than the normal variation between reps. Part A is fixed in the code and waits for a watch test. Part B is next.

Three ways of centring the clip were compared. Each number uses 5 random reps per gesture as blueprints and tests on the rest, repeated 12 times, with the 90% limit on.

| Method | Russell, 11/15 | Russell, 11/10 | Dhruv's recordings |
| --- | --- | --- | --- |
| Loudest moment (the old way) | 92% correct, 3% misnamed | 89% | 84% |
| Balance point of the action | 96%, 0% misnamed | 79% | 91% |
| One clip per strong stroke (chosen) | 96%, 0.5% misnamed | 89% | 91% |

- **The balance point was tried first and rejected.** It is the average time of the loud readings, weighted by loudness. It fixed the shake but dropped Russell's 11/10 Flick Down from 72% to 22%. A flick is a stroke plus a rebound, and the rebound's strength changes from rep to rep, which drags the balance point by up to 180 ms. A second movement later in the window (the arm resettling) drags it into the quiet gap between the two.
- **One clip per strong stroke was never worse than the old way** on the three data sets, and matched the balance point's gains.
- **The repo's own evaluation agrees.** `python ML\evaluate_blueprints.py` before and after: Dhruv with 5 reps went from 83% to 88% correct with the limit on, Russell's 11/10 set went from 91% to 90%, and the first-5-then-45-later test went from 214 to 213 of 225.
- **What it does not fix.** Russell's Shake (left, right, back to centre) and Twist Left (left, then back) are close relatives on the same axis. Once shakes are lined up properly, hiding either blueprint makes the watch call most of that gesture by the other's name. With both blueprints present they were told apart every time in the 11/15 run. A shake that starts to the right, or has more wiggles, would sit further from a twist. That is a gesture design decision for the team.
- **One thing to watch.** Trying more clips gives every blueprint more chances to fit, including the wrong one. On Russell's 11/10 shake, which had no definition yet, "closest wins" with no limit went from 81% to 72%.

**On the watch, 11/15 evening.** The build with one clip per strong stroke compiled, all 18 parity tests passed, and the watch gave the same answer as the laptop on 16 of 16 windows. After recalibrating Shake at his natural pace, Russell did 15 shakes and one Twist Left: 16 of 16 correct, with the shakes at 67 to 88% match. The old recipe would have called 6 of those 15 shakes Twist Left.

**Tempo matters.** An earlier batch of 20 shakes the same evening, on the old build and a slower calibration, scored 17 of 20. The gap between the two strokes was 360 ms in that calibration and 230 to 350 ms in the test, and the match fell from about 55% to about 15% as the gap shrank (correlation 0.91). The comparison can slide a clip in time but it cannot stretch it. Calibrating at the pace the gesture is really done at fixed it for now.

**Not built yet: one ruler.** The winner is picked by raw distance in rad/s but judged by percent of size. A fast shake once missed Shake by 73% of its size and Twist Left by 87%, yet Twist Left won because it is the smaller gesture (3.35 against 3.39 rad/s). Picking the winner by percent too gave 19 of 20 on that batch and helped on Dhruv's data, but turned some ignored windows into wrong names on Russell's 11/10 set (0% to 3.5%). It was then tested on flicks and dropped, see the next section.

The comparison of the three methods was run from a scratch script and is not in the repo. The chosen method is in `ML/blueprint_reference.py`, so the evaluation script reproduces its numbers.

### Flick variation, Nov 15 (step 2, part B: measured, not fixed yet)

Flick Up and Flick Down had to be recalibrated twice on 11/15 because they slid to "no gesture" within hours, while the twists ran on five-day-old blueprints. The recordings show why: Russell does not do the same flick from one sitting to the next. How much forearm roll sneaks into it changes a lot.

| Sitting | Flick Up: share of motion on the twist axis, size | Flick Down: share on the twist axis, size |
| --- | --- | --- |
| 11/10 evening test | 50%, 0.94 rad/s | 75%, 0.52 rad/s |
| 11/10 calibration | 33%, 0.99 | 60%, 1.12 |
| 11/10 test after calibrating | 51%, 0.90 | 73%, 0.74 |
| 11/15 afternoon test | 32%, 0.65 | 35%, 0.74 |
| 11/15 recalibration, 5:46 PM | not redone | 32%, 0.67 |
| 11/15 recalibration, 6:47 PM | 8%, 0.82 | 43%, 1.14 |

The blueprints of the same flick from two sittings sit 33 to 160% of their size apart. The limit is 90%, and normal variation inside one sitting already uses 50 to 65%.

**The test.** Each of the 71 flick windows was judged by blueprints that had never seen its sitting, with the twists and Shake present as usual.

| What the watch knows about a flick | Correct | Ignored | Misnamed |
| --- | --- | --- | --- |
| One blueprint from the most recent earlier sitting (what the app does today) | 47 (66%) | 24 | 0 |
| The same, plus eigengestures (step 7) | 53 (75%) | 18 | 0 |
| One blueprint per earlier sitting | 51 (72%) | 20 | 0 |
| One blueprint per earlier sitting, plus eigengestures | 61 (86%) | 10 | 0 |

For comparison, a flick tested inside the sitting it was calibrated in scores 83%.

- **Eigengestures help.** Russell's idea from 11/10. With 5 reps and 2 directions it recovered 6 of the 24 ignored flicks and named nothing wrong. Inside one sitting it took flicks from 83% to 92%.
- **Remembering earlier sittings helps more when the two are combined.** Keeping one blueprint per sitting, instead of replacing the old one, is the "keeps learning while worn" idea in its simplest form.
- **One ruler was dropped.** Picking the winner by percent of size turned about one flick in eight into a wrong name. A weak flick is roughly 85% away from a big twist on the same axis, which passes the limit. Picking by raw distance lets the small flick blueprint win first and then fail its own limit, so the window is ignored instead. The two rulers protect small gestures.
- **Comparing shape only was dropped.** Letting the strength float between half and double scored 42% across days with many wrong names.
- **Safety check.** With every flick blueprint from all six sittings loaded, 40 of 40 twists and shakes from 11/15 were still right, 20 of 20 still-arm windows were ignored, and no twist or shake was taken for a flick when its own blueprint was hidden.
- **What is missing.** There are no recordings of ordinary arm movement. Eigengestures and extra blueprints both make matching more forgiving, and without those recordings we cannot measure false alarms. Record ten windows of random movement at the next sitting.

The table above used 2 directions and a cap of 3 times the spread. These tests were run from scratch scripts and are not in the repo.

### Eigengestures built, Nov 15 (step 2, part B)

**Choosing the settings.** Russell asked for a sweep before deciding. Cap fixed at 2 times the spread:

| Directions | Flicks in a new sitting | Flicks in the same sitting | All 96 scored windows of 11/15 | Dhruv's recordings | Odd movements accepted, of 96 |
| --- | --- | --- | --- | --- | --- |
| 0 (before) | 66% | 83% | 93% | 84% | 11 |
| 1 | 69% | 97% | 98% | 87% | 18 |
| 2 (chosen) | 75% | 97% | 99% | 88% | 19 |
| 3 | 76% | 97% | 99% | 90% | 24 |
| 4 | 79% | 97% | 100% | 91% | 25 |

"Odd movements" are the real windows with two sensor axes swapped, which gives movements no gesture uses. It is a rough stand-in for random arm movement. He chose 2 directions and a cap of 2, the cautious end, to be revisited once real random movement is recorded.

**A hole found while building, and the guard for it.** A clip of no motion used to be exactly 100% away from every blueprint, which is why the limit sits at 90%. With eigengestures that is no longer true for small gestures. Part of the gap between "nothing" and a flick lies along the flick's own directions of variation, so it gets forgiven: a clip of no motion came out only 65 to 79% away from Russell's Flick Up. A faint twitch could then pass as a flick.

The guard is a second rule next to "close enough": the clip's own size must be at least 50% of the blueprint's size. To test it, every real window was shrunk to a faint copy and run through the recipe, with the motion threshold applied.

| | Faint copies that still got a name, summed over 10, 15, 20, 30 and 40% strength (of 480) | Accuracy on the 96 windows |
| --- | --- | --- |
| Before eigengestures | 132 | 89 right, 6 ignored, 1 misnamed |
| Eigengestures alone | 222 | 95, 0, 1 |
| Eigengestures plus "strong enough" at 50% (built) | 125 | 95, 0, 1 |
| Eigengestures plus "strong enough" at 60% | 86 | 95, 0, 1, and one flick fewer in the new-sitting test |

So the guard brings faint-movement behaviour back to where it was, at no cost in accuracy. Two other options were tried. Forgiving shape only and never strength kept "nothing" at exactly 100% but gave up about half of the gain on flicks. A floor of 60% leaks less and costs one flick in 71. The value is one setting, `MIN_STRENGTH`.

Many of the faint copies that still get a name are faint twists that resemble Russell's Flick Down, which he sometimes does with a lot of forearm roll. That is the gesture set, not the math.

**The repo's evaluation, before and after.** `python ML\evaluate_blueprints.py`: Russell's 11/10 set with 5 reps went from 90% to 95% correct with the limits on, Dhruv from 88% to 91%, the first-5-then-45-later test from 213 to 215 of 225, and the hidden-blueprint test still ignores every window.

**On the watch's own blueprints.** Replaying the 96 scored windows of 11/15 against the reps stored on the watch: 95 right, none ignored, 1 misnamed (a fast shake from before the Shake recalibration). The four ignored Flick Downs of the afternoon all come back. No recalibration is needed, because the watch stores the reps and rebuilds blueprints from them.

**On the watch, 11/15 at 7:20 PM (cap 2, strong enough 50%).** The build compiled, all 20 parity tests passed, and the watch matched the laptop on 50 of 50 windows. Russell did 20 movements that should be ignored and 30 real gestures, with no recalibration.

| Part | Result |
| --- | --- |
| 10 random movements (reach, scratch hair, wave, lower arm, punch, raise hand, stretch) | 9 ignored, 1 hair scratch called Flick Up |
| 10 gentle moves (flicks in three directions, shakes) | 9 ignored, 1 gentle shake called Flick Up |
| 10 Flick Up, 10 Flick Down | 20 of 20 |
| 5 Twist Left, 5 Twist Right | 10 of 10 |

- **Why the 18 were ignored.** 11 were not close to any blueprint (they missed by 112 to 233% of its size), 5 were stopped by the "strong enough" rule, and 2 never passed the motion threshold. Without the "strong enough" rule 7 would have been named instead of 2.
- **The two that got through** matched Flick Up at 13% and 10%, where 10% is the passing mark. Both were soft movements about 61 to 67% as strong as the Flick Up blueprint, the smallest gesture.
- **Eigengestures bought nothing in this sitting.** The flick blueprints were 40 minutes old, and the recipe without eigengestures would also have scored 30 of 30 with no false alarms. Their gain is on older blueprints, so the test that matters is another day with no recalibration.

**Retuned with the real negatives.** Every option below keeps the 30 real gestures at 30 of 30.

| Setting | False alarms, of 20 | 96 scored windows of 11/15 | Flicks in a new sitting | Faint copies named, of 480 |
| --- | --- | --- | --- | --- |
| Cap 2, strong enough 50% (first build) | 2 | 95 right | 75% | 117 |
| Cap 1.5 | 0 | 95 right | 73% | 114 |
| Cap 1.5, strong enough 60% (chosen) | 0 | 95 right | 72% | 81 |
| Strong enough 70% | 0 | 91 right | 65% | 64 |
| Close enough 85% | 0 | 94 right | 66% | 92 |
| 1 direction | 0 | 94 right | 69% | 90 |
| 3 or 4 directions | 3 | not run | not run | not run |
| No eigengestures | 0 | 89 right | 66% | 132 |

Russell chose cap 1.5 with strong enough at 60%. This was tuned on two false alarms that were borderline, so it needs more random-movement windows from another day.

**Not done.** Watch test of the retuned build. A test on another day with no recalibration. Keeping one blueprint per sitting.


## Parked idea: chords (rotation plus translation)

Russell's idea, 11/15. Not started. It comes after everything else in the working order.

**The idea.** Use the accelerometer together with the gyroscope, so a hand translation (up, down, left, right) can be combined with a twist. Russell's pick is a chord: the translation happens at the same moment as the twist, like pressing several keys at once in stenography. He also sees room for doing the two one after another. Two twists times four directions would give eight symbols from moves the user already knows.

**What we know going in**

- **Why the accelerometer was dropped.** It measures gravity, so it records the resting angle of the arm. Gravity has to be removed first. Android has a linear acceleration sensor that does this.
- **"Up" moves during a twist.** Russell's Twist Left rolls the wrist by roughly 160 degrees (the main stroke of his blueprint, added up). So "up" in the watch's own frame changes in the middle of the gesture. Direction has to be measured in the room's frame, using the rotation vector sensor. We have never used that sensor.
- **Fast twists strain gravity removal.** His twists peak near 20 rad/s. The gravity estimate can lag at that speed, and the leftover error looks like movement.
- **A pure twist also shows up as acceleration.** The watch sits a few centimeters off the forearm's axis.
- **One after another is the easy case.** Translate, then twist, avoids most of the above. A true chord needs the extra frame conversion.
- **Data.** Every CSV already has the accelerometer columns. There are no recordings of translation gestures yet.

**Open design question, not decided.** One blueprint per combination, or one per ingredient?

| | One blueprint per chord | One blueprint per ingredient |
| --- | --- | --- |
| What gets calibrated | 8 chords | 2 twists and 4 directions |
| Reps at 5 each | 40 | 30 |
| How it grows | By multiplication | By addition |
| Risk | Long calibration | Only works if the twist and the translation do not disturb each other's signal |

**First step when we pick this up.** Record a few reps of each candidate with Record mode and look at the accelerometer on the laptop before building anything.

## Open questions and risks

The biggest risk is not the math. It is that the team has not agreed what each gesture physically is. The list below is for the team to decide, tick off and argue about.

- [ ] **What exactly is a shake, and a flick?**

  Dhruv's shake is a gentle wobble on mixed axes. Russell's is a fast forearm rotation that looks like a violent twist. Personal blueprints cope with this for one user, but a shared model and the user instructions both need one written definition, ideally with a short video. For now the app pins Shake to "3 quick wiggles" as a placeholder.
- [ ] **Double Tap may be invisible to the gyroscope.**

  There are no Double Tap recordings yet, and earlier notes put its rotation under about 1 rad/s, which is below the motion threshold. It may need the accelerometer with the gravity part removed, or a different sixth gesture.
- [ ] **Is Twist Right too awkward on the left wrist?**

  Russell's right twist was about 40% slower than his left. If a gesture is uncomfortable, people will do it inconsistently however good the matching is.
- [x] **How many reps should calibration ask for: 3 or 5?**

  3 scored about 96% on the average alone. 5 takes about a minute longer and allows eigengestures. Decided on 11/10: 5 reps.
- [ ] **Every threshold was set on two people.**

  The motion threshold of 1.0 rad/s, the 140 ms smoothing and the "close enough" limit all need checking on Amit, Raghav and Sai before they are trusted.
- [ ] **Does a blueprint survive to the next day?**

  All tests so far are within one sitting. Strap position and tightness change between days. The phase 2 scorecard tests this directly.
- [ ] **Which wrist and which watch produced the 250 training recordings?**

  This matters for any shared starting blueprint. Dhruv will know.
- [ ] **Will everyday motion trigger false gestures in real-time mode?**

  Unknown. Nothing has been recorded while walking, typing or reaching.
- [ ] **Do we keep the forest?**

  Proposal: keep it in the app as a comparison until phase 2 passes, then retire it and the ONNX export step.
- [ ] **Consent and ethics for pooled data.**

  Needed before anyone outside the team is recorded. Ask Prof. Nishida.
- [ ] **Who builds what?**

  Dhruv was waiting on a consensus before building laptop streaming. Under this plan streaming becomes a tuning tool for phase 4, and the watch UI work moves to Calibrate mode.

## Glossary

| Term | Plain meaning |
| --- | --- |
| Gyroscope | The sensor that reports how fast the wrist is rotating, in radians per second. It reads near zero when the arm is still, whatever the angle. |
| Accelerometer | The sensor that feels acceleration, including gravity. Gravity makes it report the arm's angle even when nothing is moving. |
| rad/s | Radians per second, a rotation speed. About 6.3 rad/s is one full turn per second. |
| Reading | One sample from a sensor. The watch gives 50 a second. |
| Window | The 3 seconds the app records after the strong buzz. |
| Motion level | One number for how hard the wrist is turning right now. |
| Clip | The 1.2 seconds cut out around a strong stroke of a window. Most windows give one clip that matters, centred on the loudest moment. |
| Rep | One performance of a gesture. |
| Blueprint | The average of a few clips of the same gesture from the same person. |
| Distance | How much a clip and a blueprint disagree on average, in rad/s. Smaller means more alike. |
| Calibration | The first-run step where a user does each gesture a few times so the watch can build blueprints. |
| Model | Anything that turns numbers into an answer using something learned from data. The blueprints are the model. |
| Random forest | The current model: 500 decision trees that each ask yes or no questions about single numbers, then vote. |
| ONNX and joblib | File formats for the forest. Joblib is the Python version, ONNX is the copy the watch can run. Blueprints need neither. |
| Eigengestures | The main directions in which a person's reps differ from their own average. Found with PCA. |
| PCA | Principal component analysis. A standard way to find the directions in which a cloud of points varies the most. |
| Prior and posterior | A starting belief and the updated belief after seeing data. Here: the shared blueprint, then your personal one. |
| Fourier transform | A way to describe a signal by how much of each wiggle speed it contains. |
| Shuffled split | Testing on a random part of the same recordings used for training. It hides problems when recordings from one sitting look alike. |
| Parity test | A unit test that checks the Kotlin code on the watch gives the same numbers as the Python code on the laptop. |
| Sidecar or context file | A small file saved next to the recordings that says who, when, which wrist and what the gesture was meant to be. |
