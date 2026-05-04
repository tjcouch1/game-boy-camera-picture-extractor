# Memory snapshot — 2026-05-04

These files are a snapshot of the auto-memory at
`~/.claude/projects/C--Users-tj-co-source-repos-p-game-boy-camera-picture-extractor/memory/`
captured at the time of writing the warp-detection-then-correction
plan, so they survive a computer change.

To restore on a new machine: copy the files (except this `README.md`
and the `MEMORY.md` index) into your local
`~/.claude/projects/<...path-hash...>/memory/` directory, then re-create
or update the local `MEMORY.md` index to point at them.

The files at the time of this snapshot:

- `feedback_no_cd_git_compound.md` — Use `git -C` not `cd && git`
- `feedback_no_compound_commands.md` — Don't put cwd paths in commands;
  cd first then run separately
- `project_pipeline_accuracy_experiments.md` — Big history of why
  several earlier attempts (B-channel correction, target-anchored
  boundaries, 3D RGB k-means) failed, plus how the architectural
  restructure landed
- `feedback_quad_metric_and_warp_first.md` — New-image quad isn't
  pure WH; specific area expectations on `20260328_165926`; fix
  warp accuracy before colour-area tuning
- `project_warp_bgr_subpixel_bias.md` — GBA SP BGR sub-pixel ordering
  pulls warp's right edge inward 3-4 image-px due to the visible
  `B___GR` gap between adjacent DG and WH pixels
- `feedback_warp_alignment_target.md` — Warp spikes target alignment,
  not aggregate test metric; expect to co-tune correct/sample/quantize
  after warp changes

The continuation plan that references these is at
`docs/superpowers/plans/2026-05-04-warp-detection-then-correction.md`.
