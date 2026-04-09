"""
gbcam_common.py — Shared constants and utilities for the GB Camera pipeline.
"""

import cv2
import numpy as np
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _rel(path) -> str:
    """Return *path* relative to the repo root for display purposes."""
    return os.path.relpath(str(path), _REPO_ROOT)

# ─────────────────────────────────────────────────────────────
# Game Boy Camera palette (grayscale values)
# ─────────────────────────────────────────────────────────────
GB_COLORS = [0, 82, 165, 255]    # #000000  #525252  #A5A5A5  #FFFFFF

# ─────────────────────────────────────────────────────────────
# Screen geometry (in GB pixels)
# ─────────────────────────────────────────────────────────────
SCREEN_W    = 160   # Full GBA SP display width
SCREEN_H    = 144   # Full GBA SP display height
FRAME_THICK = 16    # White filmstrip frame thickness on each side

CAM_W = 128         # Game Boy Camera image width
CAM_H = 112         # Game Boy Camera image height

# Inner border (1-px-wide #525252 band) outer-edge positions in GB pixel coords.
# This band separates the white frame from the camera image area.
INNER_TOP   = FRAME_THICK - 1        # 15
INNER_BOT   = FRAME_THICK + CAM_H    # 128
INNER_LEFT  = FRAME_THICK - 1        # 15
INNER_RIGHT = FRAME_THICK + CAM_W    # 144

# ─────────────────────────────────────────────────────────────
# Pipeline step registry
#
# Steps are referred to by name throughout the pipeline.
# STEP_ORDER defines the canonical sequence.
# STEP_SUFFIX maps each step name to the suffix its output file gets.
# STEP_INPUT_SUFFIX maps each step name to the suffix it expects on its input
#   (None for 'warp', which accepts raw phone photos).
# ─────────────────────────────────────────────────────────────
STEP_ORDER = ["warp", "correct", "crop", "sample", "quantize"]

STEP_SUFFIX = {
    "warp":     "_warp",
    "correct":  "_correct",
    "crop":     "_crop",
    "sample":   "_sample",
    "quantize": "_gbcam",
}

STEP_INPUT_SUFFIX = {
    "warp":     None,          # raw phone photo
    "correct":  "_warp",
    "crop":     "_correct",
    "sample":   "_crop",
    "quantize": "_sample",
}

STEP_DESCRIPTION = {
    "warp": (
        "Perspective correction — detects the four corners of the white filmstrip "
        "frame in the phone photo, perspective-warps the screen to a clean "
        "(160*scale)×(144*scale) rectangle, then refines the alignment by snapping "
        "the inner #525252 border band to its exact expected position."
    ),
    "correct": (
        "Front-light correction — compensates for the GBA SP's side-mounted "
        "front-light, which creates a smooth 2-D brightness gradient across the "
        "screen (both horizontally and vertically). The effect is affine per pixel. "
        "A degree-2 bivariate polynomial is fit to reference measurements from all "
        "four filmstrip frame strips (white reference) and all four inner #525252 "
        "border bands (dark reference), then the per-pixel affine model is inverted."
    ),
    "crop": (
        "Frame crop — discards the white filmstrip frame and keeps only the "
        "128×112 GB Camera image area, producing a (128*scale)×(112*scale) image."
    ),
    "sample": (
        "Pixel sampling — reduces each (scale×scale) block to a single "
        "representative brightness value by sampling the interior of the block "
        "(avoiding pixel-gap and pixel-bleeding artifacts) and taking the median. "
        "Produces a true 128×112 grayscale image."
    ),
    "quantize": (
        "Color quantization — maps each of the 128×112 brightness samples to the "
        "nearest of the four original GB Camera palette colors: #000000 (0), "
        "#525252 (82), #A5A5A5 (165), #FFFFFF (255). After the correct step has "
        "normalized the brightness, k-means clustering on the sample values finds "
        "the four color clusters cleanly. Falls back to frame-geometry reference "
        "points or sample min/max if k-means is unavailable."
    ),
}

# ─────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────
_verbose = False


def set_verbose(v: bool):
    global _verbose
    _verbose = v


def log(msg: str, always: bool = False):
    if always or _verbose:
        print(msg)


# ─────────────────────────────────────────────────────────────
# Debug image saving
# ─────────────────────────────────────────────────────────────

def save_debug(data, debug_dir: str, stem: str, tag: str):
    """Save a debug image to <debug_dir>/<stem>__<tag>.png."""
    if debug_dir is None:
        return
    os.makedirs(debug_dir, exist_ok=True)
    path = os.path.join(debug_dir, f"{stem}__{tag}.png")
    if hasattr(data, 'save'):
        data.save(path)
    elif isinstance(data, np.ndarray):
        cv2.imwrite(path, data)
    log(f"    [debug] {_rel(path)}")


# ─────────────────────────────────────────────────────────────
# Common CLI helpers
# ─────────────────────────────────────────────────────────────

def collect_inputs(inputs_list, directory,
                   extensions=("jpg", "jpeg", "png", "JPG", "JPEG", "PNG")):
    """Gather input file paths from an explicit list and/or a directory glob.

    On case-insensitive filesystems (Windows, macOS) the same file can be
    matched by both 'jpg' and 'JPG' patterns.  Files are deduplicated by
    their resolved absolute path so each physical file is processed once.
    """
    import glob
    files = list(inputs_list or [])
    if directory:
        for ext in extensions:
            files.extend(glob.glob(os.path.join(directory, f"*.{ext}")))

    # Deduplicate by resolved absolute path while preserving order
    seen = set()
    unique = []
    for f in files:
        key = os.path.normcase(os.path.abspath(f))
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return unique


def make_output_path(input_path, output_dir, suffix):
    """
    Build output path: <output_dir>/<base_stem><suffix>.png

    Any existing pipeline step suffix (_warp, _crop, _sample, _gbcam) is
    stripped from the input stem first so suffixes never stack.
    """
    from pathlib import Path
    p    = Path(input_path)
    stem = p.stem
    # Strip any known pipeline suffix
    for known in sorted(STEP_SUFFIX.values(), key=len, reverse=True):
        if stem.endswith(known):
            stem = stem[: -len(known)]
            break
    out_dir = Path(output_dir) if output_dir else p.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    return str(out_dir / (stem + suffix + ".png"))


def strip_step_suffix(stem: str) -> str:
    """Return the base stem with any pipeline step suffix removed."""
    for known in sorted(STEP_SUFFIX.values(), key=len, reverse=True):
        if stem.endswith(known):
            return stem[: -len(known)]
    return stem
