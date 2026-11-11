"""Write reference values for the Kotlin parity test of MotionClip.kt.

Runs steps 0 to 3 of ML/blueprint_reference.py (even grid, motion level, find
the action, crop) on a sample of real recordings and writes one line per file to
wear/src/test/resources/reference_clips.csv:

    <path from the repo root>,<peak index>,<peak level>[,<180 clip values>]

The clip values are left out when the wrist was quiet (no gesture). The JVM test
MotionClipParityTest checks that the watch code gives the same numbers.

Re-run after changing the recipe (and port the change to Kotlin):

    python ML/dump_reference_clips.py
    .\\gradlew.bat :wear:testDebugUnitTest
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blueprint_reference as B  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = PROJECT_ROOT / "wear" / "src" / "test" / "resources" / "reference_clips.csv"


def reference_line(path):
    _, events = B.read_gyro_events(path)
    gyro = B.resample(events)
    peak_index, peak_level = B.find_action(B.motion_level(gyro))
    cells = [path.relative_to(PROJECT_ROOT).as_posix(), str(peak_index), repr(float(peak_level))]
    if peak_level >= B.THRESHOLD:
        clip = B.crop(gyro, peak_index)
        for axis in range(3):
            for i in range(B.CLIP_LEN):
                cells.append(repr(float(clip[axis, i])))
    return ",".join(cells)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--every", type=int, default=5, help="use every Nth training CSV (default: 5)")
    args = parser.parse_args()

    training = sorted((PROJECT_ROOT / "recordings" / "GestureDataRecorder").glob("*.csv"))[:: args.every]
    watch = sorted((PROJECT_ROOT / "classify_logs").glob("0*.csv"))[::4]  # includes still-arm windows
    lines = [reference_line(path) for path in training + watch]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    quiet = sum(1 for line in lines if line.count(",") == 2)
    print(f"Wrote {len(lines)} reference clips ({quiet} quiet) to {args.output}")


if __name__ == "__main__":
    main()
