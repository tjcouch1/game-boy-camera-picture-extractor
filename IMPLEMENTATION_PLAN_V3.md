# Implementation Plan - Web App Improvements (V3)

## Overview

This plan addresses palette management issues, UI selection states, persistence features, and progress tracking improvements.

---

## Phase 1: Palette Naming and Selection

### 1.1 Fix Palette Naming Logic

**File**: `packages/gbcam-extract-web/src/hooks/useUserPalettes.ts`

- **Issue**: Creating new palettes from existing custom palettes keeps appending ` custom 1` instead of incrementing the number
- **Fix**: Update `createPaletteInEditMode()` to detect if the source name already ends with ` custom #` pattern
  - If it does, extract the number and increment it
  - If it doesn't, start with ` custom 1`
- **Expected behavior**:
  - Base palette `0x01` → `0x01 custom 1`
  - From `0x01 custom 1` → `0x01 custom 2`
  - From `0x01 custom 2` → `0x01 custom 3` (not `0x01 custom 2 custom 1`)

### 1.2 Select New Palette on Creation

**File**: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

- **Issue**: When `+ Custom` is clicked, the new palette is not selected
- **Fix**: After creating new palette with `handleCreateCustom()`, also call `onSelectWithName()` with the new palette's colors
- **Expected behavior**: New custom palette is immediately selected and visible in the main preview

### 1.3 Unify Palette Selection State

**File**: `packages/gbcam-extract-web/src/components/PalettePicker.tsx` and `packages/gbcam-extract-web/src/App.tsx`

- **Issue**: Edit palettes are tracked separately (`selectedEditingPaletteId`) from the main palette selection, causing multiple palettes to appear "selected"
- **Fix**:
  - Remove `selectedEditingPaletteId` state from PalettePicker
  - When a user palette is clicked, always call `onSelectWithName()` to update the app's main palette selection
  - Palettes in edit mode should show both the "semi-selected" state (blue-ish background) AND the main selection blue ring
  - Only one palette in the entire list should have the blue ring (`ring-2 ring-blue-400`)
- **Expected behavior**:
  - Only one palette has the bright blue ring at any time
  - Editing a palette doesn't remove its selection status
  - When you cancel editing, selection returns to that palette in the user list

---

## Phase 2: Visual Consistency and Styling

### 2.1 Edit Palette Text Color

**File**: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

- **Issue**: Text in editing palette swatches doesn't contrast well against the blue background
- **Fix**:
  - Extract text color styling into a shared constant/function
  - Match text color between normal palette swatches and editing palette swatches
  - Use lighter text color (e.g., `text-white` or `text-gray-100`) for better contrast
- **Expected behavior**: Editing palette text is as readable as normal palette text

### 2.2 User Palette Selection Visual

**File**: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

- **Issue**: User palettes don't show the bright blue and outline when selected (like built-in palettes do)
- **Fix**: Apply same `isSelected` styling logic to user palettes as built-in palettes
- **Expected behavior**: User palettes have the same visual selection ring as built-in palettes

---

## Phase 3: Image Updates on Palette Changes

### 3.1 Update Images When Edit Palette Changes

**File**: Multiple (PalettePicker, App, ResultCard)

- **Issue**: When you select an edit palette and change its colors, the output images don't update
- **Fix**:
  - Add a callback when editing palette colors change
  - Call `onSelectWithName()` with updated colors on every color change in edit mode
  - ResultCard should already update since it depends on the `palette` prop
- **Expected behavior**: Images update immediately as you adjust edit palette colors

---

## Phase 4: Progress Bar Accuracy

### 4.1 Fix Progress Calculation

**File**: `packages/gbcam-extract-web/src/hooks/useProcessing.ts`

- **Issue**: Progress shows negative percentages and incorrect values
- **Fix**: Review `calculateOverallProgress()` function
  - The issue is likely in how `currentStepIndex` is calculated (PIPELINE_STEPS.indexOf may return -1 for initial state)
  - Ensure step index is properly bounded (use `Math.max(0, currentStepIndex)`)
  - Verify progress ranges from 0 to 100 with no negative values
  - Test with 1 image and 2+ images
- **Expected behavior**:
  - Single image: 0% → 100%
  - Multiple images: Smooth linear progression across all images

---

## Phase 5: Persistence and State Management

### 5.1 Persist Palette Section Visibility

**File**: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

- **Issue**: Palette section hides when no images are added; collapsed state is not persisted
- **Fix**:
  - Store expansion state of each section in localStorage (key: `gbcam-palette-sections-expanded`)
  - Load and restore state on mount
  - Save state whenever any section is toggled
  - Make palette section always visible (don't hide based on results)
- **Expected behavior**:
  - Palette picker visible even without images
  - Folding state remembered between sessions

### 5.2 Persist Output Images

**File**: `packages/gbcam-extract-web/src/App.tsx` and `packages/gbcam-extract-web/src/hooks/useProcessing.ts`

- **Issue**: Output images are lost on page refresh
- **Fix**:
  - Store processing results in localStorage
  - Only store the output data (grayscale image), not debug images or source images
  - Load results on mount and restore to state
  - Clear stored results when processing new batch
  - Consider data size limits (localStorage ~5-10MB per site; be conservative)
- **Storage structure**: `gbcam-results` = JSON array of `{ filename, processingTime, grayscaleImageData }`
- **Expected behavior**:
  - Output images persist across page refresh
  - Processing can be done, refresh page, palette changed without losing images
  - Original input images are not stored (only output data)

---

## Phase 6: Image History

### 6.1 Move Old Results to History Section

**File**: `packages/gbcam-extract-web/src/App.tsx` and new `useImageHistory.ts` hook

- **Issue**: No way to see previous batches of processed images
- **Fix**:
  - When new batch is processed, move current results to history
  - Create new `useImageHistory()` hook to manage history state
  - History is stored separately from current results
  - Default capacity: 10 images total (can be configured)
  - Storage: `gbcam-image-history` and `gbcam-history-settings`
- **Expected behavior**:
  - Process image batch A (shows in "Current Results")
  - Process image batch B (A moves to "Image History", B shows in "Current Results")
  - History section is collapsed by default
  - Can expand to see all historical results

### 6.2 Delete Button on Result Cards

**File**: `packages/gbcam-extract-web/src/components/ResultCard.tsx`

- **Issue**: No way to delete individual results
- **Fix**:
  - Add delete button (✕ or trash icon) to top-right of each result card
  - Pass `onDelete` callback prop
  - Call callback with filename when delete is clicked
  - ResultCard calls up to App/History to remove from appropriate list
- **Expected behavior**:
  - Delete button removes result from current results or history
  - Images reflow to fill space

### 6.3 Delete All History

**File**: `packages/gbcam-extract-web/src/App.tsx`

- **Issue**: No bulk delete for history
- **Fix**:
  - Add "Delete all images in history" button at top of Image History section
  - Only shown when history has items
  - Clears entire history
- **Expected behavior**: Single click clears all historical images

### 6.4 Configure History Capacity

**File**: `packages/gbcam-extract-web/src/hooks/useImageHistory.ts`

- **Issue**: History size is hardcoded; user can't control retention
- **Fix**:
  - Add settings UI in a collapse/modal for history configuration
  - Option: "Keep up to [input] images in history" (default 10)
  - Min: 1, Max: 100
  - Persist in localStorage: `gbcam-history-settings.maxHistorySize`
  - Automatically prune oldest when count exceeds max
- **Expected behavior**:
  - User can increase/decrease how many images are saved
  - Old images auto-delete when limit is exceeded
  - Setting persists across sessions

### 6.5 Persist Image History

**File**: `packages/gbcam-extract-web/src/hooks/useImageHistory.ts`

- **Issue**: History is lost on refresh
- **Fix**:
  - Save history to localStorage on every change
  - Load history on app mount
  - Respect max history size on load (trim if needed)
- **Expected behavior**:
  - Refresh with history intact
  - History auto-prunes to max size on load

---

## Implementation Sequence

### Commit 1: Fix Palette Naming & Selection Logic

- Fix palette naming logic (1.1)
- Select new palette on creation (1.2)
- **File changes**: `useUserPalettes.ts`, `PalettePicker.tsx`

### Commit 2: Unify Selection State & Visual Consistency

- Unify palette selection state (1.3)
- Edit palette text color (2.1)
- User palette selection visual (2.2)
- **File changes**: `PalettePicker.tsx`, `App.tsx`

### Commit 3: Image Updates on Palette Changes

- Update images when edit palette changes (3.1)
- **File changes**: `PalettePicker.tsx`, `App.tsx`

### Commit 4: Fix Progress Bar

- Fix progress calculation logic (4.1)
- **File changes**: `useProcessing.ts`

### Commit 5: Persist Palette Settings

- Persist palette section visibility (5.1)
- **File changes**: `PalettePicker.tsx`

### Commit 6: Persist Output Images

- Persist output images in localStorage (5.2)
- **File changes**: `useProcessing.ts`, `App.tsx`

### Commit 7: Add Image History

- Move old results to history section (6.1)
- Delete button on result cards (6.2)
- Delete all history button (6.3)
- Configure history capacity (6.4)
- Persist image history (6.5)
- **File changes**: `App.tsx`, `ResultCard.tsx`, new `useImageHistory.ts`

---

## Testing Checklist

- [ ] Create palette from "B + Left" → named "B + Left custom 1"
- [ ] Create palette from "B + Left custom 1" → named "B + Left custom 2" (not custom 1 again)
- [ ] Click + Custom → new palette is selected
- [ ] Click user palette → shows blue ring and outline
- [ ] Edit palette colors → results update immediately
- [ ] Progress bar: 0% at start, 100% at end, no negative values
- [ ] Refresh page → palette section still visible and expanded state remembered
- [ ] Refresh page → output images still present
- [ ] Process batch A, then batch B → A moves to history, B in current results
- [ ] Delete individual result card → result removed
- [ ] Delete all history → history cleared
- [ ] Change max history size to 5, process 10 images → only 5 stay
- [ ] Refresh page → history persisted with correct count
- [ ] All localStorage keys cleared on app restart → no stale data
