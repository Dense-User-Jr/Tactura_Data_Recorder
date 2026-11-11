"""Draws docs/img/find-the-action.png: how the recipe finds and crops the action in one window.

Run from the repo root:  python ML\plot_find_the_action.py
Uses the same functions as the classifier (blueprint_reference.py), so the picture cannot drift from the code.
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import blueprint_reference as ref

REPO = Path(__file__).resolve().parent.parent
WINDOW = REPO / "classify_logs" / "0036_classify_pred-twist_left-39_20261110_192749.csv"
OUT = REPO / "docs" / "img" / "find-the-action.png"

INK, GREY, BLUE, RED = "#1f2328", "#9aa0a6", "#1f6feb", "#d1242f"


def main() -> None:
    _, events = ref.read_gyro_events(WINDOW)
    gyro = ref.resample(events)
    level = ref.motion_level(gyro)
    peak, peak_level = ref.find_action(level)
    seconds = np.arange(gyro.shape[1]) / ref.RATE_HZ
    axis = int(np.argmax(np.abs(gyro).max(axis=1)))  # the axis that moved the most
    start, end = (peak - ref.HALF) / ref.RATE_HZ, (peak + ref.HALF) / ref.RATE_HZ

    fig, ax = plt.subplots(figsize=(8, 3.8), dpi=200)
    ax.axvspan(start, end, color=BLUE, alpha=0.10, lw=0)
    ax.axhline(0, color="#d0d7de", lw=0.8)
    ax.axhline(ref.THRESHOLD, color=RED, lw=0.9, ls=(0, (4, 3)))
    ax.plot(seconds, gyro[axis], color=GREY, lw=1.2)
    ax.plot(seconds, level, color=BLUE, lw=2.0)
    ax.plot([seconds[peak]], [peak_level], "o", color=BLUE, ms=7, mec="white", mew=1.5, zorder=5)

    top = max(level.max(), gyro[axis].max())
    low = gyro[axis].min()
    ax.set_ylim(low * 1.12, top * 1.38)
    ax.set_xlim(0, seconds[-1])
    ax.annotate(f"peak: {peak_level:.1f} rad/s", (seconds[peak], peak_level), xytext=(10, -3),
                textcoords="offset points", color=BLUE, fontsize=9, fontweight="bold")
    ax.text((start + end) / 2, top * 1.30, "the clip we keep (1.2 s)", ha="center", va="top", color=BLUE, fontsize=9)
    ax.text(seconds[-1] - 0.03, ref.THRESHOLD + top * 0.02, "motion threshold, 1.0 rad/s", ha="right", va="bottom",
            color=RED, fontsize=8)
    ax.text(seconds[peak] + 0.13, peak_level * 0.76, "motion level", color=BLUE, fontsize=9, fontweight="bold")
    ax.text(0.04, low * 0.55, f"raw rotation ({'xyz'[axis]} axis)", color="#6e7781", fontsize=9)

    ax.set_xlabel("seconds after the strong buzz", color=INK, fontsize=9)
    ax.set_ylabel("rotation speed (rad/s)", color=INK, fontsize=9)
    ax.set_title("Finding the action: one Twist Left, file 0036 from the 11/10 watch test", loc="left",
                 color=INK, fontsize=10, fontweight="bold")
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#d0d7de")
    ax.tick_params(colors="#57606a", labelsize=8)
    fig.tight_layout()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT, facecolor="white")
    print(f"wrote {OUT.relative_to(REPO)}  peak {peak_level:.2f} rad/s at {seconds[peak]:.2f} s on the {'xyz'[axis]} axis")


if __name__ == "__main__":
    main()
