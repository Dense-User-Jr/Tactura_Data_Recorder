#!/usr/bin/env python3
"""Write reference bursts for the Kotlin MotionGate parity test.

Usage:  python ML/dump_reference_gate.py

There are no recordings of a stream yet, so this makes one: the gyro events of a
few real recordings are played one after another, with a small gap between
files. The gap is an odd number of nanoseconds on purpose, so each file lands
differently on the 50 Hz grid.

Lines of wear/src/test/resources/reference_gate.csv:

    S,<gap in ns>,<file>;<file>;...                     the stream recipe
    B,<start>,<last>,<readings or -1 if too long>,<sum x>,<sum y>,<sum z>,<clips>
                                                        one line per burst, in order
"""
from pathlib import Path

import blueprint_reference as B

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = PROJECT_ROOT / "wear" / "src" / "test" / "resources" / "reference_gate.csv"
GAP_NS = 37_123_457
EVERY = 9      # take every 9th recording
FILES = 14


def main():
    recordings = sorted((PROJECT_ROOT / "data" / "dhruv" / "recordings").glob("*.csv"))
    picked = recordings[::EVERY][:FILES]
    gate = B.MotionGate()
    lines = [",".join(["S", str(GAP_NS), ";".join(path.relative_to(PROJECT_ROOT).as_posix() for path in picked)])]
    offset = 0
    kept = 0
    for path in picked:
        _, events = B.read_gyro_events(path)
        shift = offset - events[0][0]
        for timestamp, x, y, z in events:
            for start, last, gyro in gate.push(timestamp + shift, x, y, z):
                if gyro is None:
                    lines.append(",".join(["B", str(start), str(last), "-1", "0", "0", "0", "0"]))
                    continue
                kept += 1
                sums = [repr(float(gyro[axis].sum())) for axis in range(3)]
                lines.append(",".join(["B", str(start), str(last), str(gyro.shape[1]), *sums, str(len(B.clips_from_gyro(gyro)))]))
        offset = events[-1][0] + shift + GAP_NS
    OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(lines) - 1} bursts ({kept} kept, {len(lines) - 1 - kept} too long) from {len(picked)} recordings to {OUTPUT}")


if __name__ == "__main__":
    main()
