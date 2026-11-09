"""Write reference features for the Kotlin parity test.

Runs the training script's own ``recording_features()`` on a sample of the CSVs in
``recordings/GestureDataRecorder`` and writes one line per recording,
``<file name>,<192 features>``, to
``wear/src/test/resources/reference_features.csv``. The JVM test
``GestureFeaturesParityTest`` checks that the watch's Kotlin port
(``GestureFeatures.kt``) produces identical values.

Re-run after changing ``recording_features()`` (and port the change to Kotlin):

    python ML/dump_reference_features.py
    .\\gradlew.bat :wear:testDebugUnitTest
"""

import argparse
from pathlib import Path

from train_gesture_classifier import (
    DEFAULT_INPUT,
    PROJECT_ROOT,
    read_recording_sections,
    recording_features,
)

DEFAULT_OUTPUT = PROJECT_ROOT / "wear" / "src" / "test" / "resources" / "reference_features.csv"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--every", type=int, default=5, help="use every Nth CSV (default: 5)")
    args = parser.parse_args()

    paths = sorted(args.input.glob("*.csv"))[:: args.every]
    lines = []
    for path in paths:
        sections = read_recording_sections(path)
        if len(sections) != 1:
            continue  # the Kotlin test parses single-section files only
        _, features = recording_features(sections[0], 32, path.name)
        lines.append(",".join([path.name] + [repr(float(value)) for value in features]))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(lines)} reference vectors to {args.output}")


if __name__ == "__main__":
    main()
