"""Reference implementation of the Tactura v2 gesture recipe ("blueprints").

This file is the source of truth. The watch code (MotionClip.kt and
GestureBlueprints.kt) is meant to be a line-by-line port of it, guarded by a
parity test, the same way GestureFeatures.kt mirrors recording_features().
Change the recipe here first, then port the change.

The recipe, in the order the functions appear:

  0. resample        put the gyroscope readings on an even 50-per-second grid
  1. motion_level    one number per reading: how hard is the wrist turning
  2. find_action     where the motion level peaks, and is that loud enough
     find_humps      every stroke nearly as loud as the peak (usually just one)
  3. crop            1.2 s of gyro centred on a stroke, called a "clip"
  4. build_blueprint average a few clips of one gesture into a blueprint,
                     and learn the main ways the reps differ (eigengestures)
  5. distance        how much a clip and a blueprint disagree (rad/s)
     eigen_distance  the same, after forgiving the user's usual variation
  6. classify        closest blueprint, or None when nothing is close
     classify_clips  the same, trying the clip of every strong stroke
     classify_versions  the same, when a gesture has several blueprints

Only the gyroscope is used. The accelerometer measures gravity, so it records
the resting angle of the arm, and the first model learned that angle instead
of the gesture.

The code favours plain loops over numpy tricks on purpose: every loop here has
to be written again in Kotlin, and the two must give the same numbers.
"""

import csv
import math
from dataclasses import dataclass, field
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
HUMP_SHARE = 0.6                  # a stroke is "strong" when it reaches 60% of the peak
HUMP_GAP = 8                      # readings; strokes closer than this (160 ms) count as one
MAX_HUMPS = 3                     # try at most this many strokes per window
EIGEN_DIRECTIONS = 2              # eigengestures kept per blueprint (0 turns them off)
EIGEN_CAP = 1.5                   # forgive up to this many times the spread seen in calibration
EIGEN_FLOOR = 1e-9                # a direction holding less than this share of the variation is noise
JACOBI_SWEEPS = 30                # passes of the eigenvalue solver; a 5 by 5 table settles in under 10
LIMIT_PERCENT = 0.9               # "close enough" = within 90% of the blueprint's own size
MIN_STRENGTH = 0.6                # "strong enough" = at least 60% of the blueprint's own size (only for clips that needed forgiving)

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


def find_humps(level):
    """Return the readings where a strong stroke peaks, loudest first.

    The first entry is always the peak that find_action returns. Another reading
    joins the list when it is the highest within HUMP_GAP readings on either
    side (the earlier reading wins a tie) and reaches at least HUMP_SHARE of the
    peak. At most MAX_HUMPS are returned.

    Why this exists: a clip centred on the single loudest reading works when a
    gesture has one dominant stroke (a twist, a flick). A gesture with two
    strokes of about the same strength (a shake: left, then right) makes "the
    loudest" a coin flip, and the clip lands a third of a second apart from one
    rep to the next. Instead of guessing, the recipe cuts one clip per strong
    stroke and lets the blueprints decide which one fits (classify_clips).
    """
    count = len(level)
    if count == 0:
        return []
    _, peak_level = find_action(level)
    cutoff = HUMP_SHARE * peak_level
    humps = []
    for t in range(count):
        value = float(level[t])
        if value < cutoff:
            continue
        highest = True
        for k in range(max(0, t - HUMP_GAP), min(count, t + HUMP_GAP + 1)):
            other = float(level[k])
            if k < t and other >= value:
                highest = False
            if k > t and other > value:
                highest = False
        if highest:
            humps.append(t)
    humps.sort(key=lambda t: (-float(level[t]), t))  # loudest first, earlier wins a tie
    return humps[:MAX_HUMPS]


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


def extract_clips(events):
    """Steps 0 to 3, with one clip for every strong stroke.

    Returns (clips, peak_level). clips is a list, loudest stroke first, so
    clips[0] is the clip extract_clip returns. The list is empty when there is
    too little data or the wrist stayed quiet.
    """
    gyro = resample(events)
    if gyro.shape[1] < 2:
        return [], 0.0
    level = motion_level(gyro)
    _, peak_level = find_action(level)
    if peak_level < THRESHOLD:
        return [], peak_level
    return [crop(gyro, t) for t in find_humps(level)], peak_level


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
    size: float        # rad/s: how big the gesture is (RMS of the mean)
    directions: list = field(default_factory=list)  # eigengestures: arrays shaped like mean, each of length 1
    spreads: list = field(default_factory=list)     # how far the reps typically sit along each direction


def blueprint_size(mean):
    """How big a gesture is: the root of the mean square of its typical clip, in rad/s."""
    total = 0.0
    for axis in range(mean.shape[0]):
        for i in range(mean.shape[1]):
            total += mean[axis, i] * mean[axis, i]
    return math.sqrt(total / (mean.shape[0] * mean.shape[1]))


def _average(clips):
    total = np.zeros_like(clips[0])
    for clip in clips:
        total = total + clip
    return total / len(clips)


def _jacobi(table):
    """Eigenvalues and eigenvectors of a small symmetric table (cyclic Jacobi).

    table is a list of n lists of n floats. Returns (values, vectors): values[i]
    is an eigenvalue and column i of vectors (vectors[k][i] for k in range(n))
    is its eigenvector. They are not sorted.

    The method zeroes one off-diagonal entry at a time by rotating two rows and
    two columns. It only adds, multiplies, divides and takes square roots, so
    the Kotlin port gives the same numbers.
    """
    n = len(table)
    a = [list(row) for row in table]
    v = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    for _ in range(JACOBI_SWEEPS):
        for p in range(n - 1):
            for q in range(p + 1, n):
                if a[p][q] == 0.0:
                    continue
                theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q])
                t = (1.0 if theta >= 0.0 else -1.0) / (abs(theta) + math.sqrt(theta * theta + 1.0))
                c = 1.0 / math.sqrt(t * t + 1.0)
                s = t * c
                for k in range(n):  # columns p and q
                    akp = a[k][p]
                    akq = a[k][q]
                    a[k][p] = c * akp - s * akq
                    a[k][q] = s * akp + c * akq
                for k in range(n):  # rows p and q
                    apk = a[p][k]
                    aqk = a[q][k]
                    a[p][k] = c * apk - s * aqk
                    a[q][k] = s * apk + c * aqk
                for k in range(n):
                    vkp = v[k][p]
                    vkq = v[k][q]
                    v[k][p] = c * vkp - s * vkq
                    v[k][q] = s * vkp + c * vkq
    return [a[i][i] for i in range(n)], v


def eigengestures(aligned, mean):
    """Step 7. The main ways the reps of one gesture differ from their average.

    aligned holds the reps after lining up, mean is their average. Returns
    (directions, spreads). Each direction is an array shaped like mean with
    length 1: a pattern that, added to or taken from the blueprint, turns it
    into one of the user's usual versions of the gesture. The matching spread
    is how far the reps typically sit along that pattern.

    The directions are the top eigenvectors of the covariance of the reps.
    With n reps there are at most n - 1 of them, so the eigenvalues are taken
    from the small n by n table of dot products between reps instead of a 180
    by 180 one. Up to EIGEN_DIRECTIONS are kept. Fewer than 3 reps give none.
    """
    n = len(aligned)
    if EIGEN_DIRECTIONS <= 0 or n < 3:
        return [], []
    deviations = [clip - mean for clip in aligned]
    axes, length = mean.shape
    gram = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            total = 0.0
            for axis in range(axes):
                for k in range(length):
                    total += float(deviations[i][axis, k]) * float(deviations[j][axis, k])
            gram[i][j] = total
    trace = 0.0
    for i in range(n):
        trace += gram[i][i]
    values, vectors = _jacobi(gram)
    order = sorted(range(n), key=lambda index: (-values[index], index))  # biggest first
    directions = []
    spreads = []
    for index in order:
        if len(directions) == EIGEN_DIRECTIONS:
            break
        value = values[index]
        if value <= EIGEN_FLOOR * trace:
            break
        scale = math.sqrt(value)
        direction = np.zeros_like(mean)
        for rep in range(n):
            direction = direction + vectors[rep][index] * deviations[rep]
        directions.append(direction / scale)
        spreads.append(math.sqrt(value / n))
    return directions, spreads


def build_blueprint(clips):
    """Average a few clips of the same gesture, and learn how they differ.

    Each clip is first slid to line up with the others: start from the first
    clip, line everything up with it, average, then line up with that average
    and average again. The lined-up clips also give the eigengestures.
    """
    reference = clips[0]
    for _ in range(2):
        aligned = [shifted(clip, distance(clip, reference)[1]) for clip in clips]
        reference = _average(aligned)
    directions, spreads = eigengestures(aligned, reference)
    return Blueprint(mean=reference, count=len(clips), size=blueprint_size(reference),
                     directions=directions, spreads=spreads)


def eigen_distance(clip, blueprint):
    """How much a clip and a blueprint disagree, after forgiving the user's usual variation.

    First line the clip up with the blueprint the plain way (distance). Then
    look at what is left over, clip minus mean, and ask how much of it follows
    each eigengesture. That part is removed, but only up to EIGEN_CAP times the
    spread seen in calibration, so a movement far outside the user's habits
    still counts as different. Returns (distance, shift) like distance.

    A blueprint with no directions gives exactly the plain distance.
    """
    best, shift = distance(clip, blueprint.mean)
    if not blueprint.directions:
        return best, shift
    moved = shifted(clip, shift)
    mean = blueprint.mean
    axes, length = mean.shape
    removed = []
    for index, direction in enumerate(blueprint.directions):
        amount = 0.0
        for axis in range(axes):
            for i in range(length):
                amount += (moved[axis, i] - mean[axis, i]) * direction[axis, i]
        limit = EIGEN_CAP * blueprint.spreads[index]
        removed.append(min(max(amount, -limit), limit))
    total = 0.0
    for axis in range(axes):
        for i in range(length):
            left = moved[axis, i] - mean[axis, i]
            for index, direction in enumerate(blueprint.directions):
                left -= removed[index] * direction[axis, i]
            total += left * left
    return math.sqrt(total / (axes * length)), shift


def update_blueprint(blueprint, clip):
    """Fold one more confirmed rep into a blueprint (learning over time).

    The eigengestures are carried over unchanged, because they need the reps
    themselves and a blueprint only keeps their average.
    """
    aligned = shifted(clip, distance(clip, blueprint.mean)[1])
    count = blueprint.count + 1
    mean = blueprint.mean + (aligned - blueprint.mean) / count
    return Blueprint(mean=mean, count=count, size=blueprint_size(mean),
                     directions=blueprint.directions, spreads=blueprint.spreads)


def worst_rep(clips):
    """Calibration check: which rep looks least like the others?

    For each rep, build a blueprint from the other reps and measure how far the
    rep misses it, as a fraction of that blueprint's size. Returns (index, miss)
    for the rep with the largest miss; the earliest rep wins a tie. A miss above
    LIMIT_PERCENT means that rep would not be recognised from the others, so
    calibration drops it and asks for one more. Needs at least 3 clips.
    """
    worst_index = 0
    worst_miss = -1.0
    for index in range(len(clips)):
        others = [clip for other, clip in enumerate(clips) if other != index]
        blueprint = build_blueprint(others)
        miss = distance(clips[index], blueprint.mean)[0] / blueprint.size
        if miss > worst_miss:
            worst_miss = miss
            worst_index = index
    return worst_index, worst_miss


def choose_clip(clips, earlier):
    """Calibration: which of a rep's clips to keep. Returns its index in clips.

    clips come from extract_clips for the new rep. earlier holds the clips
    already kept for the same gesture. With no earlier reps the first clip is
    kept (the one centred on the loudest stroke). Otherwise the clip closest to
    the blueprint of the earlier reps is kept, so every rep of a two-stroke
    gesture ends up centred on the same stroke. The first clip wins a tie.
    """
    if not earlier or len(clips) == 1:
        return 0
    mean = build_blueprint(earlier).mean
    best_index = 0
    best = float("inf")
    for index, clip in enumerate(clips):
        value = distance(clip, mean)[0]
        if value < best:
            best = value
            best_index = index
    return best_index


# ---- step 6: decide ---------------------------------------------------------

def _passes(clip, blueprint, eigen_miss):
    """The "close enough" and "strong enough" rules for the winning clip and blueprint."""
    limit = LIMIT_PERCENT * blueprint.size
    if eigen_miss > limit:
        return False  # not close enough, even after forgiving the usual variation
    if distance(clip, blueprint.mean)[0] <= limit:
        return True   # close enough the plain way
    return blueprint_size(clip) >= MIN_STRENGTH * blueprint.size  # needed forgiving: must be strong enough


def classify(clip, blueprints, use_limit=True):
    """Pick the closest blueprint.

    blueprints maps a gesture name to a Blueprint. Returns (name, distance).
    name is None when clip is None (quiet wrist), or when use_limit is on and
    the clip misses the closest blueprint by more than LIMIT_PERCENT of that
    blueprint's own size. Measuring the miss against the size of the gesture
    keeps "close" meaning the same thing for a small flick and a big twist.
    The miss is measured with eigen_distance, so the user's usual variation
    does not count against them.

    use_limit also applies the "strong enough" rule. Eigengestures forgive
    part of the gap between a clip and a blueprint, and for a small gesture
    that can include most of the gap to no motion at all, so a faint twitch
    could pass as the smallest gesture. A clip that is close enough only thanks
    to that forgiveness (its plain distance is over the limit) must therefore
    also be at least MIN_STRENGTH of the blueprint's size. A clip that is
    close enough the plain way is accepted whatever its strength, so an honest
    soft rep is not thrown out.

    The limit has to stay below 100%: a clip of almost no motion is exactly
    100% away from every blueprint, so at 100% a faint twitch could pass as
    the smallest gesture.
    """
    if clip is None or not blueprints:
        return None, float("inf")
    best_name = None
    best = float("inf")
    for name in sorted(blueprints):
        value = eigen_distance(clip, blueprints[name])[0]
        if value < best:
            best = value
            best_name = name
    if use_limit and not _passes(clip, blueprints[best_name], best):
        return None, best
    return best_name, best


def classify_clips(clips, blueprints, use_limit=True):
    """Pick the closest blueprint, trying the clip of every strong stroke.

    clips comes from extract_clips. Every clip is compared with every
    blueprint and the single best fit wins. The "close enough" and "strong
    enough" rules are the same as in classify, applied to the winning clip.
    Returns (name, distance); name is None for an empty list
    (quiet wrist), for no blueprints, or when nothing is close enough.

    With one clip this gives exactly what classify gives.
    """
    if not clips or not blueprints:
        return None, float("inf")
    best_name = None
    best_clip = None
    best = float("inf")
    for name in sorted(blueprints):
        for clip in clips:
            value = eigen_distance(clip, blueprints[name])[0]
            if value < best:
                best = value
                best_name = name
                best_clip = clip
    if use_limit and not _passes(best_clip, blueprints[best_name], best):
        return None, best
    return best_name, best


def classify_versions(clips, versions, use_limit=True):
    """Pick the closest blueprint when a gesture may have several of them.

    versions maps a gesture name to a list of Blueprints, oldest first: one for
    each time the user calibrated that gesture. People do not do a small
    gesture the same way from one sitting to the next, so the watch keeps the
    earlier blueprints instead of replacing them.

    Every clip is compared with every blueprint of every gesture, and the
    single best fit decides. The "close enough" and "strong enough" rules are
    then applied to that one blueprint, exactly as in classify_clips. Another
    blueprint of the same gesture is not given a second chance, because that
    let more random movement through in testing.

    Returns (name, distance, index). index is the position of the deciding
    blueprint in its gesture's list, or -1 when there was nothing to compare.
    With one blueprint per gesture this decides exactly like classify_clips.
    """
    best_name = None
    best_clip = None
    best_index = -1
    best = float("inf")
    if clips:
        for name in sorted(versions):
            for index, blueprint in enumerate(versions[name]):
                for clip in clips:
                    value = eigen_distance(clip, blueprint)[0]
                    if value < best:
                        best = value
                        best_name = name
                        best_clip = clip
                        best_index = index
    if best_name is None:
        return None, best, -1
    if use_limit and not _passes(best_clip, versions[best_name][best_index], best):
        return None, best, best_index
    return best_name, best, best_index
