# Game Boy Camera Picture Extractor — Web App Design Spec

## Overview

Transform the existing Python-based Game Boy Camera picture extraction pipeline into a static web application hosted on GitHub Pages. The app accepts phone photos of Game Boy Camera images on a Game Boy Advance SP screen and outputs clean 128x112 pixel images in selectable color palettes.

The approach is a TypeScript port of the pipeline using opencv.js for geometry/vision operations, with a React + Vite PWA frontend. A Pyodide fallback plan is documented in case the TypeScript port cannot achieve sufficient accuracy.

## Monorepo Structure

```
game-boy-camera-picture-extractor/
├── packages/
│   ├── gbcam-extract-py/            # Existing Python pipeline (moved)
│   │   ├── gbcam_extract.py
│   │   ├── gbcam_warp.py
│   │   ├── gbcam_correct.py
│   │   ├── gbcam_crop.py
│   │   ├── gbcam_sample.py
│   │   ├── gbcam_quantize.py
│   │   ├── gbcam_common.py
│   │   ├── run_tests.py
│   │   ├── test_pipeline.py
│   │   ├── requirements.txt
│   │   └── ... (analysis/debug/visualize scripts, .venv)
│   │
│   ├── gbcam-extract/               # TypeScript extraction pipeline
│   │   ├── src/
│   │   │   ├── index.ts             # Public API: processPicture(), Pipeline class
│   │   │   ├── warp.ts              # 1:1 port of gbcam_warp.py
│   │   │   ├── correct.ts           # 1:1 port of gbcam_correct.py
│   │   │   ├── crop.ts              # 1:1 port of gbcam_crop.py
│   │   │   ├── sample.ts            # 1:1 port of gbcam_sample.py
│   │   │   ├── quantize.ts          # 1:1 port of gbcam_quantize.py
│   │   │   ├── common.ts            # Constants, types, shared utilities
│   │   │   ├── palette.ts           # Palette swap (post-pipeline, instant)
│   │   │   └── opencv.ts            # opencv.js wrapper/init + Mat memory helpers
│   │   ├── tests/
│   │   │   ├── pipeline.test.ts     # Pixel-accuracy tests mirroring Python suite
│   │   │   └── ...
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   └── gbcam-extract-web/           # React + Vite frontend (PWA)
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   ├── hooks/
│       │   └── ...
│       ├── public/
│       │   ├── opencv.js            # opencv.js Wasm (cached by service worker)
│       │   └── manifest.json
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── index.html
│
├── supporting-materials/            # Shared (Frame 02.png, frame_ascii.txt, color-tables/)
├── sample-pictures/                 # Shared sample inputs
├── test-input/                      # Shared test images + reference images
├── test-output/                     # Generated (gitignored)
├── docs/
├── AGENTS.md
├── README.md
├── package.json                     # Workspace root
└── pnpm-workspace.yaml             # packages: ["packages/*"]
```

Shared assets (`supporting-materials/`, `sample-pictures/`, `test-input/`) remain at the repo root since they are referenced by both `gbcam-extract-py` and `gbcam-extract` for testing. Moving files into `packages/gbcam-extract-py` will require updating file paths in the Python scripts.

## TypeScript Pipeline (`gbcam-extract`)

### Public API

```typescript
// Framework-agnostic image type (compatible with browser ImageData but
// does not depend on DOM APIs, so it works in Node.js tests too)
interface GBImageData {
  data: Uint8ClampedArray;     // RGBA pixel data
  width: number;
  height: number;
}

interface PipelineResult {
  grayscale: GBImageData;      // 128x112, 4-value grayscale (0/82/165/255)
  intermediates?: {            // Only populated when debug mode is on
    warp: GBImageData;         // 1280x1152 (160*8 x 144*8)
    correct: GBImageData;
    crop: GBImageData;
    sample: GBImageData;
  };
}

interface PipelineOptions {
  scale?: number;              // Working scale (default 8)
  debug?: boolean;             // Capture intermediate step results
  onProgress?: (step: string, pct: number) => void;
}

async function processPicture(
  input: GBImageData,
  options?: PipelineOptions
): Promise<PipelineResult>;

// Palette swap — instant, no pipeline re-run
function applyPalette(
  grayscale: GBImageData,
  palette: [string, string, string, string]  // 4 hex colors, lightest to darkest
): GBImageData;

// Must be called once before any processing.
// Loading is handled internally — no path or module argument needed.
async function initOpenCV(
  onProgress?: (pct: number) => void
): Promise<void>;
```

`GBImageData` is structurally compatible with the browser's `ImageData` — you can pass a browser `ImageData` directly and it satisfies the interface. This avoids a DOM dependency in the pipeline package while keeping zero-cost interop in the web app.

### Dependencies

- **opencv.js** (~4-8MB Wasm) — perspective transforms (`getPerspectiveTransform`, `warpPerspective`, `perspectiveTransform`), contour detection (`findContours`, `approxPolyDP`, `contourArea`, `arcLength`, `convexHull`, `boundingRect`), morphology (`morphologyEx`), thresholding (`threshold`), color conversion (`cvtColor`), kmeans (`kmeans`), and basic drawing for debug output.
- **`ml-regression-polynomial`** (~5KB) — polynomial fitting for color correction. Replaces `numpy.polyfit`. Chosen because it's small, well-tested, and exposes tunable parameters.
- **A small library for 1D signal filtering** — replaces `scipy.ndimage.gaussian_filter1d` and `scipy.ndimage.uniform_filter1d`. Specific library to be evaluated during implementation; the key criterion is matching scipy's output including edge handling and boundary conditions.
- No other runtime dependencies.

### Step-by-Step Port Mapping

| Python module | TypeScript module | Key changes |
|---|---|---|
| `gbcam_warp.py` (784 lines) | `warp.ts` | cv2 calls → opencv.js with Mat tracking wrapper |
| `gbcam_correct.py` (972 lines) | `correct.ts` | `numpy.polyfit` → `ml-regression-polynomial`; `scipy.ndimage` filters → library TBD |
| `gbcam_crop.py` (143 lines) | `crop.ts` | Simplest step — array slicing on typed arrays |
| `gbcam_sample.py` (306 lines) | `sample.ts` | NumPy array ops → typed array operations |
| `gbcam_quantize.py` (280 lines) | `quantize.ts` | `sklearn.KMeans` → `cv.kmeans` from opencv.js |
| `gbcam_common.py` (181 lines) | `common.ts` | Constants + TypeScript types + shared utilities |

### opencv.js Memory Management

Every function that creates opencv.js Mats uses a tracking wrapper to ensure cleanup:

```typescript
function withMats<T>(fn: (track: <M extends { delete(): void }>(m: M) => M) => T): T {
  const allocated: { delete(): void }[] = [];
  const track = <M extends { delete(): void }>(m: M) => { allocated.push(m); return m; };
  try { return fn(track); }
  finally { allocated.forEach(m => m.delete()); }
}
```

Mats that need to survive (return values) are explicitly excluded from tracking before the finally block. This pattern is applied consistently across all pipeline steps.

### Testing (Vitest)

- Loads test images from `../../test-input/` (shared repo root)
- Runs each of the 6 test images through the TypeScript pipeline
- Compares output pixel-by-pixel against the reference images (`*-output-corrected.png`)
- **Pass threshold: 100% pixel match with reference image**
- The goal of the port is faithful algorithm translation so accuracy numbers match what the Python pipeline achieves; both pipelines will continue to be improved toward the 100% target over time
- Unit tests for individual pipeline steps where useful
- opencv.js loaded in Node.js via Wasm loader for CI compatibility

## Web App (`gbcam-extract-web`)

### Tech Stack

- React 19 + Vite + TypeScript
- Tailwind CSS + shadcn/ui
- `vite-plugin-pwa` (Workbox) for service worker and offline support
- pnpm workspace dependency on `gbcam-extract`

### App Flow

1. **Initial load** — App shell renders immediately. opencv.js downloads in the background with a visible progress bar. The upload/camera UI is visible but disabled until opencv.js is ready.
2. **Ready state** — Progress bar completes and disappears. Processing UI enables.
3. **Input** — Three methods, all available:
   - **File picker** — single or multiple image selection
   - **Camera capture** — `<input accept="image/*" capture="environment">` for mobile
   - **Drag-and-drop** — drop zone for desktop use
4. **Processing** — Each image runs through the pipeline with a progress indicator showing the active step (warp → correct → crop → sample → quantize).
5. **Results** — Shows the final 128x112 output image per input. User can:
   - **Change palette** — select from presets or custom colors; applied instantly without re-running the pipeline
   - **Download** — individual images or batch as zip
   - **View intermediates** — available only if debug mode was on when the image was processed (see below)
6. **Batch** — Multiple images shown in a scrollable list/grid. Palette changes can apply to all or individually.

### Debug Mode

A toggle switch in the UI enables/disables debug mode. When off (default), the pipeline does not allocate or store intermediate step images, keeping memory usage low. When on, intermediates are captured for subsequent runs and can be expanded/collapsed in the results view.

This matters because intermediates are large (~5.6MB for the warp step alone, ~22MB total per image), which adds up in batch mode and on mobile devices.

### Palette System

The palette UI allows users to swap the 4-color grayscale output to any 4-color palette. This is an instant client-side remap — no pipeline re-run needed.

**Palette organization (top to bottom):**

1. **User-created palettes** — custom palettes the user has saved. Persisted to localStorage. Can be deleted.
2. **Button combo presets** — palettes from `game-boy-camera-palettes.csv` that have a button combo (e.g., "Right", "A + Down"). These are the most recognizable to Game Boy users.
3. **BG presets without button combo** — remaining entries from `game-boy-camera-palettes.csv`.
4. **Additional palettes** — entries from `game-boy-color-additional-palettes.csv` (OBJ0/OBJ1 layers).

Each preset displays:
- A 4-color swatch preview
- The button combo label (if applicable) or table entry identifier
- The table entry hex code

**Custom palette creation:**
- 4 color pickers (lightest → darkest)
- Save with a user-chosen name
- Saved palettes appear at the top of the list and persist across sessions (localStorage)
- Deletable

**Palette data:** The 29 BG palettes and 10 additional palettes are parsed from the CSV files and bundled at build time (not fetched at runtime).

### Mobile Considerations

- Single-column responsive layout
- Large touch targets for camera capture and upload buttons
- Results scroll vertically
- Palette picker works as a bottom sheet or modal on small screens
- Debug mode toggle easily accessible but not prominent

### State Management

React state + context only. One context for opencv.js readiness state, component-level state for everything else. The app is not complex enough to warrant an external state library.

## Build, Deploy & Offline

### pnpm Workspace

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

Root `package.json` defines the workspace. Each package has its own `package.json` and `tsconfig.json`. A shared base `tsconfig.json` at the root is extended by the TypeScript packages.

### Build Chain

- **`gbcam-extract`** — built with `tsup` (or `tsc`) to ESM. Consumed by the web app as a workspace dependency (no npm publishing needed).
- **`gbcam-extract-web`** — built with Vite. Imports from `gbcam-extract` directly via pnpm workspace resolution. Outputs static files to `dist/`.
- **`gbcam-extract-py`** — no build step. Python files moved into place with updated paths.

### Deployment

- **Trigger:** GitHub Actions workflow on push to `production` branch
- **Steps:** Install pnpm, install deps, build pipeline package, build web package, deploy `packages/gbcam-extract-web/dist/` to GitHub Pages
- Works with default `username.github.io/repo-name` path; custom domain optional

### PWA / Offline

- `vite-plugin-pwa` with Workbox precaching
- **Precache manifest includes:** app shell (HTML/CSS/JS bundles), opencv.js + Wasm binary, manifest.json, app icons
- **Total precache size:** ~10-12MB (dominated by opencv.js)
- Fully functional offline after first visit
- **Update flow:** When a new version is deployed, the service worker detects the change and shows an "Update available" prompt. User taps to refresh and get the new version.

### CI Testing

- GitHub Actions runs `pnpm test` in `packages/gbcam-extract` on push/PR
- Test images are committed to `test-input/` and available in CI
- opencv.js loads in Node.js for headless test execution

## Appendix: Pyodide Fallback Plan

If the TypeScript port cannot achieve sufficient accuracy, the pipeline implementation can be swapped to run Python directly in the browser via Pyodide.

### What Changes

- `packages/gbcam-extract` internals are replaced with a Pyodide wrapper that loads the Python interpreter in Wasm
- The Python files from `packages/gbcam-extract-py` are bundled as string assets
- An opencv.js shim bridges `cv2` calls to opencv.js (since opencv-python is not available in Pyodide)
- NumPy, SciPy, and scikit-learn are loaded as Pyodide packages (~40-50MB additional download)
- Total bundle increases from ~10-12MB to ~60-80MB

### What Stays the Same

- The web app (`gbcam-extract-web`) — same UI, same API contract with the pipeline package
- The monorepo structure
- The PWA setup and deployment pipeline
- The palette system
- The test suite (runs against the Pyodide-wrapped pipeline instead)

### When to Pivot

- If after porting, the TypeScript pipeline's accuracy is significantly worse than Python on multiple test images AND the root cause traces to numerical precision issues in the math libraries rather than porting bugs (which the test suite would catch)
- **Before pivoting:** Make multiple serious attempts to improve the TypeScript implementation — try alternative libraries, adjust numerical approaches, debug against the Python output to understand exactly where divergence occurs
- **MUST ask the user before pivoting.** Do not switch to the Pyodide approach without explicit user approval, regardless of how many attempts have been made

### Why This Pivot is Low-Risk

The pipeline package exposes a clean API (`processPicture(input) → result`). The web app depends only on this interface. Swapping the implementation behind the API does not require any changes to the frontend, palette system, PWA setup, or deployment.
