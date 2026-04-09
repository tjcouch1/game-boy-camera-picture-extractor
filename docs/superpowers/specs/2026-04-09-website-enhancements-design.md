# Website Enhancements Design

**Date:** 2026-04-09
**Scope:** Five independent feature additions to the gbcam-extract-web package

---

## Overview

This design addresses five enhancements to the Game Boy Camera Picture Extractor web app:

1. **Palette CSV-driven architecture** — derive palettes from color table CSVs instead of hardcoded values
2. **Draft custom palette** — allow users to experiment with custom colors with auto-save and persistence
3. **Enhanced progress indication** — show both overall progress and per-image pipeline step
4. **Share button** — native platform share + copy-to-clipboard functionality
5. **Local test server** — serve the built website locally to test PWA and offline behavior

---

## 1. Palette CSV-Driven Architecture

### Current State

`palettes.ts` exports three hardcoded palette arrays:
- `BUTTON_COMBO_PALETTES` (12 entries)
- `BG_PRESETS` (16 entries)
- `ADDITIONAL_PALETTES` (12 entries, mixed sources)

### Design

**CSV Files:**
- Three CSVs in `supporting-materials/color-tables/`:
  - `game-boy-camera-palettes.csv` — 29 BG palettes (0x00-0x1C) with optional button combo labels
  - `game-boy-color-additional-palettes.csv` — 10 OBJ0/OBJ1 additional palettes
  - `game-boy-color-fun-palettes.csv` (new) — novelty palettes (OBJ0/OBJ1 Classic, DMG Green, Pocket, Light, Kiosk, SGB 1A-4A, Grayscale, Inverted)

**Generation Process:**
- Create `scripts/generate-palettes.ts` that:
  - Reads the three CSVs using a CSV parser (e.g., `csv-parse` or simple string splitting)
  - Generates `src/data/palettes-generated.ts` with raw palette data
  - Includes button combo metadata where applicable
- Run as part of `pnpm build` or before it

**Integration:**
- `palettes.ts` imports from `palettes-generated.ts` and exports transformed data:
  - `BUTTON_COMBO_PALETTES` — filtered from main CSV where button combo is present
  - `BG_PRESETS` — BG palettes from main CSV
  - `ADDITIONAL_PALETTES` — from additional CSV
  - `FUN_PALETTES` — from fun CSV
  - `ALL_PALETTES` — combined
- Downstream imports remain unchanged; API is identical

**First-Time Setup:**
- Before first build, create the `game-boy-color-fun-palettes.csv` file with the novelty palette definitions

---

## 2. Draft Custom Palette Feature

### Current State

Users can already create and save custom palettes. This feature augments that by allowing a temporary "draft" palette that auto-saves.

### Design

**State Tracking:**
- Extend the existing custom palette hook (or create a new one) to track:
  - Current selected palette (name or ID)
  - Draft palette colors ([r, g, b, black] hex string tuple, or null if no draft)
  - Saved custom palettes (existing)
- Draft persists in localStorage: `gbcam_draft_palette`

**User Workflow:**

1. **No draft exists:**
   - Clicking a preset palette: updates preview colors only
   - Creating a draft: initializes it with colors from the currently selected palette
   - Accessing the existing custom palette editor to build a draft

2. **Draft exists:**
   - Clicking a preset palette: updates preview colors, but does not modify the draft
   - Clicking "Draft" option: opens the existing custom palette editor with draft colors
   - As user edits: auto-save to draft localStorage
   - Delete button: removes draft, reverts to previously selected non-draft palette
   - Save button: converts draft → permanent custom palette

**UI Updates:**
- `PalettePicker` adds a "Draft" option (visible only when draft exists) with a visual indicator (e.g., "✏️ Draft")
- Reuse existing custom palette editor; no new UI needed
- Add delete draft button to the editor

**Data Persistence:**
- Draft auto-saves on every color change
- Page refresh preserves draft
- Clearing browser storage clears draft

---

## 3. Enhanced Progress Indication

### Current State

During processing, the UI shows: `Processing: <currentStep>...` without indicating total images or overall progress.

### Design

**Tracked State:**
- `totalImages` — number of images queued for processing
- `completedImages` — number finished
- `currentImageProgress` — object with:
  - `filename` (string)
  - `currentStep` (string: "Warp", "Correct", "Crop", "Sample", "Quantize")
  - `index` (number, for "X of Y" display)
- `progress` — overall percentage (0-100)

**Hook Changes:**
- `useProcessing` updates to emit step progress as each image moves through the pipeline
- Track completion per image, not just per step

**UI Changes:**
- Replace current `LoadingBar` with dual indicators:
  - **Overall progress bar:** Shows "X of Y images" (e.g., "3 of 8")
  - **Current step indicator:** Shows filename and current pipeline step (e.g., "photo.jpg: Quantizing...")
- When processing completes, show final summary (e.g., "8 of 8 images processed")

**Implementation Details:**
- Pipeline execution likely already moves through steps sequentially; hook needs to emit state updates per step
- Progress bar shows overall completion; step text shows what's currently happening

---

## 4. Share Button

### Design

**Two Buttons per Result Card:**

1. **Share button:**
   - Uses Web Share API (`navigator.share()`)
   - Triggers native platform share dialog (Android/iOS/web options)
   - Shares the processed image file with filename as title
   - Fallback: graceful degradation on unsupported platforms (button disabled or hidden)

2. **Copy to Clipboard button:**
   - Uses Clipboard API to copy image blob
   - User can paste into emails, messages, or other apps
   - Visual feedback (e.g., "Copied!" toast) on success

**Image Data:**
- Shares the processed result image (already rendered and available as canvas/blob)
- No metadata or palette info included; the image already has colors applied

**Button States:**
- Disabled during processing
- Enabled when result is ready
- Share button only visible/enabled on platforms with Web Share API support (or always show with graceful fallback)

---

## 5. Local Test Server

### Purpose

Serve the built website locally to test PWA functionality, offline mode, and deployment behavior before pushing to GitHub Pages.

### Design

**Script:**
- Create `scripts/serve-dist.ts` that:
  - Builds the website (`pnpm build`)
  - Starts an HTTP server on localhost (port auto-selected or configurable, e.g., 3000)
  - Serves from `dist/` directory
  - Prints the local URL to console
- Use a lightweight HTTP server package (e.g., `http-server`, `vite preview`, or similar)

**npm Script:**
- Add `pnpm serve` in the web package to run the script

**Usage Workflow:**
1. Developer runs `pnpm serve` from the web package
2. Opens the printed URL in browser
3. Tests PWA, offline behavior, assets, etc.
4. Can disable network in DevTools to simulate offline
5. Stops with Ctrl+C

**Optional Enhancements (future):**
- Basic smoke tests to verify index.html loads, key assets exist
- Not required for initial implementation

---

## Implementation Breakdown

### Order of Implementation

1. **Palette CSV architecture** — foundation for later features
2. **Draft custom palette** — independent feature
3. **Enhanced progress** — independent feature
4. **Share button** — independent feature
5. **Local test server** — independent script

All except #1 can be done in parallel once #1 is merged.

### Files to Create/Modify

**New Files:**
- `supporting-materials/color-tables/game-boy-color-fun-palettes.csv`
- `scripts/generate-palettes.ts`
- `src/data/palettes-generated.ts` (generated)
- `scripts/serve-dist.ts`

**Modified Files:**
- `src/data/palettes.ts`
- `src/hooks/useProcessing.ts` (or new hook)
- `src/components/PalettePicker.tsx`
- `src/components/ResultCard.tsx`
- `src/App.tsx` (progress UI)
- `package.json` (add npm scripts)

---

## Success Criteria

- [ ] All palettes load correctly from CSVs on build
- [ ] Draft palette persists across page refresh
- [ ] Draft auto-saves as colors change
- [ ] Progress bar shows total images and current step
- [ ] Share button appears and functions on supported platforms
- [ ] Copy to clipboard button works
- [ ] Local server builds and serves the site correctly
- [ ] PWA works offline when served locally
- [ ] No regressions in existing functionality

---

## Notes

- The draft palette feature leverages the existing custom palette editor; no new UI needed beyond the draft option and delete button
- Progress tracking may require examining the pipeline's step emission—ensure we can hook into per-step events
- Share button gracefully degrades on unsupported platforms
- Palette generation is deterministic (same CSV input = same output each build)
