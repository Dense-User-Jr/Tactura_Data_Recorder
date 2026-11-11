"""Write reference values for the Kotlin parity test of GestureBlueprints.kt.

Runs steps 4 to 6 of ML/blueprint_reference.py (blueprint, distance, decide) and
the "learning over time" update on real recordings, and writes
wear/src/test/resources/reference_blueprints.csv with four kinds of line:

    F,<gesture>,<file>;<file>;...                   the reps each blueprint is built from
    B,<gesture>,<count>,<size>,<180 mean values>    the blueprint Python built from them
    T,<file>,<gesture or NONE>,<distance>           what Python decided for a test file
    U,<gesture>,<file>,<count>,<size>,<180 values>  the blueprint after folding in one more rep

The JVM test GestureBlueprintsParityTest rebuilds everything from the same files
with the watch code and checks the numbers agree.

Re-run after changing the recipe (and port the change to Kotlin):

    python ML/dump_reference_blueprints.py
    .\\gradlew.bat :wear:testDebugUnitTest
"""

import argparse
import csv
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blueprint_reference as B  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = PROJECT_ROOT / "wear" / "src" / "test" / "resources" / "reference_blueprints.csv"
REPS = 5


def number(value):
    if math.isinf(value):
        return "Infinity"  # the spelling Kotlin's toDouble() understands
    return repr(float(value))


def flat(mean):
    return [number(mean[axis, i]) for axis in range(3) for i in range(B.CLIP_LEN)]


def relative(path):
    return path.relative_to(PROJECT_ROOT).as_posix()


def clip_of(path):
    _, events = B.read_gyro_events(path)
    return B.extract_clip(events)[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    # Blueprints come from the first REPS training recordings of each gesture, in file-name order.
    by_gesture = defaultdict(list)
    for path in sorted((PROJECT_ROOT / "recordings" / "GestureDataRecorder").glob("*.csv")):
        label, _ = B.read_gyro_events(path)
        by_gesture[label].append(path)

    lines = []
    blueprints = {}
    for gesture in sorted(by_gesture):
        reps = by_gesture[gesture][:REPS]
        blueprints[gesture] = B.build_blueprint([clip_of(path) for path in reps])
        lines.append(",".join(["F", gesture, ";".join(relative(path) for path in reps)]))
    for gesture in sorted(blueprints):
        made = blueprints[gesture]
        lines.append(",".join(["B", gesture, str(made.count), number(made.size)] + flat(made.mean)))

    # Test files: later training recordings, plus every labeled watch-test window (still arm included).
    tests = []
    for gesture in sorted(by_gesture):
        tests += by_gesture[gesture][REPS::9]
    with (PROJECT_ROOT / "classify_logs" / "labels.csv").open("r", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["truth"].strip():
                tests.append(PROJECT_ROOT / "classify_logs" / row["file"])
    decided = defaultdict(int)
    for path in tests:
        name, value = B.classify(clip_of(path), blueprints, use_limit=True)
        decided[name or "NONE"] += 1
        lines.append(",".join(["T", relative(path), name or "NONE", number(value)]))

    # Learning over time: fold the sixth recording of each gesture into its blueprint.
    for gesture in sorted(by_gesture):
        extra = by_gesture[gesture][REPS]
        updated = B.update_blueprint(blueprints[gesture], clip_of(extra))
        lines.append(",".join(["U", gesture, relative(extra), str(updated.count), number(updated.size)] + flat(updated.mean)))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(blueprints)} blueprints, {len(tests)} decisions {dict(decided)} and "
          f"{len(by_gesture)} updates to {args.output}")


if __name__ == "__main__":
    main()
