---
name: When fixing warp, target alignment quality not test aggregate
description: Spikes that target warp/border-alignment quality should not chase test-aggregate accuracy until downstream steps are co-tuned for the new alignment
type: feedback
originSessionId: 3a44a13e-6b3b-49b4-a12b-fc6228df0745
---
When working on warp accuracy improvements, the metric to optimise is
**border-alignment quality** (does the detected inner-border match the
true LCD pixel grid edges?), NOT test-aggregate accuracy.

**Why:** Downstream steps (correct, sample, quantize) are tuned to the
existing biased warp output. Improving warp alone may transiently
regress test-aggregate while the downstream steps are still operating
on assumptions that don't match the new geometry. The user has
explicitly accepted aggregate regressions during architectural
restructures (per `project_pipeline_accuracy_experiments.md`), with the
expectation that follow-ups recover the loss.

**How to apply:**
- Don't gate warp commits on aggregate ≤ N. Gate them on visual border
  alignment (the user will give feedback on warp images directly).
- Per-image variability is real — not all photos have the same bias.
  E.g., `thing-3_warp.png` is already mostly correct (bottom edge
  maybe 1-2 image-px off, right maybe 1 image-px). The fix must be
  detection-driven, not a fixed corrective offset.
- After any warp change, expect to need follow-up adjustments to
  correct.ts (white/dark surface samples), sample.ts (sub-pixel
  windows), and possibly quantize.ts. Plan for it.
- Specifically, downstream steps may need to account for BGR sub-pixel
  positioning when interpreting samples — e.g., a DG pixel adjacent to
  WH on the right has a visual dark gap between them due to BGR vs
  _GR sub-pixel layout. Sample/quantize must not be biased by these
  gaps.
