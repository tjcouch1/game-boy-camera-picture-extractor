# Website Enhancements - Implementation Plan (Revision 2)

**Date:** 2026-04-10  
**Status:** Planning Phase  
**Scope:** Fix progress tracking, improve palette management UX, and move palette generation to gbcam-extract package

---

## Issues to Address

### 1. Progress Bar Shows 100% Per Image
**Problem:** The progress bar currently resets to 100% for each image processed, showing no overall progress across multiple files.  
**Root Cause:** `useProcessing.ts` calculates `overallProgress` as `(completedImages / totalImages)`, which jumps from 0 to 100% when moving between files.  
**Solution:** Track per-file pipeline step progress and blend it with file-level progress to show smooth overall progress.

### 2. Add Palette Name to Downloaded Filenames
**Problem:** Downloaded filenames don't include the palette used (e.g., `"photo_gb.png"` instead of `"photo_0x01_gb.png"`). This makes it hard to track which palette was applied to which output file.  
**Solution:** Add sanitized palette name to the filename before the `_gb.png` suffix. Replace spaces with underscores in palette names.

### 3. User Palette Management Needs Edit Mode
**Problem:** Current system has hardcoded "draft" palette workflow. Need flexible edit mode for any user palette.  
**Requirements:**
- Multiple user palettes can be in edit mode simultaneously
- Edit mode shows color editor and name editor (like create form)
- Palette name based on current selection: `"{PaletteName} custom {#}"` (e.g., `"0x01 custom 1"`)
- Track both current values and saved values per palette
- When palette in edit mode is selected, use current colors, not saved colors
- Edit mode UI: color editor, name editor, save (disabled if invalid), cancel, delete buttons
- Normal mode UI: edit button (instead of X delete button)
- Save validation: name not blank, not duplicate with other user palettes
- Cancel restores saved values
- Delete removes the palette permanently

### 4. Palette Names Should Not Include Button Combo
**Problem:** Palette names like `"0x1A (B + Down)"` are verbose and redundant.  
**Solution:** Update palette generation to only include table entry (e.g., `"0x1A"`).

### 5. Move Palette Generation to gbcam-extract Package
**Problem:** Palette generation currently lives in gbcam-extract-web, making it hard to reuse and maintain.  
**Solution:** Move scripts/generate-palettes.ts to gbcam-extract, export generated palettes from main index, import in web package.

---

## Implementation Plan

### Phase 1: Fix Progress Tracking
**Files to Modify:**
- `packages/gbcam-extract-web/src/hooks/useProcessing.ts`
- `packages/gbcam-extract-web/src/App.tsx`

**Steps:**
1. Enhance progress calculation to track intra-file pipeline progress
   - Add `stepIndex` and `stepCount` to `CurrentImageProgress`
   - Update `overallProgress` formula: `(completedImages + progress_in_current_file) / totalFiles * 100`
2. Modify `processPicture` callback to emit step index info
3. Update `ProgressDisplay` to show more detail (e.g., "Warp 1/5" for current step)

**Expected Outcome:**
- Progress bar shows smooth 0-100% progression across all images
- User sees which step is running and overall position

---

### Phase 2: Add Palette Name to Downloaded Filenames
**Files to Modify:**
- `packages/gbcam-extract-web/src/App.tsx` (downloadResult function)
- `packages/gbcam-extract-web/src/components/ResultCard.tsx` (handleDownload)

**Steps:**
1. Create helper function: `sanitizePaletteName(name: string): string`
   - Replace spaces with underscores
   - Remove special characters if needed (keeping alphanumerics, underscores, hyphens)
2. Update `downloadResult()` signature to accept palette name parameter
3. Update download filename format: `{original_name}_{sanitized_palette_name}_gb.png`
   - Example: `photo.jpg` + `"0x01 custom 1"` → `photo_0x01_custom_1_gb.png`
4. Update ResultCard's `handleDownload()` to pass palette name
5. Update batch download in App.tsx to use new downloadResult signature
6. Test with various palette names including spaces and special characters

**Expected Outcome:**
- Downloaded files include palette name: `thing_1_0x01_custom_1_gb.png`
- Palette name is sanitized (underscores instead of spaces)
- Works for both single and batch downloads

---

### Phase 3: User Palette Edit Mode System
**Files to Create:**
- `packages/gbcam-extract-web/src/hooks/useUserPalettesWithEditMode.ts` (new hook)

**Files to Modify:**
- `packages/gbcam-extract-web/src/components/PalettePicker.tsx`
- `packages/gbcam-extract-web/src/components/ResultCard.tsx` (if needed)
- `packages/gbcam-extract-web/src/App.tsx`

**Hook Design (useUserPalettesWithEditMode):**
```typescript
interface UserPaletteWithEditState {
  index: number;
  entry: PaletteEntry;
  isEditMode: boolean;
  saved: PaletteEntry; // original values
  current: PaletteEntry; // current editing values
}

export function useUserPalettesWithEditMode() {
  const [palettes, setPalettes] = useState<UserPaletteWithEditState[]>(loadFromStorage);
  
  // Actions
  const addPalette(entry): void // add new user palette (not in edit mode initially)
  const enterEditMode(index): void // put palette in edit mode
  const exitEditMode(index): void // close edit mode without saving
  const updateCurrentColors(index, colors): void
  const updateCurrentName(index, name): void
  const savePalette(index): void // save and exit edit mode
  const deletePalette(index): void // permanently delete
  const getCurrentPalette(index): PaletteEntry // return current or saved depending on mode
  
  return {
    palettes,
    addPalette,
    enterEditMode,
    exitEditMode,
    updateCurrentColors,
    updateCurrentName,
    savePalette,
    deletePalette,
    getCurrentPalette,
  };
}
```

**PalettePicker Changes:**
1. Replace `useDraftPalette` with `useUserPalettesWithEditMode`
2. Update `PaletteSwatch` to show edit button (pencil icon) when not in edit mode
3. Update custom palette editor form:
   - Show validation messages (name blank, duplicate name)
   - Disable save button with reason if invalid
   - Add cancel button when in edit mode of existing palette
   - Add delete button in edit mode
4. Remove "✏️ Draft" section entirely
5. User palettes always expanded (or remember expand state per palette)

**App.tsx Changes:**
1. Update `+Custom` button logic:
   - Generate unique name based on current palette (e.g., if "0x01" selected, name = "0x01 custom 1")
   - Create palette with current colors
   - Immediately enter edit mode
2. Use `getCurrentPalette()` when selecting user palettes to get current (editing) or saved values

**Steps:**
1. Create `useUserPalettesWithEditMode` hook
2. Update `PaletteSwatch` component to show conditional buttons
3. Update `PaletteSection` to pass edit/delete handlers
4. Replace draft-related code in PalettePicker with edit mode code
5. Update App.tsx +Custom button logic
6. Test: create palette, edit, cancel, edit again, save

**Expected Outcome:**
- Users can create and edit multiple palettes
- Changes persist until save
- Can abandon edits with cancel
- Edit/delete UI is clear and accessible

---

### Phase 4: Remove Button Combo from Palette Names
**Files to Modify:**
- `packages/gbcam-extract-web/scripts/generate-palettes.ts`

**Steps:**
1. Update palette name generation:
   ```typescript
   // Before:
   const name = `${row["Table Entry"]} ${row["Button Combo"] ? `(${row["Button Combo"]})` : ""}`.trim();
   
   // After:
   const name = row["Table Entry"];
   ```
2. Keep `buttonCombo` field for reference but don't use in name
3. Regenerate `palettes-generated.ts`
4. Test in PalettePicker that names display correctly

**Expected Outcome:**
- Palette names are cleaner: "0x1A" instead of "0x1A (B + Down)"

---

### Phase 5: Move Palette Generation to gbcam-extract
**Files to Move:**
- `packages/gbcam-extract-web/scripts/generate-palettes.ts` → `packages/gbcam-extract/scripts/generate-palettes.ts`

**Files to Create:**
- `packages/gbcam-extract/src/data/palettes-generated.ts` (generated)
- `packages/gbcam-extract/src/data/palettes.ts` (new, exports generated palettes with TypeScript types)

**Files to Modify:**
- `packages/gbcam-extract/package.json` (add `generate:palettes` script to build)
- `packages/gbcam-extract/src/index.ts` (export palettes)
- `packages/gbcam-extract-web/package.json` (remove `generate:palettes` script, rely on gbcam-extract)
- `packages/gbcam-extract-web/src/data/palettes.ts` (import from gbcam-extract instead of palettes-generated)
- `packages/gbcam-extract-web/scripts/generate-palettes.ts` (delete, move to gbcam-extract)

**Steps:**
1. Move `generate-palettes.ts` to gbcam-extract
2. Create `gbcam-extract/src/data/palettes.ts` (same logic as current web package version)
3. Update `gbcam-extract/src/index.ts` to export:
   ```typescript
   export { BUTTON_COMBO_PALETTES, BG_PRESETS, ADDITIONAL_PALETTES, FUN_PALETTES_EXPORT, ALL_PALETTES, type PaletteEntry } from "./data/palettes.js";
   ```
4. Update `gbcam-extract/package.json`:
   ```json
   "build": "npm run generate:palettes && tsc -b",
   "generate:palettes": "node scripts/generate-palettes.ts",
   ```
5. Update `gbcam-extract-web/src/data/palettes.ts`:
   ```typescript
   export { BUTTON_COMBO_PALETTES, BG_PRESETS, ADDITIONAL_PALETTES, FUN_PALETTES_EXPORT, ALL_PALETTES, type PaletteEntry } from "gbcam-extract";
   ```
6. Delete `gbcam-extract-web/scripts/generate-palettes.ts`
7. Delete `gbcam-extract-web/src/data/palettes-generated.ts`
8. Update `gbcam-extract-web/package.json` (remove `generate:palettes` from build)
9. Test build process in both packages

**Expected Outcome:**
- Palette generation is centralized in gbcam-extract
- Web package imports palettes from gbcam-extract
- Single source of truth for palette data
- Easier to maintain and reuse

---

## Implementation Order

1. **Phase 4 (easiest):** Remove button combo from names
   - Regenerate palettes
   - Test in UI
   
2. **Phase 2 (quick):** Fix palette names in filenames
   - Add sanitization function
   - Apply to download functions
   
3. **Phase 1 (medium):** Fix progress tracking
   - Enhance useProcessing hook
   - Update ProgressDisplay
   
4. **Phase 3 (complex):** User palette edit mode
   - Create new hook
   - Update PalettePicker substantially
   - Update palette selection logic in App
   
5. **Phase 5 (structural):** Move generation to gbcam-extract
   - Move files
   - Update exports
   - Test builds

---

## Testing Checklist

### Phase 1 (Progress)
- [ ] Process single image: progress bar shows smooth 0-100%
- [ ] Process 3 images: progress bar shows smooth 0-100% across all
- [ ] Each file's step is visible in progress text

### Phase 2 (Filenames)
- [ ] Download with space in palette name: filename has underscores
- [ ] Batch download: all filenames sanitized correctly

### Phase 3 (Edit Mode)
- [ ] Click +Custom: creates palette with name "{Current} custom 1"
- [ ] Edit colors and name: changes reflect in preview immediately
- [ ] Click cancel: reverts to saved values
- [ ] Click save: persists and closes edit mode
- [ ] Click delete: removes palette
- [ ] Create two custom palettes: names are "0x01 custom 1" and "0x01 custom 2"
- [ ] Edit second palette, select first: preview shows first palette, second still in edit mode
- [ ] Save validation: save button disabled when name blank or duplicate
- [ ] Click edit on saved palette: re-enters edit mode with saved values

### Phase 4 (Names)
- [ ] Palette picker shows clean names without button combos
- [ ] Download works with clean names

### Phase 5 (Move Generation)
- [ ] gbcam-extract build includes palette generation
- [ ] gbcam-extract exports palettes
- [ ] gbcam-extract-web imports from gbcam-extract
- [ ] Both packages build successfully
- [ ] Final bundle size unchanged or smaller

---

## Notes

- The edit mode system is stateful and complex. Consider drawing a state diagram before implementing Phase 3.
- Phase 5 might require building gbcam-extract first, then gbcam-extract-web.
- All palette selection logic must use `getCurrentPalette()` to handle edit mode correctly.
- localStorage keys may need migration if changing data structure in Phase 3.
