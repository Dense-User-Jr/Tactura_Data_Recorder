# Russell's Classify windows

Everything pulled from `/sdcard/Download/GestureClassify` on the lab's Galaxy Watch 7 through 2026-11-15: 461 windows, all Russell, watch on the left wrist.

The file names and the `gesture_label` column hold what the watch **guessed**, not what was done. The watch started its numbering over on the evening of 11/10, so the numbers 0001 to 0077 appear twice. Go by the full file name.

| Session | Files | Truth |
| --- | --- | --- |
| 11/10, 7:13 to 7:38 PM, old forest model | 0001 to 0077 with a `20261110_19` timestamp | `labels.csv` |
| 11/10, 10:42 to 11:50 PM, first blueprint build | 0001 to 0110 with a `20261110_22` or `20261110_23` timestamp | not written down yet |
| 11/15, 4:37 to 9:21 PM | 0111 to 0384 | not written down yet |

## The 11/10 evening test (`labels.csv`)

Tester: Russell, watch on the left wrist, app build from commit 431b4f1 (the 11/9 build). The truth in `labels.csv` comes from Russell's written scorecard, matched to the files by order.

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

Never copy these CSVs into a training folder such as `data/dhruv/recordings`. Their label column is a guess.
