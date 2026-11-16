#!/usr/bin/env python3
"""Feel a shove of the hand in the watch's sensor stream. The source of truth.

A shove is the whole hand moving a few inches up, down, left or right and
coming back, without the wrist turning. The gyro hardly sees it. The
accelerometer does, but it feels gravity too, and gravity swings around in its
readings whenever the wrist tilts. So the steps are:

1. Find a stretch of movement. A reading is "active" when the accelerometer is
   more than ACTIVE_ACCEL away from the average of the MEAN readings before it,
   or the gyro is over ACTIVE_GYRO. A stretch starts at the first active
   reading and ends after QUIET readings in a row that are not. PAD readings
   are kept on each side.
2. Take gravity out. The gyro says how the watch turned since the stretch
   began, so every accelerometer reading is turned back into the frame the
   watch started in, and the resting reading from just before is subtracted.
   What is left is the hand's own acceleration.
3. Add it up into the hand's velocity. The hand goes out and comes back, so
   the velocity is corrected to start and end at zero.
4. The velocity at its first peak is the first push: which way, and how fast.

It is a shove when the first push is clearly along the watch's y or z, fast
enough, and the wrist stayed calm (see `ShoveDetector._judge`). Ordinary arm
movement also pushes the watch sideways a little, so a shove left or right has
to be faster than one up or down.

The watch's axes, worn face up on the left wrist: +z is up out of the screen,
+y is to the wearer's left. The directions were read off Russell's recordings
(docs/gesture-recognition-v2-plan.md). They assume the normal gesture pose.

ShoveDetector.kt on the watch is a line by line copy of the class below, kept
identical by ShoveDetectorParityTest. Only `math` is used here, so the two do
the same arithmetic in the same order.
"""
import csv
import math
from pathlib import Path

# ---- finding a stretch of movement -------------------------------------------
ACTIVE_ACCEL = 0.8     # m/s2 away from the average of the MEAN readings before
ACTIVE_GYRO = 0.6      # rad/s
MEAN = 12              # readings averaged (240 ms at 50 Hz)
QUIET = 12             # a stretch is over after this many calm readings in a row
PAD = 4                # readings kept on each side of a stretch
BASE = 6               # readings before the padding that give the resting value
BEFORE = 15            # readings before the stretch in which the wrist must be calm
MAX_READINGS = 95      # a stretch longer than this is ordinary movement
MAX_GAP_NS = 100_000_000   # a hole this long in the readings starts everything over
KEPT = PAD + BEFORE + 1    # readings remembered while nothing moves

# ---- what counts as a shove --------------------------------------------------
BEFORE_LIMIT = 1.0     # rad/s allowed in the BEFORE readings
GYRO_LIMIT = 2.2       # rad/s allowed during the stretch. A gesture goes far over.
TURN_LIMIT = 40.0      # degrees the watch may turn during the stretch
SPEED_SIDE = 0.40      # m/s of the first push for a shove left or right (the watch's y)
SPEED_UP_DOWN = 0.30   # m/s of the first push for a shove up or down (the watch's z)
PURE = 0.85            # share of the first push that must lie along that axis
MIN_NS = 300_000_000   # shortest and longest stretch
MAX_NS = 1_600_000_000
PEAK_SHARE = 0.6       # the first peak must reach this share of the fastest moment
REST_NS = 600_000_000  # after a shove, no new one for this long: the hand is coming back

UP, DOWN, LEFT, RIGHT = "SHOVE_UP", "SHOVE_DOWN", "SHOVE_LEFT", "SHOVE_RIGHT"


class Outcome:
    """What became of one stretch of movement. `direction` is None when it was no shove."""

    def __init__(self, direction, start_ns, end_ns, reason, speed=0.0, axis=-1, turned=0.0, gyro_peak=0.0):
        self.direction = direction
        self.start_ns = start_ns
        self.end_ns = end_ns
        self.reason = reason        # why it was no shove, "" for a shove
        self.speed = speed          # m/s of the first push along its main axis, signed
        self.axis = axis            # 0, 1, 2 for the watch's x, y, z. -1 when it was not worked out.
        self.turned = turned        # degrees
        self.gyro_peak = gyro_peak  # rad/s

    def detail(self):
        """A short text for the log, without commas."""
        axis = "xyz"[self.axis] if self.axis >= 0 else "-"
        text = f"{axis}{self.speed:+.2f};gyro{self.gyro_peak:.1f};turn{self.turned:.0f};{(self.end_ns - self.start_ns) / 1e6:.0f}ms"
        return text + (";" + self.reason.replace(" ", "_") if self.reason else "")


def _rotation(wx, wy, wz, dt):
    """The turn made by spinning at (wx, wy, wz) rad/s for dt seconds, as a 3x3 matrix in row order."""
    size = math.sqrt(wx * wx + wy * wy + wz * wz)
    angle = size * dt
    if angle < 1e-12:
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    kx = wx / size
    ky = wy / size
    kz = wz / size
    s = math.sin(angle)
    c = 1.0 - math.cos(angle)
    return [
        1.0 - c * (ky * ky + kz * kz), -s * kz + c * kx * ky, s * ky + c * kx * kz,
        s * kz + c * kx * ky, 1.0 - c * (kx * kx + kz * kz), -s * kx + c * ky * kz,
        -s * ky + c * kx * kz, s * kx + c * ky * kz, 1.0 - c * (kx * kx + ky * ky),
    ]


def _times(a, b):
    """The 3x3 matrix product a b, both in row order."""
    return [
        a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
        a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
        a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    ]


class ShoveDetector:
    """Feed every gyro event to `gyro` and every accelerometer event to `accel`, in the order they arrive.

    `accel` returns an Outcome when a stretch of movement has been judged, otherwise None.
    A stretch that cannot be a shove any more (the wrist turned fast, it went on too long)
    is turned down at once, without waiting for it to end. A shove is only announced when
    the stretch is over, QUIET readings after its last active one.
    """

    def __init__(self):
        self._gyro = (0.0, 0.0, 0.0)
        self._ring = []            # the last KEPT readings: (t, ax, ay, az, wx, wy, wz)
        self._segment = None       # readings of the open stretch, or None
        self._last_active = 0      # index in the stretch of its last active reading
        self._quiet = 0
        self._dead = False         # the open stretch has already been turned down
        self._base = (0.0, 0.0, 0.0)
        self._gyro_peak = 0.0
        self._rest_until = None

    @property
    def moving(self):
        """True while a stretch of movement is open."""
        return self._segment is not None

    @property
    def possible(self):
        """True while a stretch is open that could still turn out to be a shove."""
        return self._segment is not None and not self._dead

    @property
    def since(self):
        """When the open stretch began, or -1."""
        return self._segment[0][0] if self._segment is not None else -1

    def gyro(self, timestamp_ns, x, y, z):
        """One gyro event. Only remembered: the next accelerometer event uses it."""
        self._gyro = (x, y, z)

    def accel(self, timestamp_ns, x, y, z):
        """One accelerometer event. Returns an Outcome when a stretch was judged, otherwise None."""
        ring = self._ring
        if ring:
            gap = timestamp_ns - ring[-1][0]
            if gap <= 0:
                return None  # same instant twice: keep the first
            if gap > MAX_GAP_NS:
                # A hole in the readings: nothing before it can be trusted.
                outcome = None
                if self._segment is not None and not self._dead:
                    outcome = Outcome(None, self._segment[0][0], ring[-1][0], "gap", gyro_peak=self._gyro_peak)
                self._ring = ring = []
                self._segment = None
                self._dead = False
                ring.append((timestamp_ns, x, y, z) + self._gyro)
                return outcome
        wx, wy, wz = self._gyro
        reading = (timestamp_ns, x, y, z, wx, wy, wz)
        turning = math.sqrt(wx * wx + wy * wy + wz * wz)

        active = False
        if len(ring) >= MEAN:
            mx = 0.0
            my = 0.0
            mz = 0.0
            for i in range(len(ring) - MEAN, len(ring)):
                mx += ring[i][1]
                my += ring[i][2]
                mz += ring[i][3]
            dx = x - mx / MEAN
            dy = y - my / MEAN
            dz = z - mz / MEAN
            active = math.sqrt(dx * dx + dy * dy + dz * dz) > ACTIVE_ACCEL or turning > ACTIVE_GYRO

        outcome = None
        if self._segment is None:
            if active and len(ring) >= KEPT:
                outcome = self._open(reading, turning)
        else:
            segment = self._segment
            if not self._dead:
                segment.append(reading)  # a stretch that was turned down is not kept any longer
            if active:
                self._last_active = len(segment) - 1
                self._quiet = 0
                if turning > self._gyro_peak:
                    self._gyro_peak = turning
                if not self._dead:
                    if turning >= GYRO_LIMIT:
                        outcome = self._turn_down("turning")
                    elif len(segment) > MAX_READINGS:
                        outcome = self._turn_down("long")
            else:
                self._quiet += 1
                if self._quiet >= QUIET:
                    if not self._dead:
                        outcome = self._judge()
                    self._segment = None
                    self._dead = False

        ring.append(reading)
        if len(ring) > KEPT:
            del ring[0]
        return outcome

    def _open(self, reading, turning):
        """Starts a stretch at `reading`, with the PAD readings before it."""
        ring = self._ring
        size = len(ring)
        bx = 0.0
        by = 0.0
        bz = 0.0
        for i in range(size - PAD - BASE, size - PAD):
            bx += ring[i][1]
            by += ring[i][2]
            bz += ring[i][3]
        self._base = (bx / BASE, by / BASE, bz / BASE)
        before = 0.0
        for i in range(size - PAD - BEFORE, size - PAD):
            w = math.sqrt(ring[i][4] * ring[i][4] + ring[i][5] * ring[i][5] + ring[i][6] * ring[i][6])
            if w > before:
                before = w
        self._segment = ring[size - PAD:] + [reading]
        self._last_active = PAD
        self._quiet = 0
        self._dead = False
        self._gyro_peak = turning
        start = self._segment[0][0]
        if self._rest_until is not None and start < self._rest_until:
            return self._turn_down("rest")
        if before > BEFORE_LIMIT:
            return self._turn_down("moving before")
        if turning >= GYRO_LIMIT:
            return self._turn_down("turning")
        return None

    def _turn_down(self, reason):
        """The open stretch cannot be a shove. It stays open until the movement ends."""
        self._dead = True
        segment = self._segment
        return Outcome(None, segment[0][0], segment[-1][0], reason, gyro_peak=self._gyro_peak)

    def _judge(self):
        """The stretch is over: work out the first push and decide."""
        segment = self._segment[: self._last_active + 1 + PAD]
        count = len(segment)
        start = segment[0][0]
        end = segment[-1][0]
        base = self._base

        # The hand's velocity in the frame the watch started in.
        turn = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        vx = [0.0] * count
        vy = [0.0] * count
        vz = [0.0] * count
        turned = 0.0
        for i in range(1, count):
            t, ax, ay, az, wx, wy, wz = segment[i]
            dt = (t - segment[i - 1][0]) / 1e9
            turn = _times(turn, _rotation(wx, wy, wz, dt))
            vx[i] = vx[i - 1] + (turn[0] * ax + turn[1] * ay + turn[2] * az - base[0]) * dt
            vy[i] = vy[i - 1] + (turn[3] * ax + turn[4] * ay + turn[5] * az - base[1]) * dt
            vz[i] = vz[i - 1] + (turn[6] * ax + turn[7] * ay + turn[8] * az - base[2]) * dt
            cosine = (turn[0] + turn[4] + turn[8] - 1.0) / 2.0
            angle = math.acos(max(-1.0, min(1.0, cosine))) * 180.0 / math.pi
            if angle > turned:
                turned = angle

        # Out and back: the hand ends at rest, so whatever velocity is left over is drift. Spread it out.
        span = float(end - start)
        ex = vx[count - 1]
        ey = vy[count - 1]
        ez = vz[count - 1]
        speeds = [0.0] * count
        fastest = 0.0
        for i in range(count):
            share = (segment[i][0] - start) / span
            vx[i] -= share * ex
            vy[i] -= share * ey
            vz[i] -= share * ez
            speeds[i] = math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
            if speeds[i] > fastest:
                fastest = speeds[i]

        # The first push: the first peak of the speed that is a real one.
        peak = -1
        for i in range(1, count - 1):
            if speeds[i] >= PEAK_SHARE * fastest and speeds[i] >= speeds[i - 1] and speeds[i] >= speeds[i + 1]:
                peak = i
                break
        if peak < 0:
            peak = 0
            for i in range(count):
                if speeds[i] > speeds[peak]:
                    peak = i
        push = (vx[peak], vy[peak], vz[peak])
        axis = 0
        if abs(push[1]) > abs(push[axis]):
            axis = 1
        if abs(push[2]) > abs(push[axis]):
            axis = 2
        speed = push[axis]
        pure = abs(speed) / speeds[peak] if speeds[peak] > 0.0 else 0.0

        reason = ""
        if end - start < MIN_NS:
            reason = "short"
        elif end - start > MAX_NS:
            reason = "long"
        elif turned >= TURN_LIMIT:
            reason = "turned"
        elif axis == 0:
            reason = "along the arm"
        elif abs(speed) < (SPEED_SIDE if axis == 1 else SPEED_UP_DOWN):
            reason = "slow"
        elif pure < PURE:
            reason = "mixed"
        if reason:
            return Outcome(None, start, end, reason, speed, axis, turned, self._gyro_peak)
        if axis == 1:
            direction = LEFT if speed > 0.0 else RIGHT
        else:
            direction = UP if speed > 0.0 else DOWN
        self._rest_until = end + REST_NS
        return Outcome(direction, start, end, "", speed, axis, turned, self._gyro_peak)


def read_events(csv_path):
    """The events of a recorder or Listen CSV, in file (arrival) order: (kind, timestamp_ns, x, y, z), kind "A" or "G"."""
    events = []
    with Path(csv_path).open("r", newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row.get("gesture_label") == "gesture_label":
                continue  # a repeated header inside the file
            if (row.get("source_sensor") or "").strip().lower() == "accelerometer":
                events.append(("A", int(row["sensor_timestamp_ns"]), float(row["accel_x"]), float(row["accel_y"]), float(row["accel_z"])))
            else:
                events.append(("G", int(row["sensor_timestamp_ns"]), float(row["gyro_x"]), float(row["gyro_y"]), float(row["gyro_z"])))
    return events


def thin(events, keep_every=2):
    """Every `keep_every`-th event of each sensor, for turning a 100 Hz recording into the 50 Hz that Listen mode has."""
    seen = {"A": 0, "G": 0}
    out = []
    for event in events:
        if seen[event[0]] % keep_every == 0:
            out.append(event)
        seen[event[0]] += 1
    return out


def outcomes(events, skip_ns=0):
    """Every Outcome of a stream of events, with the index of the event that produced it. Events in the first `skip_ns` are fed but their outcomes dropped."""
    detector = ShoveDetector()
    found = []
    first = events[0][1] if events else 0
    for index, (kind, timestamp, x, y, z) in enumerate(events):
        if kind == "G":
            detector.gyro(timestamp, x, y, z)
            continue
        outcome = detector.accel(timestamp, x, y, z)
        if outcome is not None and outcome.start_ns - first >= skip_ns:
            found.append((index, outcome))
    return found


if __name__ == "__main__":
    import sys

    for name in sys.argv[1:]:
        stream = read_events(name)
        for _, result in outcomes(stream):
            when = (result.start_ns - stream[0][1]) / 1e9
            print(f"{Path(name).name}  {when:7.2f}s  {result.direction or 'no shove':11s}  {result.detail()}")
