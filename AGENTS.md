# Game Boy Camera Picture Extractor

Transforms phone photos of a Game Boy Camera image on a Game Boy Advance SP screen into clean 128x112 four-color Game Boy Camera images.

## Repository Structure

This is a pnpm monorepo:

```
packages/
  gbcam-extract-py/    Python pipeline (historical reference)
  gbcam-extract/       TypeScript pipeline (active development)
  gbcam-extract-web/   React PWA frontend
supporting-materials/  Reference frame images, ASCII art, etc.
sample-pictures/       Sample input photos for extraction
test-input/            Test images with reference outputs
test-output/           Pipeline test results and diagnostics
```

### packages/gbcam-extract-py/ — Python pipeline (historical reference)

The original pipeline implementation. Serves as reference when porting algorithms to TypeScript.

- `gbcam_extract.py` — pipeline orchestrator
- `gbcam_warp.py`, `gbcam_correct.py`, `gbcam_crop.py`, `gbcam_sample.py`, `gbcam_quantize.py` — pipeline steps
- `run_tests.py` — test runner
- `test_pipeline.py` — single-image test with accuracy comparison

### packages/gbcam-extract/ — TypeScript pipeline (active development)

The TypeScript port of the pipeline. This is what we develop going forward.

- `src/warp.ts`, `src/correct.ts`, `src/crop.ts`, `src/sample.ts`, `src/quantize.ts` — pipeline steps
- `src/palette.ts` — color palette application
- `src/index.ts` — public API and `processPicture()` orchestrator
- `src/init-opencv.ts` — opencv.js initialization (call `initOpenCV()` before pipeline use)
- `src/opencv.ts` — Mat memory management helpers
- `src/common.ts` — shared types and constants
- `scripts/extract.ts` — CLI extraction script
- `scripts/run-tests.ts` — test runner mirroring run_tests.py
- `tests/` — vitest unit and integration tests

### packages/gbcam-extract-web/ — React PWA

- `src/App.tsx` — main app component
- `src/components/` — UI components (ImageInput, PalettePicker, ResultCard, etc.)
- `src/hooks/` — React hooks (useOpenCV, useProcessing, useUserPalettes)
- `src/data/palettes.ts` — color palette presets

## Development Focus

- The **TypeScript package** (`packages/gbcam-extract/`) is the active development target.
- Python scripts in `packages/gbcam-extract-py/` are **historical reference only** — when improving algorithms, always work on the TypeScript package.
- The test suite compares TypeScript output against reference images to track accuracy.
- Do NOT import `@techstark/opencv-js` directly — always use `initOpenCV()` from `init-opencv.ts`.

## How to Run

### Extraction scripts

Python:

```bash
cd packages/gbcam-extract-py && python gbcam_extract.py --dir ../../sample-pictures --output-dir ../../sample-pictures-out-py
```

TypeScript:

```bash
cd packages/gbcam-extract && pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out
```

### Typechecking

From root (checks all packages):

```bash
pnpm typecheck
```

Or per-package:

```bash
cd packages/gbcam-extract && pnpm typecheck
cd packages/gbcam-extract-web && pnpm typecheck
```

### Tests

Python test suite:

```bash
cd packages/gbcam-extract-py && python run_tests.py
```

TypeScript unit tests (vitest):

```bash
cd packages/gbcam-extract && pnpm test
```

TypeScript pipeline tests (accuracy comparison against reference images):

```bash
cd packages/gbcam-extract && pnpm test:pipeline
```

Python test runner outputs to `test-output-py/`, TypeScript to `test-output/`. Both produce a `test-summary.log`. You can compare them side by side.

### Interleave test (mixed Python/TypeScript pipeline debugging)

The `interleave` script runs a single test image through a mixed Python/TypeScript pipeline to isolate per-step accuracy differences:

```bash
cd packages/gbcam-extract && pnpm interleave -- --image zelda-poster-1 --py warp,correct --ts crop,sample,quantize
```

**Usage pattern:**

- `--image <name>` — test image name (without extension), e.g., `thing-1`, `zelda-poster-1`
- `--py <steps>` — comma-separated steps to run in Python (e.g., `warp,correct`)
- `--ts <steps>` — comma-separated steps to run in TypeScript (e.g., `crop,sample,quantize`)
- Steps not specified default to TypeScript

**Available steps:** `warp`, `correct`, `crop`, `sample`, `quantize`

**Example workflows:**

Test which step diverges most (run one step at a time in TypeScript while keeping others in Python):

```bash
# All Python (reference)
pnpm interleave -- --image thing-2 --py warp,correct,crop,sample,quantize

# Isolate each step by swapping one to TypeScript
pnpm interleave -- --image thing-2 --py correct,crop,sample,quantize --ts warp
pnpm interleave -- --image thing-2 --py warp,crop,sample,quantize --ts correct
pnpm interleave -- --image thing-2 --py warp,correct,sample,quantize --ts crop
pnpm interleave -- --image thing-2 --py warp,correct,crop,quantize --ts sample
pnpm interleave -- --image thing-2 --py warp,correct,crop,sample --ts quantize
```

**Output:** Shows pixel-level accuracy percentage and per-colour error breakdown. Use to identify which step(s) contribute most to accuracy gaps.

### Inspecting test results

- `test-output/<test-name>/` (TypeScript) or `test-output-py/<test-name>/` (Python) contains the final outputs and reference-comparison diagnostics
- `test-output/test-summary.log` / `test-output-py/test-summary.log` has accuracy numbers (matching/different pixel counts and percentages)
- `test-output/<test-name>/<test-name>.log` is the per-image log: pipeline diagnostics, comparison summary, color distribution, confusion matrix, error breakdown
- `test-output/<test-name>/<test-name>_diag_*.png` are reference-comparison images (error map, side-by-side, etc.)
- `test-output/<test-name>/debug/` holds everything emitted by the pipeline itself when `debug: true` (see next section)

### Pipeline debug output (`debug/` folder)

When the TS pipeline runs with `debug: true` (always on for `pnpm test:pipeline` and `pnpm extract` against `sample-pictures/`), each test/sample directory gets a `debug/` subfolder containing per-step images plus a structured JSON metrics file. **Both visual debugging and programmatic analysis are first-class targets** — every metric printed in the log is also in the JSON.

#### Debug images per step

All filenames are prefixed with the input stem (e.g. `thing-1_`).

**warp**
- `<stem>_warp.png` — final warped (160·scale)×(144·scale) RGBA image (post both refinement passes). This is the regular pipeline intermediate, not strictly a "debug" image.
- `<stem>_warp_a_corners.png` — original input photo with the four detected screen corners drawn as green discs and a green polyline. Use this to verify the corner-detection step found the right quadrilateral.

**correct**
- `<stem>_correct.png` — final brightness-corrected RGBA image (regular intermediate).
- `<stem>_correct_a_before_after.png` — camera region (128·scale × 112·scale) shown side-by-side: warped input on the left, corrected output on the right. Quickest visual check of whether the brightness gradient was removed.
- `<stem>_correct_b_white_surface.png` — JET heatmap (red=high, blue=low) of the average of the R-channel and G-channel white-reference surfaces. Visualises the front-light brightness gradient model — should be smooth.
- `<stem>_correct_c_dark_surface.png` — same but for the dark-reference (DG) surfaces. Both surfaces together define the per-pixel affine correction.

**crop**
- `<stem>_crop.png` — cropped (128·scale)×(112·scale) RGBA image (regular intermediate).
- `<stem>_crop_a_region.png` — full warp output with the crop rectangle (green) and the inner-border band (orange) overlaid. Confirms the crop is taking pixels from the right place.

**sample**
- `<stem>_sample.png` — 128×112 RGBA image, one pixel per GB pixel, holding the per-channel sub-pixel-aware brightness samples (regular intermediate).
- `<stem>_sample_a_8x.png` — 8× nearest-neighbour upscale of the sample image so individual GB pixels are visible.

**quantize**
- `<stem>_gbcam.png` (in the parent directory, not `debug/`) — final 128×112 grayscale, values exactly 0/82/165/255.
- `<stem>_gbcam_rgb.png` (in the parent directory) — same image rendered with the "Down" palette colors.
- `<stem>_quantize_a_gray_8x.png` — 8× upscaled grayscale output.
- `<stem>_quantize_b_rgb_8x.png` — 8× upscaled palette-rendered output (matching the "Down" palette).
- `<stem>_quantize_c_rg_scatter.png` — 256×256 RG color-space scatter of every pixel sample, coloured by its final palette label, with per-cluster centers (white +) and palette targets (yellow ○) overlaid. **The single most useful image for diagnosing classification problems** — clusters should sit close to their targets, and the four point clouds should be cleanly separated.

#### Structured metrics: `<stem>_debug.json`

Lives at `test-output/<test-name>/debug/<test-name>_debug.json`. JSON with two top-level keys:

- `metrics` — per-step structured data (numbers, arrays, nested objects). Use `jq` for programmatic inspection, e.g.:
  - `jq .metrics.warp.quadScore <stem>_debug.json` — corner detection score (lower is better; > 0.15 logs a warning)
  - `jq .metrics.warp.pass2.cornerErrors <stem>_debug.json` — sub-pixel corner errors after the second refinement pass
  - `jq .metrics.correct.framePostCorrectionP85 <stem>_debug.json` — frame R/G/B post-correction (target #FFFFA5 = R255 G255 B165)
  - `jq .metrics.quantize.clusterCenters <stem>_debug.json` — palette-ordered RG cluster centers from k-means
  - `jq .metrics.quantize.counts.final <stem>_debug.json` — final per-palette pixel counts
- `log` — chronological array of human-readable diagnostic strings, exactly the lines that also appear under "PIPELINE DIAGNOSTICS" in the per-image `.log` file.

Schema by step:

| Step | Key fields |
|------|------------|
| `warp` | `threshold`, `contourArea`, `aspect`, `quadScore`, `sourceCorners`, `pass1.{edgeCurvatures, cornerErrors, refined}`, `pass2.{...}` |
| `correct` | `whiteSamples.{R,G}` (count of frame blocks kept), `whiteSurfaceRange.{R,G}`, `darkSurfaceRange.{R,G}`, `dgCalibrationPixels.{R,G}` (interior DG pixels used in refinement), `framePostCorrectionP85.{R,G,B}` |
| `crop` | `cameraRegion`, `borderMean`, `whiteFrameMean`, `borderToFrameRatio`, `validation` ("ok" \| "warn") |
| `sample` | `ranges.{R,G,B}`, `subpixelCols.{B,G,R}`, `vMargin` |
| `quantize` | `clusterCenters` (palette-ordered), `stripEnsemble.{strips, changed}`, `valleyRefinement.{threshold, changed}`, `counts.{afterGlobalKmeans, afterStripEnsemble, final}` |

#### Enabling debug from the API

In code (e.g. when calling `processPicture()` from a custom script):

```ts
const result = await processPicture(input, { scale: 8, debug: true });
// result.intermediates: { warp, correct, crop, sample } — RGBA GBImageData each
// result.debug.images:  Record<string, GBImageData> — keyed by debug-image name
//                       (e.g. "warp_a_corners", "quantize_c_rg_scatter")
// result.debug.log:     string[] — chronological diagnostic lines
// result.debug.metrics: Record<step, Record<key, value>> — structured metrics
```

Both `pnpm test:pipeline` and the sample-pictures portion of the same script always run with `debug: true`; the standalone `pnpm extract` script does not currently surface debug output.

### Website

Development server:

```bash
pnpm dev
```

Or directly:

```bash
cd packages/gbcam-extract-web && pnpm dev
```

Deploys to GitHub Pages on push to `production` branch.

## Execution Environment

Python scripts must be run inside the `.venv` at `packages/gbcam-extract-py/.venv`. Always activate it before running Python scripts. If packages appear missing, try running in the `.venv` before taking further steps.

## Input Image Characteristics

The input is a phone photo of a Game Boy Camera image displayed on a Game Boy Advance SP screen. The photo is roughly taken and includes the screen plus some surrounding dark bezel. Key characteristics:

### Screen Structure (outermost to innermost)

1. **Dark bezel** — the GBA SP housing around the screen, appearing as uneven dark areas due to the front-light.
2. **Game Boy Screen** (160x144 SP pixels) — contains:
   - A 16-pixel-thick frame on each side. The frame is primarily #FFFFA5 (white) with a one-pixel-thick inner border in #9494FF (dark gray). The frame has black dashes running through it: 17 horizontal dashes along top/bottom (5 pixels from outer edge) and 14 vertical dashes along left/right sides (1 pixel from outer edge). Corner dashes are fused.
   - `supporting-materials/Frame 02.png` is a 160x144 grayscale palette-swapped reference of the exact frame. The grayscale-to-color mapping is: #FFFFFF -> #FFFFA5, #A5A5A5 -> #FF9494, #525252 -> #9494FF, #000000 -> #000000.
   - `supporting-materials/frame_ascii.txt` is an ASCII art version (` ` = white, `·` = light gray, `▓` = dark gray, `█` = black).
3. **Game Boy Camera image** (128x112 SP pixels) — the actual picture to extract, displayed in four colors: #FFFFA5, #FF9494, #9494FF, #000000.

### Image Quality Issues

- **Perspective distortion** — the phone is not perfectly aligned; the screen appears as an irregular quadrilateral with lens distortion.
- **Washed out / tinted colors** — the GBA SP front-light brightens and slightly blue-tints the screen.
- **Uneven brightness gradient** — the side-mounted front-light creates a smooth 2D brightness gradient. Both black floor and white ceiling shift together (affine per-pixel).
- **Pixel gaps** — thin dark vertical lines between LCD pixel columns, and less prominent horizontal lines between rows. Especially visible in darker areas.
- **Pixel bleeding** — brighter pixels bleed light into adjacent dimmer pixels, especially vertically.
- **Sub-pixel colors** — TN LCD sub-pixels (blue left, green middle, red right) cause color alignment artifacts within each pixel.

### Output Palette

The pipeline outputs 128x112 images using four grayscale values:

- `0` = BK (black, #000000)
- `82` = DG (dark gray, #9494FF on screen)
- `165` = LG (light gray, #FF9494 on screen)
- `255` = WH (white, #FFFFA5 on screen)

Test reference images in `test-input/` use this same grayscale palette.

## Pipeline Steps

The pipeline runs five steps in order: **warp -> correct -> crop -> sample -> quantize**.

### 1. Warp (`warp.ts` / `gbcam_warp.py`)

Detects the four corners of the white filmstrip frame using brightness thresholding and contour analysis. Applies a perspective warp to produce a (160 x scale) x (144 x scale) image (default 1280x1152 at scale=8). Includes a two-pass inner-border refinement that back-projects corrected corners and re-warps.

- Input: phone photo (.jpg / .png, any size)
- Output: `<stem>_warp.png` — (160 x scale) x (144 x scale) grayscale

### 2. Correct (`correct.ts` / `gbcam_correct.py`)

Compensates for the front-light brightness gradient. Samples the four filmstrip frame strips for white reference and the four inner border bands for dark reference. Fits degree-2 bivariate polynomials for white and dark surfaces. Applies per-pixel affine correction: `corrected = clip((observed - offset) / gain, 0, 255)`. Optionally performs iterative refinement using confident dark-gray interior pixels.

- Input: `<stem>_warp.png`
- Output: `<stem>_correct.png` — same dimensions, brightness-normalized

### 3. Crop (`crop.ts` / `gbcam_crop.py`)

Removes the filmstrip frame, keeping only the 128x112 camera area. Extracts the region starting at GB pixel (16, 16) with dimensions 128x112, in image-pixel coordinates.

- Input: `<stem>_correct.png`
- Output: `<stem>_crop.png` — (128 x scale) x (112 x scale) grayscale

### 4. Sample (`sample.ts` / `gbcam_sample.py`)

Reduces each (scale x scale) block to a single brightness value. Samples only the interior of each block, skipping margin pixels on each side to avoid pixel-gap and bleeding artifacts.

- Input: `<stem>_crop.png`
- Output: `<stem>_sample.png` — 128x112 grayscale (raw brightness values 0-255)

### 5. Quantize (`quantize.ts` / `gbcam_quantize.py`)

Maps 128x112 brightness samples to the four GB palette colors (0/82/165/255). Uses k-means clustering to find the four brightness clusters, then assigns thresholds at cluster midpoints.

- Input: `<stem>_sample.png`
- Output: `<stem>_gbcam.png` — 128x112, values exactly 0/82/165/255

## Goal

The primary goal is to improve the pipeline's accuracy at transforming phone photos into faithful Game Boy Camera images. Run the test suite to track progress — it compares output pixel-by-pixel against hand-corrected reference images and reports per-color accuracy and confusion matrices.

8. Save the Game Boy Camera picture file as a png.

9. Palette swap the Game Boy Camera picture to the grayscale palette and save as a png.

## Frontend Conventions (gbcam-extract-web)

The web package uses shadcn/ui (preset `b2UrMghYe` — nova style, fuchsia
accent, neutral base, base primitives, RTL enabled). Installed components
live under `src/shadcn/{components,hooks,utils}` to keep them isolated from
app code.

### Working with shadcn

- **Use existing shadcn components rather than reinventing.** Need a
  collapsible panel? Use `<Collapsible>` — don't build a custom
  button-and-arrow toggle. Need a toast? Use `sonner`. Need a confirmation?
  Use `<Dialog>` / `<AlertDialog>`.
- **List available components:** `pnpm shadcn search @shadcn` (add
  `-q "<query>"` to filter). Component docs: `pnpm shadcn docs <name>`.
- **Add a new component:** `pnpm shadcn add <name>` from
  `packages/gbcam-extract-web/`. Each new add gets its own commit.
- **Don't edit installed shadcn files.** They live under `src/shadcn/` and
  should match what the CLI installed. If you absolutely must edit one:
  prefix the changed lines with `// CUSTOM: <reason>`, stage the change,
  and surface the edit for review before continuing.

### Styling rules

- **Semantic color tokens only.** `bg-background`, `bg-card`,
  `text-foreground`, `text-muted-foreground`, `bg-primary`, `bg-destructive`,
  etc. No raw Tailwind colors like `bg-blue-600` or `text-gray-400`. Theme
  variables drive light/dark.
- **Logical Tailwind classes (RTL-safe).** Use `ms-*`/`me-*`, `ps-*`/`pe-*`,
  `start-*`/`end-*`, `text-start`/`text-end`. Avoid `ml-*`/`mr-*`/`pl-*`/
  `pr-*`/`text-left`/`text-right`.
- **Use `gap-*` with flex/grid**, not `space-x-*`/`space-y-*`.
- **`cn()` from `@/shadcn/utils/utils`** for conditional classes.
- **Always use lucide-react icons. Never use emojis.** Every UI icon —
  chevrons, status indicators, button affordances — must be a `lucide-react`
  component. Inside `<Button>` use `data-icon="inline-start"` /
  `data-icon="inline-end"`. No icon size classes inside components. Icon-only
  buttons get `aria-label`.
- **Prefer semantic tokens over `dark:` overrides.** Theme tokens drive
  light/dark. The Tailwind typography plugin's `prose dark:prose-invert` is
  an accepted exception (used in `MarkdownRenderer.tsx`).

### Component composition (base primitives)

- Use `render={<Component />}` to compose triggers (not `asChild` — that's
  the radix variant; we're on base).
- `Select` requires an `items` array prop on the root. Placeholder = a
  `{ value: null, label: "..." }` entry.
- `Accordion` uses `multiple` boolean and array `defaultValue` (no `type`).
- Forms: wrap controls in `<FieldGroup>`/`<Field>`/`<FieldLabel>`/`<Input>`.
  Validation: `data-invalid` on `Field`, `aria-invalid` on the control.
- `Card`: full composition (`CardHeader`/`CardTitle`/`CardContent`/
  `CardFooter`) rather than dumping everything in `CardContent`.

### Theming

- Theme via `next-themes`: `<ThemeProvider attribute="class"
  defaultTheme="system">`.
- Mode toggle in the App header (`<ModeToggle>` — light/dark/system).
- Theme-aware app icon: read `useTheme().resolvedTheme` and switch
  `icon.svg` ↔ `icon-dark.svg` (matching `icon.png`/`icon-dark.png`).
- Favicon: media-query `<link>` pair in `index.html` plus a JS swap effect
  for the in-app override case.

### State persistence

- All localStorage access goes through `useLocalStorage<T>(key, initial)`
  from `src/hooks/useLocalStorage.ts`. Don't write to `localStorage`
  directly from components.
- Existing keys (`gbcam-app-settings`, `gbcam-instructions-open`,
  `gbcam-image-history`, `gbcam-history-settings`, `gbcam-user-palettes`,
  `gbcam-palette-sections-expanded`) are preserved. `next-themes` manages
  its own `theme` key.
