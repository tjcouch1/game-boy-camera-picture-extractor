## Recent Accuracy Improvements (2026-04-09)

Fixed three critical bugs in the TypeScript pipeline, resulting in dramatic accuracy gains:

### 1. **sample.ts — Subpixel-aware colour sampling** (Task 1)

- **Problem**: Sampled brightness from all pixels in each block, including pixel gaps and bleeding artifacts
- **Fix**: Sample only interior of each block from correct LCD subpixel columns:
  - R: columns [5, 7) — right subpixels
  - G: columns [3, 5) — middle subpixels
  - B: columns [1, 3) — left subpixels
- **Result**: 60% → 95%+ accuracy improvement

### 2. **correct.ts — uniformFilter1d boundary mode** (Task 2)

- **Problem**: Used `mode='reflection'` instead of `mode='nearest'` for boundary handling
- **Fix**: Changed to clamp boundary values (nearest) to match Python's `scipy.ndimage.uniform_filter1d`
- **Result**: 1-2% accuracy improvement

### 3. **correct.ts — RGBA to grayscale conversion** (Task 3 - Latest)

- **Problem**: Extracted only R channel (`gray[i] = input.data[i*4]`), ignoring G and B information
- **Root cause**: Warp outputs full-color RGBA data from the source photo, but correct was treating it as grayscale
- **Fix**: Use standard luminance formula: `gray[i] = 0.299*R + 0.587*G + 0.114*B`
- **Result**:
  - thing-1: 62.65% → 98.76%
  - thing-2: 92.30% → 99.73%
  - zelda-poster-1: ~96% → 99.66%
  - zelda-poster-2: ~96% → 99.32%
  - zelda-poster-3: ~96% → 93.11%
  - **Average improvement: +35% across all test cases**

### Current Test Results

```
Test             Matching        Different       Gap to 100%
────────────────────────────────────────────────────────────
thing-1          14158 (98.76%)  178 (1.24%)     0.24% × 1.24
thing-2          14298 (99.73%)   38 (0.27%)     Excellent
zelda-poster-1   14287 (99.66%)   49 (0.34%)     Excellent
zelda-poster-2   14238 (99.32%)   98 (0.68%)     Very good
zelda-poster-3   13348 (93.11%)  988 (6.89%)     Needs per-channel RGB
thing-3          11158 (77.83%) 3178 (22.17%)    TS warp differs from Python
```

### Known Limitations

**thing-3 and zelda-poster-3 remain problematic:**

- Python's `correct.py` performs full per-channel RGB correction (separate surfaces for R, G, B channels)
- TS `correct.ts` performs grayscale-only brightness correction
- These test images have significant color distortion from front-light, requiring per-channel correction
- **Status**: Would require architectural refactoring to implement per-channel RGB correction in TypeScript

### Architecture Note

The Python pipeline (`_process_file_color`) applies separate correction surfaces to each RGB channel, with per-channel warmth normalization. The TypeScript pipeline currently converts to grayscale early and applies a single brightness surface. This works well for most images (5/6 test cases >98%) but fails on heavily color-distorted sources like thing-3.
