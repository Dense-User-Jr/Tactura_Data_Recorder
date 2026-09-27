"""
sensor_gesture_plot.py

Visualize wearable IMU (accelerometer + gyroscope) gesture recordings
exported in the Pixel-2-watch CSV format:

    sample_index, elapsed_ms, sensor_timestamp_ns, source_sensor,
    accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z

A single file may contain any number of recordings concatenated back-to-back,
each new recording re-emitting the header row. This module detects and
splits those automatically, then can composite (mean +/- std, time-aligned)
an arbitrary number of recordings -- from one file or many -- into a single
figure covering every available sensor channel.

Typical usage
-------------
    from sensor_gesture_plot import composite_sensor_plot

    fig, stats = composite_sensor_plot(
        groups={
            "Twist 1": "twist1.csv",
            "Twist 2": "twist2.csv",
        },
        title="Twist 1 vs Twist 2",
        output_path="composite.png",
    )

You can pass any number of groups, any number of files per group, and each
file can itself hold any number of concatenated recordings -- they're all
pooled together automatically.
"""

import io
from itertools import count
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# All channels this format can supply. If a channel is missing or empty in
# the data, it is skipped automatically -- "as many as possible" is handled
# by just not plotting what isn't there.
SENSOR_CHANNELS = ["accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z"]
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_DIR = PROJECT_ROOT / "recordings" / "GestureDataRecorder"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "Accessory Software" / "Graphs"
DEFAULT_OUTPUT_NAME = "composite_sensors.png"


def _next_available_output_path(directory, filename):
    """Return a non-existing output path, adding a numbered suffix if needed."""
    directory = Path(directory)
    base_path = directory / filename
    if not base_path.exists():
        return base_path

    stem, suffix = base_path.stem, base_path.suffix
    for number in count(1):
        candidate = directory / f"{stem}_{number:03d}{suffix}"
        if not candidate.exists():
            return candidate


def load_recordings(path_or_paths):
    """
    Load one or more CSV files in the watch sensor format, automatically
    splitting any file that contains multiple concatenated recordings
    (detected by repeated 'sample_index,elapsed_ms...' header rows).

    Parameters
    ----------
    path_or_paths : str, or list of str
        Path(s) to CSV file(s).

    Returns
    -------
    list of pandas.DataFrame
        One DataFrame per individual recording, each tagged with a
        'recording_source' column noting the originating file.
    """
    paths = [path_or_paths] if isinstance(path_or_paths, str) else list(path_or_paths)

    all_recordings = []
    for path in paths:
        with open(path, "r") as f:
            text = f.read()
        lines = text.splitlines()
        if not lines:
            continue
        header = lines[0]
        chunks, current = [], [header]
        for line in lines[1:]:
            if line.startswith("sample_index,elapsed_ms"):
                chunks.append("\n".join(current))
                current = [header]
            else:
                current.append(line)
        chunks.append("\n".join(current))

        for chunk in chunks:
            df = pd.read_csv(io.StringIO(chunk))
            if df.empty:
                continue
            df["recording_source"] = path
            all_recordings.append(df)

    return all_recordings


def _extract_channel_series(df, channel):
    """Pull a channel's (time, value) samples from the rows that actually
    carry that sensor's readings (accelerometer rows for accel_*, gyroscope
    rows for gyro_*)."""
    if channel.startswith("accel"):
        sub = df[df.get("source_sensor", "") == "accelerometer"]
    elif channel.startswith("gyro"):
        sub = df[df.get("source_sensor", "") == "gyroscope"]
    else:
        sub = df
    if channel not in sub.columns or sub.empty:
        return np.array([]), np.array([])
    return sub["elapsed_ms"].values.astype(float), sub[channel].values.astype(float)


def _gyro_magnitude(df):
    """Overall rotation-rate magnitude, used as the default alignment
    reference so recordings line up on the moment of peak rotation
    regardless of which axis dominates."""
    g = df[df.get("source_sensor", "") == "gyroscope"]
    if g.empty or not {"gyro_x", "gyro_y", "gyro_z"}.issubset(g.columns):
        return np.array([]), np.array([])
    t = g["elapsed_ms"].values.astype(float)
    mag = np.sqrt(g["gyro_x"] ** 2 + g["gyro_y"] ** 2 + g["gyro_z"] ** 2).values
    return t, mag


def composite_sensor_plot(
    groups,
    channels=SENSOR_CHANNELS,
    window_ms=1500,
    n_points=150,
    align="peak",
    show_individual=True,
    title=None,
    output_path=None,
    figsize=None,
):
    """
    Composite any number of recordings -- from any number of source files --
    into one figure with a subplot per sensor channel, so gestures can be
    inspected or compared at a glance.

    Parameters
    ----------
    groups : dict[str, various]
        Maps a group label to the recordings that make it up. Each value
        can be:
          - a single CSV path,
          - a list of CSV paths,
          - a single DataFrame, or
          - a list of DataFrames (e.g. already loaded/pre-filtered).
        Any file may contain multiple concatenated recordings; all of a
        group's recordings, from all its sources, are pooled and averaged
        together. Example:
            {"Twist 1": "twist1.csv", "Twist 2": ["twist2.csv", "twist2b.csv"]}
    channels : list of str, default all six axes
        Which sensor columns to plot. A channel absent from the data is
        skipped rather than raising an error.
    window_ms : int
        Total time window (centered on the alignment point) to display.
    n_points : int
        Number of points each recording is resampled to before averaging.
    align : {"peak", "start"}
        "peak" (default) lines recordings up on the moment of peak gyro
        magnitude -- best for comparing gesture shape regardless of small
        timing offsets. "start" aligns on each recording's first sample.
    show_individual : bool
        If True, draw each recording's own (thin, translucent) trace behind
        the group mean, so within-group variability is visible directly.
    title : str, optional
        Overall figure title.
    output_path : str, optional
        If given, save the figure here (.png, .svg, .pdf, ...).
    figsize : tuple, optional
        Auto-computed from the number of channels if omitted.

    Returns
    -------
    fig : matplotlib.figure.Figure
    stats : dict
        stats[channel][group_label] = {"mean": array, "std": array, "n": int}
        -- for programmatic use (e.g. feeding a classifier) alongside the plot.
    """
    # --- normalize every group's recordings into a list of DataFrames ---
    resolved_groups = {}
    for label, spec in groups.items():
        if isinstance(spec, pd.DataFrame):
            resolved_groups[label] = [spec]
        elif isinstance(spec, list) and spec and isinstance(spec[0], pd.DataFrame):
            resolved_groups[label] = spec
        else:
            resolved_groups[label] = load_recordings(spec)

    # drop channels with no data anywhere, so "as many as possible" degrades cleanly
    available_channels = []
    for ch in channels:
        if any(len(_extract_channel_series(df, ch)[0]) > 0
               for dfs in resolved_groups.values() for df in dfs):
            available_channels.append(ch)

    n_channels = max(len(available_channels), 1)
    ncols = 3 if n_channels > 1 else 1
    nrows = int(np.ceil(n_channels / ncols))
    if figsize is None:
        figsize = (5.2 * ncols, 3.4 * nrows)

    fig, axes = plt.subplots(nrows, ncols, figsize=figsize, squeeze=False)
    axes_flat = axes.flatten()

    colors = plt.rcParams["axes.prop_cycle"].by_key()["color"]
    grid = np.linspace(-window_ms / 2, window_ms / 2, n_points)
    stats = {}

    for ax_idx, channel in enumerate(available_channels):
        ax = axes_flat[ax_idx]
        for g_idx, (label, dfs) in enumerate(resolved_groups.items()):
            color = colors[g_idx % len(colors)]
            waves = []
            for df in dfs:
                t, v = _extract_channel_series(df, channel)
                if len(t) == 0:
                    continue
                if align == "peak":
                    ref_t, ref_v = _gyro_magnitude(df)
                    peak_t = ref_t[np.argmax(ref_v)] if len(ref_t) else t[np.argmax(np.abs(v))]
                    rel_t = t - peak_t
                else:  # "start"
                    rel_t = t - t[0]
                interp = np.interp(grid, rel_t, v, left=np.nan, right=np.nan)
                waves.append(interp)
                if show_individual:
                    ax.plot(grid, interp, color=color, alpha=0.15, linewidth=1, zorder=1)

            if not waves:
                continue
            waves = np.array(waves)
            mean_wave = np.nanmean(waves, axis=0)
            std_wave = np.nanstd(waves, axis=0)

            ax.plot(grid, mean_wave, color=color, linewidth=2.2, zorder=3,
                     label=f"{label} (n={len(waves)})")
            ax.fill_between(grid, mean_wave - std_wave, mean_wave + std_wave,
                             color=color, alpha=0.15, linewidth=0, zorder=2)

            stats.setdefault(channel, {})[label] = {
                "mean": mean_wave, "std": std_wave, "n": len(waves)
            }

        ax.set_title(channel)
        ax.set_xlabel("ms from " + ("peak rotation" if align == "peak" else "start"))
        ax.set_ylabel(channel.split("_")[0])
        ax.axhline(0, color="gray", linewidth=0.8, linestyle="--", alpha=0.6)
        ax.grid(alpha=0.25)

    for j in range(len(available_channels), len(axes_flat)):
        axes_flat[j].axis("off")

    handles, labels = axes_flat[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=len(resolved_groups),
               bbox_to_anchor=(0.5, 1.04), frameon=False)

    if title:
        fig.suptitle(title, y=1.08, fontsize=14, fontweight="bold")

    fig.tight_layout()

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, dpi=150, bbox_inches="tight")

    return fig, stats


def _build_arg_parser():
    import argparse

    parser = argparse.ArgumentParser(
        prog="sensor_gesture_plot.py",
        description=(
            "Composite any number of gesture-recording CSVs (Pixel-2-watch "
            "sensor format) into one figure covering every available sensor "
            "channel."
        ),
        epilog=(
            "Examples:\n"
            "  # No files -> use recordings/GestureDataRecorder/*.csv\n"
            "  python3 sensor_gesture_plot.py\n\n"
            "  # One file, one group -- named after the file itself\n"
            "  python3 sensor_gesture_plot.py twist1.csv\n\n"
            "  # Two files -> two groups plotted side by side automatically\n"
            "  python3 sensor_gesture_plot.py twist1.csv twist2.csv\n\n"
            "  # Explicit group labels, and/or multiple files pooled per group\n"
            "  python3 sensor_gesture_plot.py "
            "--group \"Twist 1=twist1.csv\" "
            "--group \"Twist 2=twist2.csv,twist2b.csv\" "
            "-o out.png -t \"Twist comparison\"\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "files", nargs="*",
           help="CSV file path(s). Each file becomes its own group, named after "
               "the file (without extension), unless --group is used instead. "
               "With no files, all CSVs in recordings/GestureDataRecorder are used.",
    )
    parser.add_argument(
        "--group", action="append", default=[], metavar="LABEL=FILE[,FILE...]",
        help="Define a group explicitly, e.g. "
             "--group \"Twist 1=twist1.csv,twist1b.csv\". "
             "Repeat this flag for multiple groups. Overrides positional 'files'.",
    )
    parser.add_argument(
        "-o", "--output", default=None,
        help="Output image path (.png, .svg, .pdf, ...). By default, save a new "
             "numbered image in Accessory Software/Graphs.",
    )
    parser.add_argument(
        "-t", "--title", default=None,
        help="Figure title.",
    )
    parser.add_argument(
        "--channels", nargs="+", default=None, metavar="CHANNEL",
        help=f"Which sensor channels to plot. Default: all of {SENSOR_CHANNELS}",
    )
    parser.add_argument(
        "--align", choices=["peak", "start"], default="peak",
        help="Time-align recordings on peak gyro rotation, or on each "
             "recording's start. Default: %(default)s",
    )
    parser.add_argument(
        "--window-ms", type=int, default=1500,
        help="Time window (ms) shown, centered on the alignment point. "
             "Default: %(default)s",
    )
    parser.add_argument(
        "--no-individual", action="store_true",
        help="Hide individual recording traces; show only the group mean/std.",
    )
    parser.add_argument(
        "--show", action="store_true",
        help="Also open an interactive window with the figure (in addition "
             "to saving it).",
    )
    return parser


def _groups_from_args(args):
    """Turn CLI args into the `groups` dict composite_sensor_plot expects."""
    import os

    groups = {}
    if args.group:
        for spec in args.group:
            if "=" not in spec:
                raise SystemExit(
                    f"--group '{spec}' is missing '='. Use LABEL=FILE[,FILE...]"
                )
            label, file_list = spec.split("=", 1)
            groups[label.strip()] = [f.strip() for f in file_list.split(",")]
    elif args.files:
        for f in args.files:
            label = os.path.splitext(os.path.basename(f))[0]
            groups[label] = f
    else:
        default_files = sorted(DEFAULT_INPUT_DIR.glob("*.csv"))
        if not default_files:
            raise SystemExit(
                f"No CSV files found in {DEFAULT_INPUT_DIR}. Pass one or more "
                "CSV files, or use --group. Run with -h for usage/examples."
            )
        for path in default_files:
            label = path.stem
            groups[label] = str(path)
    return groups


def main(argv=None):
    parser = _build_arg_parser()
    args = parser.parse_args(argv)
    groups = _groups_from_args(args)
    output_path = (
        Path(args.output)
        if args.output
        else _next_available_output_path(DEFAULT_OUTPUT_DIR, DEFAULT_OUTPUT_NAME)
    )

    fig, stats = composite_sensor_plot(
        groups=groups,
        channels=args.channels if args.channels else SENSOR_CHANNELS,
        window_ms=args.window_ms,
        align=args.align,
        show_individual=not args.no_individual,
        title=args.title,
        output_path=output_path,
    )

    print(f"Saved figure to {output_path}")
    for channel, groupdata in stats.items():
        for label, s in groupdata.items():
            print(f"  {channel:10s} {label:15s} n={s['n']}")

    if args.show:
        plt.show()


if __name__ == "__main__":
    main()
