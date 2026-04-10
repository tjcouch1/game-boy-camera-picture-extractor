# Palette Edit Mode Improvements Plan

## Overview
This plan addresses comprehensive improvements to the palette picker UI/UX, focusing on implementing multi-palette edit mode, removing draft palette tracking, and fixing palette management issues.

## Current State
- **Draft Palette System**: Uses `useDraftPalette` hook to track a single draft palette in localStorage
- **Palette Editing**: Users can edit palettes, but editing creates new copies
- **UI Issues**: 
  - All palettes (including built-in ones) show edit buttons
  - User palette swatches have both edit and delete (X) buttons
  - Draft palette shown separately above user palettes
  - No indication of which palettes are being edited

## Goals
1. Replace single-draft-palette with multi-palette edit mode
2. Allow built-in palettes to be used as templates without editing them
3. Improve UX with better visual feedback and state management
4. Refactor palette data architecture (remove `palettes.ts` export, consolidate to `palettes-generated.ts`)
5. Remove unused palette generation code from web package
6. Add tests for palette generation

---

## Implementation Plan

### Phase 1: Data Architecture Refactoring

#### 1.1 Simplify gbcam-extract exports
**Files**: `packages/gbcam-extract/src/data/palette.ts`, `packages/gbcam-extract/src/data/palettes-generated.ts`

- **Remove**: `palettes.ts` which just re-exports from `palettes-generated.ts`
- **Update**: All exports directly from `palettes-generated.ts`
- **Impact**: Cleaner module structure, direct access to generated palettes

#### 1.2 Remove unused palette generation from web package
**Files**: `packages/gbcam-extract-web/src/data/palettes.ts` and any related code

- **Audit**: Check for any unused palette generation logic in web package
- **Remove**: Any redundant palette transformation code
- **Keep**: Only the import from `gbcam-extract` and section-based grouping

#### 1.3 Add tests for generate-palettes.ts
**Files**: `packages/gbcam-extract/scripts/generate-palettes.ts` (new test file)

- **Create**: Test file in `packages/gbcam-extract/tests/` or appropriate location
- **Test**: 
  - CSV parsing from supporting-materials/color-tables/
  - Correct palette generation
  - Button combo extraction
  - Output file generation

---

### Phase 2: Data Model Changes (User Palettes)

#### 2.1 Update PaletteEntry interface
**Impact**: Affects storage, UI, and palette management

**New Model**:
```typescript
interface PaletteEntry {
  id: string;  // Unique identifier (uuid or similar)
  name: string;
  colors: [string, string, string, string];
  isBuiltIn: boolean;
  isEditing?: boolean;
  savedColors?: [string, string, string, string];  // Track pre-edit state
  savedName?: string;  // Track pre-edit name
}
```

**Design Decisions**:
- `isEditing`: Flag that palette is in edit mode (not saved yet or currently being edited)
- `savedColors`/`savedName`: Restore values if user cancels while editing
- `isBuiltIn`: Prevent editing of built-in palettes; no edit button shown
- Each palette has unique `id` for reliable tracking across sessions

#### 2.2 Update useUserPalettes hook
**Files**: `packages/gbcam-extract-web/src/hooks/useUserPalettes.ts`

**Changes**:
- Update data model with `id`, `isEditing`, `savedColors`, `savedName`
- Add method: `updatePalette(id, changes)` - Update palette properties
- Add method: `createPaletteInEditMode(fromName, fromColors)` - Create new palette in edit mode with auto-generated name
- Add method: `savePalette(id)` - Save palette, exit edit mode, clear saved values
- Add method: `cancelPaletteEdit(id)` - Restore previous colors/name, exit edit mode
- Add method: `deletePalette(id)` - Delete user palette (only valid for user palettes, not built-in)
- Ensure localStorage serialization/deserialization of new model

#### 2.3 Delete useDraftPalette hook
**Files**: `packages/gbcam-extract-web/src/hooks/useDraftPalette.ts`

- **Delete**: Entire file; functionality moved to `useUserPalettes`
- **Remove**: All references and imports throughout codebase

---

### Phase 3: UI Component Updates

#### 3.1 Update PaletteSwatch component
**Files**: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

**Changes to PaletteSwatch**:
- Remove `onDelete` and `onEdit` props for palette entries
- Add state for in-edit-mode palettes:
  - Show edit controls inline when `isEditing === true`
  - Hide swatch display when in edit mode (it's redundant with the editor)
  - Different background color: brighter blue when selected, medium blue when colors match but not selected
- Button behavior:
  - If built-in: No buttons shown
  - If user palette not editing: Show edit button (pencil icon)
  - If user palette editing: Show cancel and delete buttons

#### 3.2 Refactor PalettePicker component
**Files**: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

**Major refactoring**:

**Remove**:
- `useDraftPalette` hook and all draft-related state
- `editingPalette` state (merged into `editingPaletteId`)
- `showCreate` state (merged into editing state)
- Draft-specific UI sections
- The "Cancel" button that switches with "+ Custom"

**Add**:
- `editingPaletteId` state (track which palette is being edited by ID)
- Integration with updated `useUserPalettes` for multi-edit support
- Auto-generate unique palette names when creating new palette:
  - Get selected palette name (e.g., "0x01")
  - Find all user palettes with name starting with "0x01 custom"
  - Generate "0x01 custom 1", "0x01 custom 2", etc., picking first unused number

**UI Structure**:
```
┌─ Palette Picker ─────────────────────┐
│  [colors] [selected palette name]     │
│  [+ Custom button]                    │
│                                       │
│  ✏️ EDITING PALETTES (top section)   │
│  ├─ [0x01 custom 1 editor]           │
│  └─ [0x01 custom 2 editor]           │
│                                       │
│  USER PALETTES                        │
│  ├─ [My Palette] [✏️]                │
│  └─ [Another] [✏️]                   │
│                                       │
│  [Other sections...]                  │
└───────────────────────────────────────┘
```

**Editor UI (in edit mode)**:
```
┌─ Name: [text input]────────────────┐
│                                    │
│ Color 1: [color picker]            │
│ Color 2: [color picker]            │
│ Color 3: [color picker]            │
│ Color 4: [color picker]            │
│                                    │
│ [Status] [Cancel] [Delete] [Save] │
└────────────────────────────────────┘
```

**Editor behaviors**:
- Name validation:
  - Show error if blank: "Palette name cannot be empty"
  - Show error if duplicate: "A palette with this name already exists"
  - Save button grayed out if either error exists
- Cancel button appears only if palette was previously saved (has an ID not just created)
- Color changes immediately update preview in images
- Clicking in blank space selects this palette
- Save button closes edit mode and shows swatch again

#### 3.3 PaletteSection component updates
**Files**: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

**Changes**:
- Split "User Palettes" into two sections:
  - "Editing" section (always at top, always visible if any palettes editing)
  - "Saved" section (only shows saved user palettes)
- Built-in palette sections: Remove `onEdit` callback, only pass `onSelect`
- Filter out built-in palettes from edit callbacks

---

### Phase 4: Visual Design Updates

#### 4.1 Remove X button from palette swatches
**Context**: PaletteSwatch component

**Changes**:
- Don't render delete button for any non-editing palettes
- Only show edit button (✏️) for user palettes when not in edit mode

#### 4.2 Built-in palette styling
**Context**: PaletteSwatch component

- No edit button on built-in palettes
- Click to select (apply colors)
- No delete capability

#### 4.3 Edit mode visual feedback
**Context**: Editing and non-editing states

- **Editing palette selected**: Brighter blue background (matching current selected style)
- **Editing palette not selected**: Medium blue background (indicating it's in edit mode and related to selection)
- **Non-editing palette**: Current styling (gray with darker gray on hover)

---

### Phase 5: Implementation Sequence

**Order of tasks**:

1. **Remove `useDraftPalette`**
   - Delete file
   - Remove from imports in PalettePicker

2. **Update `useUserPalettes` data model**
   - Add new fields and methods
   - Update localStorage schema with migration if needed

3. **Remove `palettes.ts` from gbcam-extract**
   - Update exports in `palettes-generated.ts`
   - Update imports in web package

4. **Remove unused palette code from web package**
   - Audit `palettes.ts` in web for unused generation code
   - Clean up imports

5. **Rewrite PalettePicker component**
   - Update state management
   - Implement multi-edit mode
   - Auto-generate unique palette names
   - Update all palette selection paths

6. **Update PaletteSwatch component**
   - Remove X button
   - Update styling for edit/built-in states
   - Add logic to show/hide edit controls

7. **Test palette generation**
   - Write tests for `generate-palettes.ts`

8. **Manual testing**
   - Create new custom palettes
   - Edit multiple palettes simultaneously
   - Test name uniqueness and validation
   - Test cancel/save functionality
   - Verify built-in palettes cannot be edited
   - Test localStorage persistence
   - Test page refresh with editing palettes

---

## Key Technical Decisions

### Why remove draft palette?
- More intuitive: Users don't need to understand "draft" concept
- Cleaner UX: "+ Custom" button consistently creates a new palette
- Better multi-edit support: Users can work on multiple palettes simultaneously

### Why unique IDs?
- Reliable tracking across localStorage/serialization
- Prevents name-based conflicts when renaming
- Better React key usage for lists

### Why show editing palettes at top?
- Visual prominence: Users know what's being edited
- Intuitive organization: Current work at top
- Consistent with many modern UIs (GMail drafts, etc.)

### Why validate on render, not on save?
- Immediate feedback: Users see errors as they type
- Better UX: No surprise errors on save
- Users can fix issues before clicking save

---

## Testing Strategy

### Unit Tests (generate-palettes.ts)
- CSV file parsing
- Palette data structure validation
- Button combo extraction
- File output validation

### Integration Tests (UI)
- Create palette in edit mode
- Edit multiple palettes simultaneously
- Name validation (blank, duplicates)
- Save/cancel functionality
- Delete user palettes
- Cannot edit built-in palettes
- Colors update in preview immediately
- Persistence across page reload

### Manual Testing Checklist
- [ ] Create custom palette
- [ ] Edit palette colors
- [ ] Change palette name
- [ ] Save palette
- [ ] Cancel editing (with previously saved palette)
- [ ] Delete user palette
- [ ] Create multiple palettes in edit mode
- [ ] Switch between editing and viewing palettes
- [ ] Verify built-in palette swatches don't have edit button
- [ ] Verify no X button on any swatch
- [ ] Verify saved palette shows swatch, not editor
- [ ] Test name validation (empty, duplicate)
- [ ] Test unique name generation (0x01 custom 1, 2, 3...)
- [ ] Refresh page with editing palettes, verify they're still there
- [ ] Test on desktop and mobile

---

## Files to Create/Modify

### Create
- `packages/gbcam-extract/tests/generate-palettes.test.ts`

### Modify
- `packages/gbcam-extract/src/data/palettes-generated.ts` (consolidate exports)
- `packages/gbcam-extract-web/src/hooks/useUserPalettes.ts` (new data model)
- `packages/gbcam-extract-web/src/components/PalettePicker.tsx` (major refactor)
- `packages/gbcam-extract-web/src/data/palettes.ts` (cleanup)

### Delete
- `packages/gbcam-extract/src/data/palettes.ts`
- `packages/gbcam-extract-web/src/hooks/useDraftPalette.ts`

### Update
- Any files importing from deleted/modified files

---

## Success Criteria

1. ✅ No X button on any palette swatch
2. ✅ Built-in palettes have no edit button
3. ✅ User can create multiple palettes in edit mode simultaneously
4. ✅ Edit mode palettes appear at top, not their swatch (only editor shown)
5. ✅ Edit mode palette selected = bright blue background
6. ✅ Edit mode palette colors match selection = medium blue background
7. ✅ "+ Custom" creates palette immediately, doesn't toggle button state
8. ✅ Save button disabled with helpful message if name blank or duplicate
9. ✅ Cancel button appears for previously-saved palettes
10. ✅ Clicking save closes edit mode and shows swatch
11. ✅ Delete button in edit mode removes palette
12. ✅ Clicking blank space in editor selects that palette
13. ✅ Color changes in editor immediately show in preview
14. ✅ No draft palette code remains
15. ✅ `palettes.ts` removed from gbcam-extract
16. ✅ Unused palette generation code removed from web
17. ✅ Tests added for palette generation
18. ✅ All persistence works after page reload
19. ✅ No console errors or warnings
20. ✅ Manual test checklist completed

---

## Notes

- Consider using `crypto.randomUUID()` or a simple counter for palette IDs
- localStorage schema version/migration may be needed for existing users
- Consider showing warning if user has unsaved edits when navigating away
- PWA offline support should work with localStorage-based palette data
