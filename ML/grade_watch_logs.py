#!/usr/bin/env python3
"""Grade what the watch answered against what was really done.

Run from the repository root:

    python ML/grade_watch_logs.py                      every answer key under data/
    python ML/grade_watch_logs.py data/raghav          one person's answer keys
    python ML/grade_watch_logs.py data/russell/classify/labels_20261115.csv
    python ML/grade_watch_logs.py --round "8 PM"       only rounds whose name contains this

Each Classify window the watch saves is named after its answer:
0123_classify_pred-flick_up-55_20261115_201001.csv means "Flick Up, 55% shown on
the watch", and pred-none-0 means "no gesture". An answer key is a labels*.csv
file next to the windows, with one row per window:

    file,truth,round,note

truth is a gesture name, STILL (the arm did not move) or NOTHING (the arm moved,
but not as a gesture, like a hair scratch). STILL and NOTHING should get no
gesture. Rows with an empty truth are left out. round groups the windows into the
rounds that are scored together.

For each round it prints a Markdown table, ready to paste into a doc: how many
real gestures were named right, ignored, or given a wrong name, and how many of
the windows that should get no gesture were named anyway (false alarms).

This grades what the watch said at the time. It does not rerun the recipe, so a
change to the code or the settings does not change these numbers. Use it for
on-watch tests, such as the locked test, where the watch's answers are the result.
"""

import argparse
import csv
import re
import sys
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
NO_GESTURE = ("STILL", "NOTHING")
ANSWER = re.compile(r"_classify_pred-([a-z_]+)-(\d+)_")
DISPLAY = {"STILL": "Still arm", "NOTHING": "Movement that is not a gesture", "NONE": "no gesture"}


def display(label):
    """FLICK_UP -> Flick Up."""
    return DISPLAY.get(label, label.replace("_", " ").title())


def find_keys(paths):
    """Every labels*.csv under the given files or folders."""
    keys = []
    for path in paths:
        path = Path(path)
        if not path.is_absolute():
            path = (Path.cwd() / path) if path.exists() else (PROJECT_ROOT / path)
        if path.is_file():
            keys.append(path)
        elif path.is_dir():
            keys.extend(sorted(path.rglob("labels*.csv")))
        else:
            sys.exit(f"Not found: {path}")
    return keys


def read_key(path):
    """The scored Classify windows of one answer key: (round, truth, watch answer, percent) in file order."""
    windows = []
    with path.open("r", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            truth = (row.get("truth") or "").strip().upper()
            match = ANSWER.search(row["file"])
            if not truth or match is None:
                continue  # not written down, or not a Classify window (Record-mode files have no answer)
            if not (path.parent / row["file"]).exists():
                print(f"warning: {row['file']} is in {path.name} but not in the folder", file=sys.stderr)
            round_name = (row.get("round") or "").strip() or "(no round name)"
            windows.append((round_name, truth, match.group(1).upper(), int(match.group(2))))
    return windows


def percent_range(values):
    if not values:
        return ""
    low, high = min(values), max(values)
    return f"{low}%" if low == high else f"{low} to {high}%"


def counted(counter):
    """Counter({'TWIST_LEFT': 2}) -> '2 (Twist Left 2)'."""
    total = sum(counter.values())
    if not total:
        return "0"
    return f"{total} (" + ", ".join(f"{display(name)} {count}" for name, count in counter.most_common()) + ")"


def grade_round(windows):
    """Markdown lines for one round, and its totals (right, real, false alarms, should be ignored)."""
    real = {}      # truth -> [right, ignored, Counter of wrong names, percents shown when right]
    negative = {}  # STILL or NOTHING -> [ignored, Counter of names given]
    for _, truth, answer, shown in windows:
        if truth in NO_GESTURE:
            entry = negative.setdefault(truth, [0, Counter()])
            if answer == "NONE":
                entry[0] += 1
            else:
                entry[1][answer] += 1
        else:
            entry = real.setdefault(truth, [0, 0, Counter(), []])
            if answer == truth:
                entry[0] += 1
                entry[3].append(shown)
            elif answer == "NONE":
                entry[1] += 1
            else:
                entry[2][answer] += 1

    lines = []
    right_total = real_total = ignored_total = wrong_total = 0
    if real:
        lines += ["| Gesture | Right | Ignored | Wrong name | % shown when right |", "| --- | --- | --- | --- | --- |"]
        for truth, (right, ignored, wrong, shown) in real.items():
            total = right + ignored + sum(wrong.values())
            lines.append(f"| {display(truth)} | {right} of {total} | {ignored} | {counted(wrong)} | {percent_range(shown)} |")
            right_total += right
            real_total += total
            ignored_total += ignored
            wrong_total += sum(wrong.values())
        share = round(100 * right_total / real_total)
        lines.append(f"| **All real gestures** | **{right_total} of {real_total} ({share}%)** | **{ignored_total}** | **{wrong_total}** | |")
    alarms = should_ignore = 0
    if negative:
        if lines:
            lines.append("")
        lines += ["| Should get no gesture | Ignored | Named anyway |", "| --- | --- | --- |"]
        for truth, (ignored, named) in negative.items():
            total = ignored + sum(named.values())
            lines.append(f"| {display(truth)} | {ignored} of {total} | {counted(named)} |")
            alarms += sum(named.values())
            should_ignore += total
    return lines, (right_total, real_total, alarms, should_ignore)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="*", default=["data"], help="answer keys, or folders to search (default: data)")
    parser.add_argument("--round", default="", help="only rounds whose name contains this text")
    args = parser.parse_args()

    keys = find_keys(args.paths)
    graded = 0
    for key in keys:
        windows = [w for w in read_key(key) if args.round.lower() in w[0].lower()]
        if not windows:
            continue
        try:
            shown_path = key.relative_to(PROJECT_ROOT).as_posix()
        except ValueError:
            shown_path = key.as_posix()
        print(f"## {shown_path}\n")
        rounds = {}
        for window in windows:
            rounds.setdefault(window[0], []).append(window)
        totals = [0, 0, 0, 0]
        for name, members in rounds.items():
            lines, (right, real, alarms, should_ignore) = grade_round(members)
            print(f"### {name}\n")
            print("\n".join(lines) + "\n")
            totals = [totals[0] + right, totals[1] + real, totals[2] + alarms, totals[3] + should_ignore]
        if len(rounds) > 1:
            summary = f"All rounds: {totals[0]} of {totals[1]} real gestures right"
            if totals[3]:
                summary += f", {totals[2]} false alarms in {totals[3]} windows that should get no gesture"
            print(summary + ".\n")
        graded += 1
    if not graded:
        sys.exit("No graded Classify windows found. Answer keys are labels*.csv files next to the windows.")


if __name__ == "__main__":
    main()
