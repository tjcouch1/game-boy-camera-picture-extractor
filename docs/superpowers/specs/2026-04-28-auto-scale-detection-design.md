# Auto-scale detection — design

**Date:** 2026-04-28
**Status:** Approved (brainstorming)
**Scope:** TypeScript pipeline (`packages/gbcam-extract/`) only. Python pipeline is unchanged.

## Goal

Remove the `scale` parameter from the public TypeScript pipeline API. The pipeline picks an appropriate scale automatically from the input photo so callers never have to think about it.

Priorities, in order:

1. **Accuracy** — high-resolution photos must not be downsampled by the warp step. The pipeline should preserve as much of the input pixel density as is meaningful.
2. **Caller simplicity** — `processPicture(input)` should "just work". No knobs.
3. Performance is explicitly de-prioritised. Memory/CPU is fine to spend if it helps accuracy.

Higher-than-necessary scale is worthless (it would just upsample), so the rule is: pick the smallest integer scale that doesn't downsample the detected screen.

## Auto-scale rule

Computed inside `warp.ts` immediately after corner detection, before the initial perspective warp.

Given the four ordered detected screen corners `TL`, `TR`, `BR`, `BL`:

```text
topW    = euclidean(TL, TR)
botW    = euclidean(BL, BR)
leftH   = euclidean(TL, BL)
rightH  = euclidean(TR, BR)

maxHorizontal = max(topW, botW)
maxVertical   = max(leftH,  rightH)

scale = max(
  1,
  ceil(max(maxHorizontal / SCREEN_W, maxVertical / SCREEN_H))
)
```

Where `SCREEN_W = 160`, `SCREEN_H = 144`.

`max(1, …)` guards against degenerate detection (zero-area quad, NaN). No upper cap in v1; if a future input causes runaway memory, we'll add one then.

## Architecture

`warp.ts` is the source of truth for the chosen scale. Every downstream step infers scale from the dimensions of its own input image — the same pattern already used in `correct.ts`:

| Step      | Inferred from              | Expected denominator |
| --------- | -------------------------- | -------------------- |
| `correct` | `input.width / SCREEN_W`   | 160                  |
| `crop`    | `input.width / SCREEN_W`   | 160                  |
| `sample`  | `input.width / CAM_W`      | 128                  |

Each step validates that `input.width` is a positive integer multiple of the expected denominator and that `input.height` matches the corresponding height. If not, throw with a clear message naming the step and the expected vs. actual dimensions.

## Public API changes

All breaking. Callers stop passing `scale` everywhere.

`packages/gbcam-extract/src/common.ts`

- `PipelineOptions` becomes `{ debug?: boolean; onProgress?: (step, pct) => void }`. The `scale?: number` field is removed.

`packages/gbcam-extract/src/warp.ts`

- `WarpOptions` loses `scale?`. (`threshold?` and `debug?` stay.)
- `warp(input)` computes its own scale via the rule above, runs the existing two-pass refinement against that scale, and returns an image whose dimensions are `(SCREEN_W·scale, SCREEN_H·scale)`.

`packages/gbcam-extract/src/correct.ts`, `crop.ts`, `sample.ts`

- Their `*Options` interfaces lose `scale?`.
- Each step infers `scale` from `input.width` (table above) and validates dimensions.

`packages/gbcam-extract/src/index.ts`

- `processPicture` no longer reads or forwards `scale`.

## Debug output

A new `autoScale` block is added to `debug.metrics.warp`:

```json
{
  "autoScale": {
    "edgeLengths": { "top": 1247.3, "bottom": 1251.0, "left": 1118.6, "right": 1124.9 },
    "maxHorizontal": 1251.0,
    "maxVertical":   1124.9,
    "scale": 8
  }
}
```

A new log line is emitted alongside the existing corner-detection log line in `warp.ts`:

```text
[warp] auto-scale: edges T=1247.3 B=1251.0 L=1118.6 R=1124.9, maxH=1251.0 maxV=1124.9, scale=8
```

Subsequent steps' debug logs already report computed dimensions, so the chosen scale is implicitly visible there too — no new logging needed in `correct`/`crop`/`sample`.

## Scripts and tests

`packages/gbcam-extract/scripts/extract.ts`

- Drop `--scale N` flag and its help text.
- `STEP_FUNCTIONS` map: drop the `scale` parameter from each step closure.
- Drop `args.scale` from the parsed-args type and defaults.
- The "Pipeline: …" header line that prints `scale=…` is replaced with `scale=auto`.

`packages/gbcam-extract/scripts/interleave-test.ts`

- Drop the hardcoded `{ scale: 8 }` from the TS-side step calls.
- Python-side invocations keep `--scale 8` because the Python pipeline isn't changing. This means a TS-only run picks an auto-scale that may differ from 8, while Python is fixed at 8. Document the discrepancy in a code comment so the script doesn't read as a bug.

`packages/gbcam-extract/tests/`

- `warp.test.ts`: drop the `scale` arg; the synthetic input has known geometry, so compute the expected auto-scale and assert output dims `(160·k, 144·k)` for that `k`.
- `correct.test.ts`, `crop.test.ts`, `sample.test.ts`: drop the `scale` arg from each `*({ scale })` call. The test inputs are constructed at specific dimensions; the steps will infer the same scale.
- New: `tests/auto-scale.test.ts` — unit-tests the extracted `computeAutoScale(corners)` helper against a few synthetic quads (axis-aligned, perspective, degenerate).

## Web frontend

No user-visible change. `useProcessing.ts` already calls `processPicture(gbImage, { debug, onProgress })` without a scale field, so removing the option is transparent. The unrelated `outputScale` and `previewScale` UI controls (post-pipeline rendering only) stay as-is.

## Verification

Before declaring done, run `pnpm test:pipeline` and compare per-image accuracy to the current baseline. The summary log already prints the chosen scale per image (via the new `autoScale` metric and the new log line in each per-image `.log` file), so any accuracy delta can be attributed to a specific scale change.

Acceptance:

- All vitest unit tests pass.
- `pnpm test:pipeline` accuracy does not regress meaningfully on the existing corpus. (Most photos are expected to land at scale 8, matching prior behavior.)
- `pnpm typecheck` passes for both `gbcam-extract` and `gbcam-extract-web`.

## Risks and known limitations

- **Tests were tuned implicitly at scale=8.** If auto-detect picks a different scale for any test image (e.g. a high-res photo lands at 9 or 10), pixel-level accuracy may shift. Mitigation: log the chosen scale per image and inspect any regressions in the verification step above.
- **Very low-resolution inputs** (detected screen narrower than ~160 source pixels wide) will compute `scale = 1`. The `sample` step's per-block aggregation degenerates to a single-pixel sample in that regime. This is acknowledged as out-of-scope for v1; users with such low-res photos will get correspondingly low-quality results, which is acceptable. We can raise a minimum-scale floor later if it matters.
- **No upper cap.** A 4K-or-larger photo of a fully-framed screen could yield `scale = 20` or higher, producing a ~3200×2880 working image. User explicitly accepted the memory trade-off.
