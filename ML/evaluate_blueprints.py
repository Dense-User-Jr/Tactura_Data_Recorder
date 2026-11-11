"""Score the blueprint recipe (ML/blueprint_reference.py) on real recordings.

Run from the repository root:

    python ML/evaluate_blueprints.py

It reads two kinds of data:

  recordings/GestureDataRecorder   Record-mode CSVs. The label column is the truth.
  classify_logs (or --watch-test)  Classify-mode CSVs pulled from a watch, plus a
                                   labels.csv that says what was really done.

and prints five tests. None of them is a shuffled split of everything, because
that kind of test once reported 96% for a model that scored 49% on a real person.

  1. Motion gate        does "is the wrist moving" separate gestures from a still arm
  2. Personal blueprint a few of one person's reps, tested on that person's other reps
  3. Other person       blueprints from one person, tested on the other
  4. Unknown movement   a gesture with no blueprint should be ignored, not misnamed
  5. Per gesture        where the mistakes are
"""

import argparse
import csv
import random
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blueprint_reference as B  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STILL = "STILL"


class Sample:
    def __init__(self, name, truth, events):
        self.name = name
        self.truth = truth
        self.clip, self.peak = B.extract_clip(events)


def load_training(folder):
    """Record-mode CSVs: the gesture_label column is what the person was asked to do."""
    samples = []
    for path in sorted(folder.glob("*.csv")):
        label, events = B.read_gyro_events(path)
        samples.append(Sample(path.name, label, events))
    return samples


def load_watch_test(folder):
    """Classify-mode CSVs: the truth comes from labels.csv, never from the file itself."""
    samples = []
    with (folder / "labels.csv").open("r", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            truth = row["truth"].strip().upper()
            if not truth:
                continue  # practice or unlabeled run
            _, events = B.read_gyro_events(folder / row["file"])
            samples.append(Sample(row["file"], truth, events))
    return samples


def by_gesture(samples):
    groups = defaultdict(list)
    for sample in samples:
        if sample.truth != STILL:
            groups[sample.truth].append(sample)
    return groups


def blueprints_from(groups):
    """groups maps gesture -> list of samples to learn from (quiet ones are skipped)."""
    result = {}
    for gesture, members in groups.items():
        clips = [m.clip for m in members if m.clip is not None]
        if clips:
            result[gesture] = B.build_blueprint(clips)
    return result


def score(blueprints, tests, use_limit):
    """Return (correct, total, ignored). A real gesture that gets ignored counts as wrong."""
    correct = ignored = 0
    for sample in tests:
        name, _ = B.classify(sample.clip, blueprints, use_limit=use_limit)
        if name is None:
            ignored += 1
        elif name == sample.truth:
            correct += 1
    return correct, len(tests), ignored


def percent(part, whole):
    return "n/a" if whole == 0 else f"{100.0 * part / whole:.0f}%"


# ---- the tests --------------------------------------------------------------

def test_motion_gate(title, samples):
    gestures = [s for s in samples if s.truth != STILL]
    still = [s for s in samples if s.truth == STILL]
    print(f"  {title}")
    if gestures:
        missed = sum(1 for s in gestures if s.clip is None)
        print(f"    real gestures: quietest peak {min(s.peak for s in gestures):.2f} rad/s, "
              f"{missed} of {len(gestures)} wrongly treated as quiet")
    if still:
        passed = sum(1 for s in still if s.clip is not None)
        print(f"    still arm:     loudest peak  {max(s.peak for s in still):.2f} rad/s, "
              f"{passed} of {len(still)} wrongly treated as a gesture")


def test_personal(title, samples, reps_options, draws, seed):
    groups = by_gesture(samples)
    print(f"  {title}")
    print("    reps used | closest wins        | with the 'close enough' rule")
    print("              | average  worst draw | correct  real gestures ignored")
    for reps in reps_options:
        if any(len(members) <= reps for members in groups.values()):
            continue
        rng = random.Random(seed)
        plain, strict, dropped = [], [], []
        for _ in range(draws):
            learn, tests = {}, []
            for gesture, members in groups.items():
                chosen = set(rng.sample(range(len(members)), reps))
                learn[gesture] = [m for i, m in enumerate(members) if i in chosen]
                tests += [m for i, m in enumerate(members) if i not in chosen]
            blueprints = blueprints_from(learn)
            correct, total, _ = score(blueprints, tests, use_limit=False)
            plain.append(correct / total)
            correct, total, ignored = score(blueprints, tests, use_limit=True)
            strict.append(correct / total)
            dropped.append(ignored / total)
        mean = lambda values: 100.0 * sum(values) / len(values)
        print(f"    {reps:9d} | {mean(plain):6.0f}%  {100.0 * min(plain):9.0f}% | "
              f"{mean(strict):6.0f}%  {mean(dropped):20.0f}%")


def test_first_reps(title, samples, reps):
    """Learn from each gesture's first reps in recording order, test on the later ones."""
    groups = by_gesture(samples)
    learn = {g: members[:reps] for g, members in groups.items()}
    tests = [m for members in groups.values() for m in members[reps:]]
    correct, total, _ = score(blueprints_from(learn), tests, use_limit=False)
    print(f"  {title}: {correct} of {total} ({percent(correct, total)})")


def test_other_person(title, teacher, student):
    blueprints = blueprints_from(by_gesture(teacher))
    tests = [s for s in student if s.truth != STILL and s.truth in blueprints]
    correct, total, _ = score(blueprints, tests, use_limit=False)
    print(f"  {title}: {correct} of {total} ({percent(correct, total)})")
    per = defaultdict(lambda: [0, 0])
    for sample in tests:
        name, _ = B.classify(sample.clip, blueprints, use_limit=False)
        per[sample.truth][1] += 1
        per[sample.truth][0] += name == sample.truth
    print("    " + ", ".join(f"{g} {c}/{n}" for g, (c, n) in sorted(per.items())))


def test_unknown_movement(title, samples, reps):
    """Remove one gesture's blueprint. Its reps should now be ignored, not misnamed."""
    groups = by_gesture(samples)
    print(f"  {title}")
    for hidden in sorted(groups):
        learn = {g: members[:reps] for g, members in groups.items() if g != hidden}
        blueprints = blueprints_from(learn)
        named = defaultdict(int)
        ignored = 0
        for sample in groups[hidden]:
            name, _ = B.classify(sample.clip, blueprints, use_limit=True)
            if name is None:
                ignored += 1
            else:
                named[name] += 1
        total = len(groups[hidden])
        wrong = ", ".join(f"{n} called {g}" for g, n in sorted(named.items())) or "none misnamed"
        print(f"    {hidden:12s} hidden: {ignored} of {total} ignored ({wrong})")


def test_per_gesture(title, samples, reps, draws, seed):
    groups = by_gesture(samples)
    rng = random.Random(seed)
    right = defaultdict(int)
    seen = defaultdict(int)
    confusions = defaultdict(int)
    for _ in range(draws):
        learn, tests = {}, []
        for gesture, members in groups.items():
            chosen = set(rng.sample(range(len(members)), reps))
            learn[gesture] = [m for i, m in enumerate(members) if i in chosen]
            tests += [m for i, m in enumerate(members) if i not in chosen]
        blueprints = blueprints_from(learn)
        for sample in tests:
            name, _ = B.classify(sample.clip, blueprints, use_limit=False)
            seen[sample.truth] += 1
            if name == sample.truth:
                right[sample.truth] += 1
            else:
                confusions[(sample.truth, name or "nothing")] += 1
    print(f"  {title}")
    for gesture in sorted(seen):
        print(f"    {gesture:12s} {percent(right[gesture], seen[gesture])}")
    worst = sorted(confusions.items(), key=lambda item: -item[1])[:3]
    if worst:
        print("    most common mistakes: " + ", ".join(
            f"{truth} called {name} ({count}x)" for (truth, name), count in worst))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--recordings", type=Path, default=PROJECT_ROOT / "recordings" / "GestureDataRecorder")
    parser.add_argument("--watch-test", type=Path, default=PROJECT_ROOT / "classify_logs")
    parser.add_argument("--draws", type=int, default=20, help="random draws per test (default 20)")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    training = load_training(args.recordings) if args.recordings.is_dir() else []
    watch = load_watch_test(args.watch_test) if (args.watch_test / "labels.csv").is_file() else []
    if not training and not watch:
        parser.error("no data found")

    print(f"Settings: smoothing {B.SMOOTH} readings, threshold {B.THRESHOLD} rad/s, clip {B.CLIP_LEN} readings, "
          f"slide +-{B.SLIDE}, close enough = within {100 * B.LIMIT_PERCENT:.0f}% of the blueprint's size")
    print(f"Data: {len(training)} training recordings, {len(watch)} labeled watch-test windows\n")

    print("1. Motion gate")
    if training:
        test_motion_gate("training recordings", training)
    if watch:
        test_motion_gate("watch test", watch)

    print("\n2. Personal blueprints (learn from a few reps, test on that person's other reps)")
    if watch:
        test_personal("watch test person", watch, (1, 3, 5), args.draws, args.seed)
    if training:
        test_personal("training recordings person", training, (3, 5), max(1, args.draws // 4), args.seed)
        test_first_reps("  same, first 5 reps of each gesture then the 45 recorded later", training, 5)

    if training and watch:
        print("\n3. Other person (no calibration at all)")
        test_other_person("training person's blueprints on the watch-test person", training, watch)
        test_other_person("watch-test person's blueprints on the training person", watch, training)

    print("\n4. Unknown movement (hide one gesture's blueprint, it should be ignored)")
    if watch:
        test_unknown_movement("watch test person, blueprints from first 5 reps", watch, 5)

    print("\n5. Per gesture, personal blueprints from 3 reps")
    if watch:
        test_per_gesture("watch test person", watch, 3, args.draws, args.seed)


if __name__ == "__main__":
    main()
