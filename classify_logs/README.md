# Watch test, 2026-11-10

77 Classify windows pulled from the lab's Galaxy Watch 7 (`adb pull /sdcard/Download/GestureClassify`).
Tester: Russell, watch on the left wrist, app build from commit 431b4f1 (the 11/9 build).

The file names and the `gesture_label` column hold what the watch **guessed**, not what was done.
The truth is in `labels.csv`, taken from Russell's written scorecard and matched to the files by order.

| Files | What was done |
| --- | --- |
| 0001 to 0004 | Practice runs, not scored |
| 0005 to 0014 | Flick Up |
| 0015 to 0024 | Flick Down |
| 0025 to 0034 | Twist Right |
| 0035 to 0045 | Twist Left |
| 0046 to 0055 | Shake |
| 0056 to 0065 | Still arm, flat on a desk |
| 0066 to 0075 | Still arm, tilted as if checking the time |
| 0076 to 0077 | Extra runs, not on the scorecard |

Never copy these CSVs into `recordings/GestureDataRecorder`. Their label column is a guess.
