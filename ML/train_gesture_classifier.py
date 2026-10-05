"""Train a random-forest gesture classifier from Gesture Data Recorder CSVs.

Install dependencies with ``python -m pip install -r ML/requirements.txt`` and
run from the repository root with ``python ML/train_gesture_classifier.py``.
Each CSV (or repeated-header section) is treated as one labeled recording.
"""

import argparse
import csv
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = PROJECT_ROOT / "recordings" / "GestureDataRecorder"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "gesture_random_forest.joblib"
SUPPORTED_LABELS = (
    "FLICK_UP",
    "FLICK_DOWN",
    "TWIST_RIGHT",
    "TWIST_LEFT",
    "SHAKE",
    "DOUBLE_TAP",
)
SENSOR_COLUMNS = {
    "accelerometer": ("accel_x", "accel_y", "accel_z"),
    "gyroscope": ("gyro_x", "gyro_y", "gyro_z"),
}


def read_recording_sections(csv_path):
    """Return one row-list per CSV section, splitting repeated headers."""
    sections = []
    current_rows = []
    header = None

    with csv_path.open("r", newline="", encoding="utf-8-sig") as csv_file:
        for values in csv.reader(csv_file):
            if not values:
                continue
            if values[0] == "gesture_label":
                if current_rows:
                    sections.append(current_rows)
                header = values
                current_rows = []
                continue
            if header is not None and len(values) == len(header):
                current_rows.append(dict(zip(header, values)))

    if current_rows:
        sections.append(current_rows)
    return sections


def _event_time_ms(row):
    timestamp_ns = row.get("sensor_timestamp_ns", "").strip()
    if timestamp_ns:
        return int(timestamp_ns) / 1_000_000
    return float(row["elapsed_ms"])


def _resample_channel(samples, start_ms, duration_ms, grid):
    samples.sort(key=lambda sample: sample[0])
    times = np.asarray([sample[0] for sample in samples], dtype=np.float64)
    values = np.asarray([sample[1] for sample in samples], dtype=np.float64)
    times -= start_ms

    unique_times, inverse = np.unique(times, return_inverse=True)
    if len(unique_times) != len(times):
        sums = np.bincount(inverse, weights=values)
        counts = np.bincount(inverse)
        values = sums / counts
        times = unique_times

    normalized_times = times / duration_ms if duration_ms > 0 else np.zeros_like(times)
    return np.interp(grid, normalized_times, values)


def recording_features(rows, bins, source):
    labels = {row.get("gesture_label", "").strip().upper() for row in rows}
    labels.discard("")
    if len(labels) != 1:
        raise ValueError(f"{source}: expected exactly one gesture label, found {sorted(labels)}")
    label = labels.pop()
    if label not in SUPPORTED_LABELS:
        raise ValueError(f"{source}: unsupported gesture label {label!r}")

    streams = {sensor: {column: [] for column in columns}
               for sensor, columns in SENSOR_COLUMNS.items()}
    event_times = []
    for row in rows:
        sensor = row.get("source_sensor", "").strip().lower()
        if sensor not in streams:
            continue
        event_time = _event_time_ms(row)
        event_times.append(event_time)
        for column in SENSOR_COLUMNS[sensor]:
            value = float(row[column])
            if not np.isfinite(value):
                raise ValueError(f"{source}: non-finite value in {column}")
            streams[sensor][column].append((event_time, value))

    if not event_times or any(not samples for sensor in streams.values() for samples in sensor.values()):
        raise ValueError(f"{source}: recording must contain both accelerometer and gyroscope samples")

    start_ms = min(event_times)
    duration_ms = max(event_times) - start_ms
    grid = np.linspace(0.0, 1.0, bins)
    features = []
    for sensor, columns in SENSOR_COLUMNS.items():
        for column in columns:
            features.extend(_resample_channel(streams[sensor][column], start_ms, duration_ms, grid))
    return label, np.asarray(features, dtype=np.float32)


def collect_recordings(input_dir, bins):
    paths = sorted(input_dir.rglob("*.csv"))
    if not paths:
        raise ValueError(f"No CSV recordings found under {input_dir}")

    feature_rows = []
    labels = []
    for path in paths:
        sections = read_recording_sections(path)
        for section_index, rows in enumerate(sections, start=1):
            source = path.relative_to(input_dir).as_posix()
            if len(sections) > 1:
                source += f" (section {section_index})"
            label, features = recording_features(rows, bins, source)
            labels.append(label)
            feature_rows.append(features)

    if len(set(labels)) < 2:
        raise ValueError("At least two different gesture labels are required to train a classifier")
    return np.vstack(feature_rows), np.asarray(labels), paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                        help=f"recordings directory (default: {DEFAULT_INPUT})")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help=f"model output path (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--bins", type=int, default=32,
                        help="time bins per sensor channel (default: 32)")
    parser.add_argument("--trees", type=int, default=500,
                        help="number of trees in the forest (default: 500)")
    args = parser.parse_args()

    if args.bins < 2:
        parser.error("--bins must be at least 2")
    if args.trees < 1:
        parser.error("--trees must be positive")
    if not args.input.is_dir():
        parser.error(f"recordings directory does not exist: {args.input}")

    features, labels, paths = collect_recordings(args.input, args.bins)
    counts = Counter(labels)
    missing = [label for label in SUPPORTED_LABELS if label not in counts]
    classifier = RandomForestClassifier(
        n_estimators=args.trees,
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=-1,
    )
    classifier.fit(features, labels)

    feature_names = [
        f"{column}_t{index:02d}"
        for column in ("accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z")
        for index in range(args.bins)
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": classifier,
        "feature_names": feature_names,
        "time_bins": args.bins,
        "supported_labels": list(SUPPORTED_LABELS),
    }, args.output)

    print(f"Trained on {len(labels)} recordings from {len(paths)} CSV files.")
    print(f"Classes in model: {', '.join(classifier.classes_)}")
    print("Recordings per class: " + ", ".join(
        f"{label}={counts.get(label, 0)}" for label in SUPPORTED_LABELS
    ))
    if missing:
        print("Not present in this dataset (collect examples before expecting predictions): "
              + ", ".join(missing))
    print(f"Model saved to {args.output}")


if __name__ == "__main__":
    main()