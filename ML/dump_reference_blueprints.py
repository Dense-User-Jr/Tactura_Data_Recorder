"""Write reference values for the Kotlin parity test of GestureBlueprints.kt.

Runs steps 4 to 6 of ML/blueprint_reference.py (blueprint, distance, decide) and
the "learning over time" update on real recordings, and writes
wear/src/test/resources/reference_blueprints.csv with five kinds of line:

    F,<gesture>,<file>;<file>;...                   the reps each blueprint is built from
    B,<gesture>,<count>,<size>,<180 mean values>    the blueprint Python built from them
    T,<file>,<gesture or NONE>,<distance>           what Python decided for a test file
    U,<gesture>,<file>,<count>,<size>,<180 values>  the blueprint after folding in one more rep
    W,<gesture>,<index>,<miss>                      the rep in the F set least like the others
    M,<file>,<gesture or NONE>,<distance>           the decision when every strong stroke is tried
    C,<gesture>,<file>,<clips>,<index>              which of a rep's clips calibration would keep
    E,<gesture>,<number>,<spread>,<180 values>      one eigengesture of a blueprint (number 0 is the biggest)
    G,<gesture>,<file>;<file>;...                   the reps of a second blueprint of the same gesture
    V,<file>,<gesture or NONE>,<distance>,<index>   the decision with two blueprints per gesture
    N,<gesture>,<file>:<clip>;<file>:<clip>;...     notes on a gesture: movements "the user said were nothing"
    X,<file>,<gesture or NONE>,<1 if a note refused it, else 0>   the V decision again, with those notes

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
NOTES = 4  # files per gesture turned into notes for the X lines


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


def clips_of(path):
    _, events = B.read_gyro_events(path)
    return B.extract_clips(events)[0]


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

    for gesture in sorted(blueprints):
        made = blueprints[gesture]
        for index, direction in enumerate(made.directions):
            lines.append(",".join(["E", gesture, str(index), number(made.spreads[index])] + flat(direction)))

    # Calibration check: the rep in each set that looks least like the others, and by how much.
    for gesture in sorted(by_gesture):
        index, miss = B.worst_rep([clip_of(path) for path in by_gesture[gesture][:REPS]])
        lines.append(",".join(["W", gesture, str(index), number(miss)]))

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

    # The same test files again, trying the clip of every strong stroke.
    several = 0
    for path in tests:
        clips = clips_of(path)
        several += len(clips) > 1
        name, value = B.classify_clips(clips, blueprints, use_limit=True)
        lines.append(",".join(["M", relative(path), name or "NONE", number(value)]))

    # Several blueprints per gesture: the first REPS recordings and the next REPS, as two "sittings".
    versions = {}
    for gesture in sorted(by_gesture):
        second = by_gesture[gesture][REPS:2 * REPS]
        versions[gesture] = [blueprints[gesture], B.build_blueprint([clip_of(path) for path in second])]
        lines.append(",".join(["G", gesture, ";".join(relative(path) for path in second)]))
    later = 0
    named = {}
    for path in tests:
        name, value, index = B.classify_versions(clips_of(path), versions, use_limit=True)
        later += index > 0
        named[path] = name
        lines.append(",".join(["V", relative(path), name or "NONE", number(value), str(index)]))

    # Notes: pretend the first NOTES files named as each gesture were really nothing.
    notes = {}
    for gesture in sorted(versions):
        picked = [path for path in tests if named[path] == gesture][:NOTES]
        spots = [(path, B.nearest_version(clips_of(path), versions)[2]) for path in picked]
        notes[gesture] = [clips_of(path)[spot] for path, spot in spots]
        lines.append(",".join(["N", gesture, ";".join(f"{relative(path)}:{spot}" for path, spot in spots)]))
    refused = 0
    for path in tests:
        name = B.classify_versions(clips_of(path), versions, use_limit=True, notes=notes)[0]
        by_note = named[path] is not None and name is None
        refused += by_note
        lines.append(",".join(["X", relative(path), name or "NONE", "1" if by_note else "0"]))

    # Calibration: for later recordings of each gesture, which clip fits the first REPS reps.
    for gesture in sorted(by_gesture):
        earlier = [clip_of(path) for path in by_gesture[gesture][:REPS]]
        for path in by_gesture[gesture][REPS::9]:
            clips = clips_of(path)
            if clips:
                lines.append(",".join(["C", gesture, relative(path), str(len(clips)), str(B.choose_clip(clips, earlier))]))

    # Learning over time: fold the sixth recording of each gesture into its blueprint.
    for gesture in sorted(by_gesture):
        extra = by_gesture[gesture][REPS]
        updated = B.update_blueprint(blueprints[gesture], clip_of(extra))
        lines.append(",".join(["U", gesture, relative(extra), str(updated.count), number(updated.size)] + flat(updated.mean)))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(blueprints)} blueprints, {len(tests)} decisions {dict(decided)} "
          f"({several} test files have more than one strong stroke, {later} decided by a second blueprint, {refused} refused by a note) and "
          f"{len(by_gesture)} updates to {args.output}")


if __name__ == "__main__":
    main()
