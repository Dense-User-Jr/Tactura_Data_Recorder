"""Reference implementation of the Tactura v2 gesture recipe ("blueprints").

This file is the source of truth. The watch code (MotionClip.kt and
GestureBlueprints.kt) is meant to be a line-by-line port of it, guarded by a
parity test, the same way GestureFeatures.kt mirrors recording_features().
Change the recipe here first, then port the change.

The recipe, in the order the functions appear:

  0. resample        put the gyroscope readings on an even 50-per-second grid
  1. motion_level    one number per reading: how hard is the wrist turning
  2. find_action     where the motion level peaks, and is that loud enough
  3. crop            1.2 s of gyro centred on the peak, called a "clip"
  4. build_blueprint average a few clips of one gesture into a blueprint
  5. distance        how much a clip and a blueprint disagree (rad/s)
  6. classify        closest blueprint, or None when nothing is close

Only the gyroscope is used. The accelerometer measures gravity, so it records
the resting angle of the arm, and the first model learned that angle instead
of the gesture.

The code favours plain loops over numpy tricks on purpose: every loop here has
to be written again in Kotlin, and the two must give the same numbers.
"""

import csv
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# ---- settings (see "Settings we tested with" in the v2 plan) ----------------

RATE_HZ = 50                      # readings per second on the even grid
STEP_NS = 1_000_000_000 // RATE_HZ  # 20 ms between grid points
SMOOTH = 7                        # motion level averages 7 readings (140 ms)
THRESHOLD = 1.0                   # rad/s; below this the wrist is "quiet"
HALF = 30                         # readings kept on each side of the peak
CLIP_LEN = 2 * HALF               # 60 readings = 1.2 s
SLIDE = 5                         # try shifts of -5..+5 readings (100 ms)
LIMIT_FACTOR = 2.0                # "close enough" = this x worst calibration rep
MIN_LIMIT = 1.0                   # rad/s; a blueprint is never stricter than this

GYRO = "gyroscope"


# ---- reading a recorder CSV -------------------------------------------------

def read_gyro_events(csv_path):
    """Return (label, events) for one recorder CSV.

    events is a list of (timestamp_ns, gx, gy, gz) for the gyroscope rows, in
    file order. label is the text in the gesture_label column. For files saved
    by Classify mode that column holds the watch's guess, not the truth.
    """
    label = ""
    events = []
    with Path(csv_path).open("r", newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row.get("gesture_label") == "gesture_label":
                continue  # a repeated header inside the file
            label = (row.get("gesture_label") or "").strip().upper()
            if (row.get("source_sensor") or "").strip().lower() != GYRO:
                continue
            events.append((
                int(row["sensor_timestamp_ns"]),
                float(row["gyro_x"]),
                float(row["gyro_y"]),
                float(row["gyro_z"]),
            ))
    return label, events


# ---- step 0: an even grid ---------------------------------------------------

def resample(events):
    """Put gyro events on an even 50 Hz grid by straight-line interpolation.

    The watch delivers readings at slightly uneven times. Everything after this
    function assumes readings are exactly 20 ms apart.

    Returns an array of shape (3, N): one row per axis. N is 0 when there are
    fewer than two usable events.
    """
    ordered = sorted(events, key=lambda event: event[0])  # stable, by time
    times = []
    values = []
    for timestamp, gx, gy, gz in ordered:
        if times and timestamp <= times[-1]:
            continue  # same instant twice: keep the first
        times.append(timestamp)
        values.append((gx, gy, gz))
    if len(times) < 2:
        return np.zeros((3, 0))

    start = times[0]
    count = (times[-1] - start) // STEP_NS + 1
    grid = np.zeros((3, count))
    right = 1  # index of the first event at or after the grid time
    for k in range(count):
        t = start + k * STEP_NS
        while times[right] < t:
            right += 1
        left = right - 1
        fraction = (t - times[left]) / (times[right] - times[left])
        for axis in range(3):
            a = values[left][axis]
            b = values[right][axis]
            grid[axis, k] = a + fraction * (b - a)
    return grid


# ---- step 1: motion level ---------------------------------------------------

def motion_level(gyro):
    """How hard the wrist is turning at each reading, in rad/s.

    Square the three axes, add them, average over SMOOTH readings centred on
    the current one, take the square root. Readings past either end count as
    zero, so the level tapers at the edges of the window.
    """
    count = gyro.shape[1]
    energy = [0.0] * count
    for t in range(count):
        x = float(gyro[0, t])
        y = float(gyro[1, t])
        z = float(gyro[2, t])
        energy[t] = x * x + y * y + z * z
    reach = SMOOTH // 2
    level = np.zeros(count)
    for t in range(count):
        total = 0.0
        for k in range(t - reach, t + reach + 1):
            if 0 <= k < count:
                total += energy[k]
        level[t] = math.sqrt(total / SMOOTH)
    return level


# ---- step 2: find the action ------------------------------------------------

def find_action(level):
    """Return (peak_index, peak_level). The first reading wins a tie."""
    peak_index = 0
    peak_level = -1.0
    for t in range(len(level)):
        if level[t] > peak_level:
            peak_level = float(level[t])
            peak_index = t
    return peak_index, peak_level


# ---- step 3: crop -----------------------------------------------------------

def crop(gyro, peak_index):
    """Cut CLIP_LEN readings centred on the peak. Shape (3, CLIP_LEN).

    If the peak is near an edge of the window, the missing readings repeat the
    edge value.
    """
    last = gyro.shape[1] - 1
    clip = np.zeros((3, CLIP_LEN))
    for i in range(CLIP_LEN):
        source = min(max(peak_index - HALF + i, 0), last)
        for axis in range(3):
            clip[axis, i] = gyro[axis, source]
    return clip


def extract_clip(events):
    """Steps 0 to 3 in one call.

    Returns (clip, peak_level). clip is None when there is too little data or
    the wrist never turned harder than THRESHOLD, which means "no gesture".
    """
    gyro = resample(events)
    if gyro.shape[1] < 2:
        return None, 0.0
    peak_index, peak_level = find_action(motion_level(gyro))
    if peak_level < THRESHOLD:
        return None, peak_level
    return crop(gyro, peak_index), peak_level


# ---- step 5: distance (used by step 4, so it comes first) -------------------

def shifted(clip, shift):
    """The clip moved later by `shift` readings (earlier when negative).

    Readings that slide in from outside repeat the edge value.
    """
    last = clip.shape[1] - 1
    out = np.zeros_like(clip)
    for i in range(clip.shape[1]):
        source = min(max(i - shift, 0), last)
        for axis in range(3):
            out[axis, i] = clip[axis, source]
    return out


def rms_difference(a, b):
    """Root of the mean squared difference over all 180 numbers, in rad/s."""
    total = 0.0
    for axis in range(a.shape[0]):
        for i in range(a.shape[1]):
            difference = a[axis, i] - b[axis, i]
            total += difference * difference
    return math.sqrt(total / (a.shape[0] * a.shape[1]))


def distance(clip, mean):
    """Smallest RMS difference over shifts of -SLIDE..+SLIDE readings.

    Returns (distance, shift). The earliest shift wins a tie.
    """
    best = float("inf")
    best_shift = 0
    for shift in range(-SLIDE, SLIDE + 1):
        value = rms_difference(shifted(clip, shift), mean)
        if value < best:
            best = value
            best_shift = shift
    return best, best_shift


# ---- step 4: blueprint ------------------------------------------------------

@dataclass
class Blueprint:
    mean: np.ndarray   # shape (3, CLIP_LEN): the typical clip
    count: int         # how many reps went into the mean
    limit: float       # rad/s: a clip farther than this is "not this gesture"


def _average(clips):
    total = np.zeros_like(clips[0])
    for clip in clips:
        total = total + clip
    return total / len(clips)


def build_blueprint(clips):
    """Average a few clips of the same gesture.

    Each clip is first slid to line up with the others: start from the first
    clip, line everything up with it, average, then line up with that average
    and average again.
    """
    reference = clips[0]
    for _ in range(2):
        aligned = [shifted(clip, distance(clip, reference)[1]) for clip in clips]
        reference = _average(aligned)
    worst = 0.0
    for clip in clips:
        worst = max(worst, distance(clip, reference)[0])
    return Blueprint(mean=reference, count=len(clips), limit=max(LIMIT_FACTOR * worst, MIN_LIMIT))


def update_blueprint(blueprint, clip):
    """Fold one more confirmed rep into a blueprint (learning over time)."""
    aligned = shifted(clip, distance(clip, blueprint.mean)[1])
    count = blueprint.count + 1
    mean = blueprint.mean + (aligned - blueprint.mean) / count
    return Blueprint(mean=mean, count=count, limit=blueprint.limit)


# ---- step 6: decide ---------------------------------------------------------

def classify(clip, blueprints, use_limit=True):
    """Pick the closest blueprint.

    blueprints maps a gesture name to a Blueprint. Returns (name, distance).
    name is None when clip is None (quiet wrist), or when use_limit is on and
    the closest blueprint is farther away than its own limit.
    """
    if clip is None or not blueprints:
        return None, float("inf")
    best_name = None
    best = float("inf")
    for name in sorted(blueprints):
        value = distance(clip, blueprints[name].mean)[0]
        if value < best:
            best = value
            best_name = name
    if use_limit and best > blueprints[best_name].limit:
        return None, best
    return best_name, best
