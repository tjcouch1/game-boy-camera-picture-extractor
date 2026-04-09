#!/usr/bin/env python3
"""Run gbcam_extract on sample pictures and test_pipeline on all test inputs that have a reference image."""

import os
import re
import subprocess
import sys
import glob
from pathlib import Path

# Resolve repo root relative to this script (packages/gbcam-extract-py/run_tests.py)
REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)


def _rel(path):
    """Return *path* relative to the repo root for display purposes."""
    return os.path.relpath(path, REPO_ROOT)


SCRIPT_DIR = str(Path(__file__).resolve().parent)
TEST_INPUT_DIR = os.path.join(REPO_ROOT, "test-input")
TEST_OUTPUT_DIR = os.path.join(REPO_ROOT, "test-output")
REFERENCE_SUFFIX = "-output-corrected.png"
SUMMARY_LOG = os.path.join(TEST_OUTPUT_DIR, "test-summary.log")


def run(cmd):
    display_cmd = [_rel(c) if os.path.isabs(c) else c for c in cmd]
    print(f"\n>>> {' '.join(display_cmd)}")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print(f"Command failed with exit code {result.returncode}", file=sys.stderr)
    return result.returncode


def parse_test_log(log_path):
    """Return (match_n, match_pct, diff_n, diff_pct, verdict) from a test_pipeline log file."""
    try:
        with open(log_path) as f:
            text = f.read()
    except FileNotFoundError:
        return None, None, None, None, "NO LOG"

    def extract(label):
        m = re.search(rf"{label}\s*:\s*(\d+)\s*\(\s*([\d.]+)%\)", text)
        return (int(m.group(1)), float(m.group(2))) if m else (None, None)

    match_n, match_pct = extract("Matching")
    diff_n, diff_pct = extract("Different")

    if re.search(r"RESULT:\s*PASS", text):
        verdict = "PASS"
    elif re.search(r"RESULT:\s*FAIL", text):
        verdict = "FAIL"
    else:
        verdict = "UNKNOWN"

    return match_n, match_pct, diff_n, diff_pct, verdict


def write_summary(gbcam_exit, test_results):
    lines = []
    lines.append("=" * 60)
    lines.append("TEST SUMMARY")
    lines.append("=" * 60)
    lines.append("")

    lines.append(f"  gbcam_extract : {'OK' if gbcam_exit == 0 else 'FAILED'}")
    lines.append("")

    if test_results:
        col_w = max(len(r["name"]) for r in test_results)
        header = f"  {'Test':<{col_w}}   Matching          Different         Verdict"
        lines.append(header)
        lines.append("  " + "-" * (len(header) - 2))
        for r in test_results:
            def fmt(n, pct):
                if n is None:
                    return "       N/A       "
                return f"{n:5d} ({pct:6.2f}%)"
            match_str = fmt(r["match_n"], r["match_pct"])
            diff_str  = fmt(r["diff_n"],  r["diff_pct"])
            lines.append(f"  {r['name']:<{col_w}}   {match_str}   {diff_str}   {r['verdict']}")

        lines.append("")
        passed = sum(1 for r in test_results if r["verdict"] == "PASS")
        lines.append(f"  {passed}/{len(test_results)} passed")

    lines.append("")
    lines.append("=" * 60)

    text = "\n".join(lines) + "\n"
    print("\n" + text)

    os.makedirs(TEST_OUTPUT_DIR, exist_ok=True)
    with open(SUMMARY_LOG, "w") as f:
        f.write(text)
    print(f"Summary written to {_rel(SUMMARY_LOG)}")


def main():
    overall_exit = 0
    test_results = []

    # Run gbcam_extract on sample pictures
    gbcam_exit = run([
        sys.executable, os.path.join(SCRIPT_DIR, "gbcam_extract.py"),
        "--dir", os.path.join(REPO_ROOT, "sample-pictures"),
        "--output-dir", os.path.join(REPO_ROOT, "sample-pictures-out"),
        "--clean-steps",
        "--debug",
    ])
    overall_exit |= gbcam_exit

    # Find all reference images and derive the base name from each
    reference_files = glob.glob(os.path.join(TEST_INPUT_DIR, f"*{REFERENCE_SUFFIX}"))

    for reference_path in sorted(reference_files):
        reference_filename = os.path.basename(reference_path)
        base_name = reference_filename[: -len(REFERENCE_SUFFIX)]  # e.g. "zelda-poster"

        # Find all numbered input images for this base name (jpg and png, excluding the reference itself)
        input_files = sorted(
            f for ext in ("*.jpg", "*.png")
            for f in glob.glob(os.path.join(TEST_INPUT_DIR, f"{base_name}-{ext}"))
            if f != reference_path
        )

        for input_path in input_files:
            input_filename = os.path.basename(input_path)
            stem = os.path.splitext(input_filename)[0]  # e.g. "zelda-poster-2"
            output_dir = os.path.join(TEST_OUTPUT_DIR, stem)

            rc = run([
                sys.executable, os.path.join(SCRIPT_DIR, "test_pipeline.py"),
                "--input", input_path,
                "--reference", reference_path,
                "--output-dir", output_dir,
                "--keep-intermediates",
            ])
            overall_exit |= rc

            log_path = os.path.join(output_dir, f"{stem}.log")
            match_n, match_pct, diff_n, diff_pct, verdict = parse_test_log(log_path)
            test_results.append({
                "name": stem,
                "match_n": match_n, "match_pct": match_pct,
                "diff_n": diff_n,   "diff_pct": diff_pct,
                "verdict": verdict,
            })

    write_summary(gbcam_exit, test_results)
    sys.exit(overall_exit)


if __name__ == "__main__":
    main()
