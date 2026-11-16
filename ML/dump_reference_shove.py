#!/usr/bin/env python3
"""Write a reference stream for the Kotlin ShoveDetector parity test.

Usage:  python ML/dump_reference_shove.py

Plays a few of the shove recordings of 2026-11-16 one after another as one
stream, thinned to the 50 readings a second that Listen mode has, and writes
down both the events and what `ShoveDetector` in ML/shove_reference.py made of
them. The recordings live in `recordings_shove_v1/`, which is kept out of git,
so the events themselves go in the file and the test needs nothing else.

Lines of wear/src/test/resources/reference_shove.csv:

    E,<A or G>,<timestamp ns>,<x>,<y>,<z>      one event, in arrival order
    O,<index of the event that produced it>,<direction or NONE>,<start ns>,<end ns>,
      <reason>,<speed>,<axis>,<turned>,<gyro peak>      one judged stretch

The gap between recordings is an odd number of nanoseconds, and one gap is
longer than the detector's MAX_GAP_NS so that starting over is covered too.
"""
from pathlib import Path

import shove_reference as S

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE = PROJECT_ROOT / "recordings_shove_v1"
OUTPUT = PROJECT_ROOT / "wear" / "src" / "test" / "resources" / "reference_shove.csv"
# Two of each shove (54 is a faint one that is turned down, 62 is also named Flick Down
# by the blueprints), then a Twist Right with a shove up and one with a shove right.
NUMBERS = [53, 54, 61, 62, 69, 70, 77, 78, 85, 93]
GAP_NS = 37_123_457
LONG_GAP_NS = 250_000_003
LONG_GAP_AFTER = 4   # the long gap comes after this many recordings


def main():
    events = []
    offset = 0
    for position, number in enumerate(NUMBERS):
        matches = sorted(SOURCE.rglob(f"{number:04d}_*.csv"))
        if not matches:
            raise SystemExit(f"recording {number:04d} is not in {SOURCE}")
        recording = S.thin(S.read_events(matches[0]))
        shift = offset - recording[0][1]
        events.extend((kind, timestamp + shift, x, y, z) for kind, timestamp, x, y, z in recording)
        offset = events[-1][1] + (LONG_GAP_NS if position + 1 == LONG_GAP_AFTER else GAP_NS)
    found = S.outcomes(events)
    lines = [f"E,{kind},{timestamp},{x!r},{y!r},{z!r}" for kind, timestamp, x, y, z in events]
    for index, outcome in found:
        lines.append(",".join([
            "O", str(index), outcome.direction or "NONE", str(outcome.start_ns), str(outcome.end_ns), outcome.reason,
            repr(outcome.speed), str(outcome.axis), repr(outcome.turned), repr(outcome.gyro_peak),
        ]))
    OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    shoves = [outcome.direction for _, outcome in found if outcome.direction]
    print(f"Wrote {len(events)} events and {len(found)} judged stretches ({len(shoves)} shoves: {' '.join(shoves)}) to {OUTPUT}")
    print("Turned down: " + ", ".join(sorted({outcome.reason for _, outcome in found if not outcome.direction})))


if __name__ == "__main__":
    main()
