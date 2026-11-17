# Tactura data

Everything recorded on the lab's Galaxy Watch 7, one folder per person. The watch is shared and does not know who is wearing it, so whoever pulls files off it sorts them into the right person's folder (see "Where pulled files go" in the main README).

## Layout

```text
data/
  dhruv/
    recordings/     250 Record-mode CSVs, 10/9, 50 of each of 5 gestures
    early-tests/    2 Record-mode CSVs from 9/28, probably Dhruv's, not confirmed
  russell/
    classify/       461 Classify windows, 11/10 and 11/15
    calibration/    81 calibration reps, 11/10 and 11/15
    listen/         50 Listen-mode files, 11/15 (a stream file and a decisions file per session)
    corrections/    5 Wrong? taps, 11/15
    recordings/     100 Record-mode CSVs, 11/15 and 11/16 (flicks, shakes, pinches, fists, still arm, shoves)
```

| Folder | Who | Wrist | Dates | Readings per second |
| --- | --- | --- | --- | --- |
| `dhruv/recordings` | Dhruv | not written down | 2026-10-09, 9:32 to 11:09 PM | 50 |
| `dhruv/early-tests` | probably Dhruv | not written down | 2026-09-28 | 50 |
| `russell/*` | Russell | left | 2026-11-10, 11-15 and 11-16 | 50, except the files named `double_tap`, which are about 100 |

## Answer keys (labels)

A labels file says what was really done in each file. It has one row per file: `file`, `truth`, `note`.

| File | Covers |
| --- | --- |
| `russell/classify/labels.csv` | 11/10, 7 PM session (the old forest model) |
| `russell/classify/labels_20261110_late.csv` | 11/10, 10:42 to 11:50 PM (the first blueprint build) |
| `russell/classify/labels_20261115.csv` | 11/15, every round |
| `russell/recordings/labels.csv` | all 100 Record-mode files, including the ones named `double_tap` |

The `truth` column uses the gesture names (`FLICK_UP`, `TWIST_LEFT`, `SHOVE_UP`...), plus `PINCH`, `DOUBLE_PINCH` and `FIST`, and two words for windows that should give no gesture: `STILL` (the arm did not move) and `NOTHING` (the arm moved, but not as a gesture, like a hair scratch). An empty `truth` means nobody wrote down what was done, so leave that file out of any score.

The answer keys for 11/10 late and 11/15 were rebuilt on 11/16 from the order Russell reported doing things in, and checked: graded against the watch's own guesses, every round gives exactly the numbers in `docs/gesture-recognition-v2-plan.md`.

Files that need no answer key: Dhruv's recordings, the calibration reps (the name is the gesture calibration asked for) and the Wrong? corrections (the name says what the watch said and what it really was). The Listen-mode files have none, because what Russell meant to spell was not written down.

## Read this before using any file

1. **A file name is not the truth.** In `classify/` the name and the `gesture_label` column hold what the watch guessed. In `recordings/` they hold whichever gesture was selected on the watch.
2. **83 of Russell's recordings are named `double_tap` but are not double taps.** Record mode can only label a file with a gesture from its list, and Double Tap was the setting that gave the fast sensor readings. `russell/recordings/labels.csv` has the real answer for each one:
   - 11/15, files 0018 to 0052: pinches, double pinches, fists and still-arm windows
   - 11/16, files 0053 to 0100: 8 each of shove up, down, left and right, then 8 Twist Rights with a shove up and 8 with a shove right
3. **File numbers repeat.** The watch started its Classify numbering over on the evening of 11/10, so `russell/classify/` has two files for each number from 0001 to 0077. Dhruv's numbers count per gesture, so they repeat too. Always go by the full file name.
4. **A few Classify windows have no answer.** Informal tries between rounds were never written down, so their `truth` is empty: 4 windows on 11/10 and 32 on 11/15.
5. **Dhruv's 250 were recorded in blocks of 50**, one gesture at a time, and the resting arm angle differs between blocks. A model can tell them apart from the accelerometer alone without looking at the motion at all. Use the gyroscope, or test on another person or another day.
6. **The two 9/28 files are not confirmed.** One is a Twist Right and the other is the only real Double Tap recording that exists. Ask Dhruv before using them.

## Practice data and the locked test

Everything in here so far is practice data: it has been looked at, and settings were tuned on it. For the locked test, each tester's sessions go in their own folder, and nobody opens them until the settings are frozen. Once a test set has been looked at and a setting changes because of it, it becomes practice data too.

On Russell's laptop, `_old_pulls/` holds the older pulls, which git ignores. Each newer pull already contained everything in the older ones, so nothing in there is missing from this folder.
