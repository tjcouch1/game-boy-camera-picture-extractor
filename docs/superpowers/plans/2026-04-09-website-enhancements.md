# Website Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement five independent features: palette CSV-driven data, draft custom palette with auto-save, enhanced progress indication, native share + copy-to-clipboard, and a local test server for PWA testing.

**Architecture:** Five independent feature branches implementing the design spec. Palette CSV is the foundation (done first); all others can proceed in parallel afterward. Each feature is self-contained with minimal cross-dependencies.

**Tech Stack:** TypeScript, React, localStorage for draft persistence, Web Share API for native sharing, Clipboard API for copy, lightweight HTTP server for local testing.

---

## File Structure

### Files to Create
- `supporting-materials/color-tables/game-boy-color-fun-palettes.csv` — novelty palette definitions
- `packages/gbcam-extract-web/scripts/generate-palettes.ts` — CSV parser and code generator
- `packages/gbcam-extract-web/src/data/palettes-generated.ts` — generated (not hand-edited)
- `packages/gbcam-extract-web/src/hooks/useDraftPalette.ts` — draft palette state management
- `packages/gbcam-extract-web/src/utils/shareImage.ts` — share/clipboard utilities
- `packages/gbcam-extract-web/scripts/serve-dist.ts` — local test server

### Files to Modify
- `packages/gbcam-extract-web/src/data/palettes.ts` — transforms generated data (API unchanged)
- `packages/gbcam-extract-web/src/hooks/useProcessing.ts` — enhanced progress tracking
- `packages/gbcam-extract-web/src/components/PalettePicker.tsx` — draft option + separate Fun/Additional sections
- `packages/gbcam-extract-web/src/components/ResultCard.tsx` — share + copy buttons
- `packages/gbcam-extract-web/src/App.tsx` — progress UI + draft state wiring
- `packages/gbcam-extract-web/package.json` — add npm scripts + dependencies

---

## Task Group 1: Palette CSV Architecture

### Task 1: Create fun-palettes.csv

**Files:**
- Create: `supporting-materials/color-tables/game-boy-color-fun-palettes.csv`

- [ ] **Step 1: Create the fun palettes CSV file**

Create `supporting-materials/color-tables/game-boy-color-fun-palettes.csv` with the following content:

```csv
Name,Color 0x00,Color 0x01,Color 0x02,Color 0x03
OBJ0 Classic,#FFFFFF,#FF8484,#943A3A,#000000
OBJ1 Classic,#FFFFFF,#63A5FF,#0000FF,#000000
DMG Green,#9BBC0F,#8BAC0F,#306230,#0F380F
Pocket,#C4CFA1,#8B956D,#4D533C,#1F1F1F
Light,#00B581,#009A71,#00694A,#004F3B
Kiosk,#FFE600,#E79200,#A04900,#4C1800
SGB 1A,#F8E8C8,#D89048,#A82820,#301850
SGB 2A,#F8E8C8,#E09850,#A03020,#402038
SGB 3A,#F8D8B0,#78C078,#688840,#583820
SGB 4A,#F8E068,#D8A038,#A05010,#000000
Grayscale,#FFFFFF,#AAAAAA,#555555,#000000
Inverted,#000000,#555555,#AAAAAA,#FFFFFF
```

- [ ] **Step 2: Verify the file exists**

Run: `ls -la supporting-materials/color-tables/game-boy-color-fun-palettes.csv`
Expected: File exists and is readable

---

### Task 2: Create palette generator script

**Files:**
- Create: `packages/gbcam-extract-web/scripts/generate-palettes.ts`

- [ ] **Step 1: Write the generate-palettes.ts script**

```typescript
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RawPaletteEntry {
  name: string;
  colors: [string, string, string, string];
  buttonCombo?: string;
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || "";
    });
    rows.push(row);
  }

  return rows;
}

function generatePaletteModule() {
  const contentDir = path.join(__dirname, "../../../supporting-materials/color-tables");

  // Read CSVs
  const mainCsv = fs.readFileSync(path.join(contentDir, "game-boy-camera-palettes.csv"), "utf-8");
  const additionalCsv = fs.readFileSync(
    path.join(contentDir, "game-boy-color-additional-palettes.csv"),
    "utf-8"
  );
  const funCsv = fs.readFileSync(
    path.join(contentDir, "game-boy-color-fun-palettes.csv"),
    "utf-8"
  );

  // Parse CSVs
  const mainEntries = parseCSV(mainCsv);
  const additionalEntries = parseCSV(additionalCsv);
  const funEntries = parseCSV(funCsv);

  // Generate main palettes
  const mainPalettes: RawPaletteEntry[] = mainEntries.map((row) => ({
    name: `${row["Table Entry"]} ${row["Button Combo"] ? `(${row["Button Combo"]})` : ""}`.trim(),
    colors: [
      row["BG Color 0x00"],
      row["BG Color 0x01"],
      row["BG Color 0x02"],
      row["BG Color 0x03"],
    ] as [string, string, string, string],
    buttonCombo: row["Button Combo"] || undefined,
  }));

  // Generate additional palettes
  const additionalPalettes: RawPaletteEntry[] = additionalEntries.map((row) => ({
    name: `${row["Layer"]} ${row["Table Entry"]}`,
    colors: [row["Color 0x00"], row["Color 0x01"], row["Color 0x02"], row["Color 0x03"]] as [
      string,
      string,
      string,
      string,
    ],
  }));

  // Generate fun palettes
  const funPalettes: RawPaletteEntry[] = funEntries.map((row) => ({
    name: row["Name"],
    colors: [
      row["Color 0x00"],
      row["Color 0x01"],
      row["Color 0x02"],
      row["Color 0x03"],
    ] as [string, string, string, string],
  }));

  // Generate TypeScript file
  const output = `// GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from CSV files in supporting-materials/color-tables/
// Run: cd packages/gbcam-extract-web && pnpm generate:palettes

export interface PaletteEntry {
  name: string;
  colors: [string, string, string, string];
  buttonCombo?: string;
}

export const MAIN_PALETTES: PaletteEntry[] = ${JSON.stringify(mainPalettes, null, 2)};

export const ADDITIONAL_PALETTES: PaletteEntry[] = ${JSON.stringify(additionalPalettes, null, 2)};

export const FUN_PALETTES: PaletteEntry[] = ${JSON.stringify(funPalettes, null, 2)};
`;

  const outputPath = path.join(__dirname, "../src/data/palettes-generated.ts");
  fs.writeFileSync(outputPath, output);
  console.log(`Generated ${outputPath}`);
}

generatePaletteModule();
```

- [ ] **Step 2: Run the script to generate initial data**

Run from `packages/gbcam-extract-web`:
```bash
node scripts/generate-palettes.ts
```

Expected: `src/data/palettes-generated.ts` is created with palette data

- [ ] **Step 3: Verify generated file exists and contains data**

Run: `head -50 src/data/palettes-generated.ts`

Expected: File contains MAIN_PALETTES, ADDITIONAL_PALETTES, FUN_PALETTES exports with color data

- [ ] **Step 4: Commit**

```bash
git add supporting-materials/color-tables/game-boy-color-fun-palettes.csv packages/gbcam-extract-web/scripts/generate-palettes.ts packages/gbcam-extract-web/src/data/palettes-generated.ts
git commit -m "feat: add palette CSV generation script and fun palettes CSV"
```

---

### Task 3: Update palettes.ts to use generated data

**Files:**
- Modify: `packages/gbcam-extract-web/src/data/palettes.ts`

- [ ] **Step 1: Read current palettes.ts to understand structure**

The file currently exports:
- `PaletteEntry` interface
- `BUTTON_COMBO_PALETTES` array
- `BG_PRESETS` array
- `ADDITIONAL_PALETTES` array
- `ALL_PALETTES` combined array

- [ ] **Step 2: Rewrite palettes.ts to import and transform generated data**

```typescript
import {
  MAIN_PALETTES,
  ADDITIONAL_PALETTES as ADDITIONAL_FROM_CSV,
  FUN_PALETTES,
} from "./palettes-generated.js";

export interface PaletteEntry {
  name: string;
  colors: [string, string, string, string];
}

// Filter main palettes by button combo for BUTTON_COMBO_PALETTES section
export const BUTTON_COMBO_PALETTES: PaletteEntry[] = MAIN_PALETTES.filter(
  (p) => p.buttonCombo
).map((p) => ({
  name: p.buttonCombo!,
  colors: p.colors,
}));

// All main BG palettes except button combos (to avoid duplication)
export const BG_PRESETS: PaletteEntry[] = MAIN_PALETTES.map((p) => {
  // Use entry ID or button combo as name
  const name = p.name.split("(")[0].trim();
  return {
    name,
    colors: p.colors,
  };
});

// Additional palettes from CSV
export const ADDITIONAL_PALETTES: PaletteEntry[] = ADDITIONAL_FROM_CSV.map((p) => ({
  name: p.name,
  colors: p.colors,
}));

// Fun/novelty palettes from CSV
export const FUN_PALETTES: PaletteEntry[] = FUN_PALETTES.map((p) => ({
  name: p.name,
  colors: p.colors,
}));

export const ALL_PALETTES = [
  ...BUTTON_COMBO_PALETTES,
  ...BG_PRESETS,
  ...ADDITIONAL_PALETTES,
  ...FUN_PALETTES,
];
```

- [ ] **Step 3: Verify file has no syntax errors**

Run from `packages/gbcam-extract-web`:
```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 4: Verify PalettePicker still imports correctly**

Run: `grep -n "BUTTON_COMBO_PALETTES\|BG_PRESETS\|ADDITIONAL_PALETTES" src/components/PalettePicker.tsx`

Expected: Imports are still valid

- [ ] **Step 5: Commit**

```bash
git add packages/gbcam-extract-web/src/data/palettes.ts
git commit -m "refactor: derive palettes from CSV-generated data"
```

---

### Task 4: Add generate-palettes npm script

**Files:**
- Modify: `packages/gbcam-extract-web/package.json`

- [ ] **Step 1: Add npm script**

Update the `scripts` section to include:

```json
"scripts": {
  "dev": "vite",
  "build": "pnpm generate:palettes && tsc -b && vite build",
  "generate:palettes": "node scripts/generate-palettes.ts",
  "preview": "vite preview",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 2: Verify package.json is valid JSON**

Run: `cat package.json | jq . > /dev/null && echo "Valid JSON"`

Expected: "Valid JSON"

- [ ] **Step 3: Test that build includes palette generation**

Run from `packages/gbcam-extract-web`:
```bash
pnpm generate:palettes
```

Expected: `src/data/palettes-generated.ts` is regenerated without errors

- [ ] **Step 4: Commit**

```bash
git add packages/gbcam-extract-web/package.json
git commit -m "build: add generate:palettes script to build pipeline"
```

---

## Task Group 2: Draft Custom Palette Feature

### Task 5: Create useDraftPalette hook

**Files:**
- Create: `packages/gbcam-extract-web/src/hooks/useDraftPalette.ts`

- [ ] **Step 1: Write the useDraftPalette hook**

```typescript
import { useState, useCallback, useEffect } from "react";

const DRAFT_STORAGE_KEY = "gbcam_draft_palette";

export interface DraftPaletteState {
  colors: [string, string, string, string] | null;
  lastNonDraftPalette: [string, string, string, string] | null;
}

function loadDraftFromStorage(): DraftPaletteState {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to load draft palette", e);
  }
  return { colors: null, lastNonDraftPalette: null };
}

function saveDraftToStorage(state: DraftPaletteState) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save draft palette", e);
  }
}

export function useDraftPalette() {
  const [draftState, setDraftState] = useState<DraftPaletteState>(loadDraftFromStorage);

  // Auto-save to localStorage whenever state changes
  useEffect(() => {
    saveDraftToStorage(draftState);
  }, [draftState]);

  const initializeDraft = useCallback((fromPalette: [string, string, string, string]) => {
    setDraftState({
      colors: [...fromPalette] as [string, string, string, string],
      lastNonDraftPalette: fromPalette,
    });
  }, []);

  const updateDraftColors = useCallback((colors: [string, string, string, string]) => {
    setDraftState((prev) => ({
      ...prev,
      colors,
    }));
  }, []);

  const recordNonDraftPalette = useCallback((palette: [string, string, string, string]) => {
    setDraftState((prev) => ({
      ...prev,
      lastNonDraftPalette: palette,
    }));
  }, []);

  const clearDraft = useCallback(() => {
    setDraftState((prev) => ({
      colors: null,
      lastNonDraftPalette: prev.lastNonDraftPalette,
    }));
  }, []);

  const hasDraft = draftState.colors !== null;

  return {
    draft: draftState.colors,
    hasDraft,
    lastNonDraftPalette: draftState.lastNonDraftPalette,
    initializeDraft,
    updateDraftColors,
    recordNonDraftPalette,
    clearDraft,
  };
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run from `packages/gbcam-extract-web`:
```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/gbcam-extract-web/src/hooks/useDraftPalette.ts
git commit -m "feat: add useDraftPalette hook for draft palette state management"
```

---

### Task 6: Update PalettePicker to show Draft option and separate sections

**Files:**
- Modify: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

- [ ] **Step 1: Update imports to include FUN_PALETTES and useDraftPalette**

Add to imports:
```typescript
import { FUN_PALETTES } from "../data/palettes.js";
import { useDraftPalette } from "../hooks/useDraftPalette.js";
```

- [ ] **Step 2: Add draft state and handlers to PalettePicker**

In the `PalettePicker` function body, add after the existing state:

```typescript
const {
  draft,
  hasDraft,
  lastNonDraftPalette,
  initializeDraft,
  updateDraftColors,
  recordNonDraftPalette,
  clearDraft,
} = useDraftPalette();

// Track if we're in draft edit mode
const [editingDraft, setEditingDraft] = useState(false);

// Check if current selection matches draft
const isDraftSelected =
  hasDraft && draft && selected.every((c, i) => c === draft[i]);
```

- [ ] **Step 3: Update custom palette creation to work with draft**

Replace the existing `handleSave` function with:

```typescript
const handleSave = () => {
  if (!newName.trim()) return;

  if (editingDraft) {
    // Saving draft as permanent palette
    addPalette({ name: newName.trim(), colors: [...newColors] });
    clearDraft();
    setNewName("");
    setEditingDraft(false);
    setShowCreate(false);
  } else {
    // Creating new custom palette from scratch
    addPalette({ name: newName.trim(), colors: [...newColors] });
    setNewName("");
    setShowCreate(false);
  }
};
```

- [ ] **Step 4: Update PaletteSection to handle Draft option**

Add a new section before the "User Palettes" section in the return statement:

```typescript
{hasDraft && (
  <PaletteSection
    title="Draft"
    entries={[{ name: "✏️ Draft", colors: draft! }]}
    selected={selected}
    onSelect={() => {
      onSelect(draft!);
      setEditingDraft(true);
      setShowCreate(true);
      setNewColors(draft!);
      setNewName("");
    }}
  />
)}
```

- [ ] **Step 5: Update existing palette selection to record non-draft palettes**

In the `PaletteSection` for "User Palettes", update the `onSelect`:

```typescript
<PaletteSection
  title="User Palettes"
  entries={userPalettes}
  selected={selected}
  onSelect={(colors) => {
    if (hasDraft) {
      // If draft exists, just update preview
      onSelect(colors);
    } else {
      // No draft, record as non-draft for potential future draft init
      recordNonDraftPalette(colors);
      onSelect(colors);
    }
  }}
  onDelete={removePalette}
/>
```

- [ ] **Step 6: Update other palette sections to record non-draft when no draft exists**

For "Button Combos", "BG Presets", "Additional", and "Fun", update each `onSelect`:

```typescript
onSelect={(colors) => {
  if (hasDraft) {
    onSelect(colors);
  } else {
    recordNonDraftPalette(colors);
    onSelect(colors);
  }
}}
```

- [ ] **Step 7: Add FUN_PALETTES section**

Add before the closing `</div>`:

```typescript
<PaletteSection
  title="Fun"
  entries={FUN_PALETTES}
  selected={selected}
  onSelect={(colors) => {
    if (hasDraft) {
      onSelect(colors);
    } else {
      recordNonDraftPalette(colors);
      onSelect(colors);
    }
  }}
/>
```

- [ ] **Step 8: Update custom palette editor to handle draft**

Modify the section where `showCreate` is true. Replace the entire custom editor div (lines 144-181) with:

```typescript
{showCreate && (
  <div className="mb-3 p-3 bg-gray-900 rounded">
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-medium text-gray-400">
        {editingDraft ? "Edit Draft Palette" : "Create Custom Palette"}
      </p>
      {hasDraft && !editingDraft && (
        <button
          onClick={() => {
            clearDraft();
            setShowCreate(false);
          }}
          className="text-xs px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-white transition-colors"
        >
          Clear Draft
        </button>
      )}
    </div>
    <div className="flex items-center gap-2 mb-2">
      {newColors.map((c, i) => (
        <label key={i} className="flex flex-col items-center gap-1">
          <input
            type="color"
            value={c}
            onChange={(e) => {
              const updated = [...newColors] as [string, string, string, string];
              updated[i] = e.target.value;
              setNewColors(updated);
              if (editingDraft) {
                updateDraftColors(updated);
              }
            }}
            className="w-8 h-8 rounded cursor-pointer bg-transparent"
          />
          <span className="text-[10px] text-gray-500">
            {["Light", "Mid-L", "Mid-D", "Dark"][i]}
          </span>
        </label>
      ))}
    </div>
    {!editingDraft && (
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Palette name"
          className="flex-1 px-2 py-1 bg-gray-700 rounded text-xs text-white placeholder-gray-500 border border-gray-600 focus:border-blue-500 outline-none"
        />
        <button
          onClick={handleSave}
          disabled={!newName.trim()}
          className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-xs font-medium transition-colors"
        >
          Save
        </button>
      </div>
    )}
    {editingDraft && (
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Save as permanent palette (optional)"
          className="flex-1 px-2 py-1 bg-gray-700 rounded text-xs text-white placeholder-gray-500 border border-gray-600 focus:border-blue-500 outline-none"
        />
        <button
          onClick={handleSave}
          disabled={!newName.trim()}
          className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-xs font-medium transition-colors"
        >
          Save as
        </button>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 9: Verify no TypeScript errors**

Run from `packages/gbcam-extract-web`:
```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add packages/gbcam-extract-web/src/components/PalettePicker.tsx
git commit -m "feat: add draft palette option to PalettePicker with separate Fun section"
```

---

### Task 7: Wire draft palette into App.tsx

**Files:**
- Modify: `packages/gbcam-extract-web/src/App.tsx`

- [ ] **Step 1: Update palette state to use draft when available**

Find the line `const [palette, setPalette] = useState<...>` and replace it with:

```typescript
const { draft, hasDraft, lastNonDraftPalette } = useDraftPalette();
const [palette, setPalette] = useState<[string, string, string, string]>([
  "#FFFFFF",
  "#A5A5A5",
  "#525252",
  "#000000",
]);

// Use draft palette if it exists, otherwise use selected palette
const effectivePalette = hasDraft && draft ? draft : palette;
```

- [ ] **Step 2: Update PalettePicker call to use effective palette**

Change from:
```typescript
<PalettePicker selected={palette} onSelect={setPalette} />
```

To:
```typescript
<PalettePicker selected={effectivePalette} onSelect={setPalette} />
```

- [ ] **Step 3: Update ResultCard calls to use effective palette**

Change from:
```typescript
palette={palette}
```

To:
```typescript
palette={effectivePalette}
```

- [ ] **Step 4: Update download function call to use effective palette**

In the download button click handler, change from:
```typescript
downloadResult(r.filename, r.result, palette);
```

To:
```typescript
downloadResult(r.filename, r.result, effectivePalette);
```

- [ ] **Step 5: Import useDraftPalette hook**

Add to imports at top of file:
```typescript
import { useDraftPalette } from "./hooks/useDraftPalette.js";
```

- [ ] **Step 6: Verify no TypeScript errors**

Run from `packages/gbcam-extract-web`:
```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/gbcam-extract-web/src/App.tsx
git commit -m "feat: integrate draft palette into app state"
```

---

## Task Group 3: Enhanced Progress Indication

### Task 8: Enhance useProcessing hook with detailed progress tracking

**Files:**
- Modify: `packages/gbcam-extract-web/src/hooks/useProcessing.ts`

- [ ] **Step 1: Update ProcessingResult interface and add progress types**

Add before the `fileToGBImageData` function:

```typescript
export interface CurrentImageProgress {
  filename: string;
  currentStep: string;
  index: number; // current image position (0-based)
  total: number; // total images to process
}

export interface ProcessingProgress {
  totalImages: number;
  completedImages: number;
  currentImageProgress: CurrentImageProgress | null;
  overallProgress: number; // 0-100
}
```

- [ ] **Step 2: Update useProcessing return type and state**

Replace the state declarations with:

```typescript
const [processing, setProcessing] = useState(false);
const [progress, setProgress] = useState<ProcessingProgress>({
  totalImages: 0,
  completedImages: 0,
  currentImageProgress: null,
  overallProgress: 0,
});
const [results, setResults] = useState<ProcessingResult[]>([]);
```

- [ ] **Step 3: Update processFiles to emit detailed progress**

Replace the entire `processFiles` function with:

```typescript
const processFiles = useCallback(async (files: File[], debug = false) => {
  setProcessing(true);
  setProgress({
    totalImages: files.length,
    completedImages: 0,
    currentImageProgress: null,
    overallProgress: 0,
  });
  setResults([]);

  const newResults: ProcessingResult[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    try {
      const currentStep = `Loading ${file.name}`;
      setProgress((prev) => ({
        ...prev,
        currentImageProgress: {
          filename: file.name,
          currentStep,
          index: fileIndex,
          total: files.length,
        },
      }));

      const gbImage = await fileToGBImageData(file);

      const start = performance.now();
      const result = await processPicture(gbImage, {
        debug,
        onProgress: (step) => {
          setProgress((prev) => ({
            ...prev,
            currentImageProgress: {
              filename: file.name,
              currentStep: step,
              index: fileIndex,
              total: files.length,
            },
          }));
        },
      });
      const processingTime = performance.now() - start;

      newResults.push({ result, filename: file.name, processingTime });
      setResults([...newResults]);

      // Update progress
      const completedCount = fileIndex + 1;
      const overallProgress = Math.round((completedCount / files.length) * 100);
      setProgress((prev) => ({
        ...prev,
        completedImages: completedCount,
        overallProgress,
      }));
    } catch (err) {
      console.error(`Failed to process ${file.name}:`, err);
      // Still mark as completed even if failed
      const completedCount = fileIndex + 1;
      const overallProgress = Math.round((completedCount / files.length) * 100);
      setProgress((prev) => ({
        ...prev,
        completedImages: completedCount,
        overallProgress,
      }));
    }
  }

  setProcessing(false);
  setProgress({
    totalImages: files.length,
    completedImages: files.length,
    currentImageProgress: null,
    overallProgress: 100,
  });
}, []);
```

- [ ] **Step 4: Update return value to include progress**

Replace the return statement with:

```typescript
return { processFiles, processing, progress, results };
```

- [ ] **Step 5: Verify no TypeScript errors**

Run from `packages/gbcam-extract-web`:
```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract-web/src/hooks/useProcessing.ts
git commit -m "feat: enhance useProcessing with detailed progress tracking"
```

---

### Task 9: Update App.tsx to display enhanced progress

**Files:**
- Modify: `packages/gbcam-extract-web/src/App.tsx`

- [ ] **Step 1: Update useProcessing destructuring**

Replace:
```typescript
const { processFiles, processing, results, currentStep } = useProcessing();
```

With:
```typescript
const { processFiles, processing, progress, results } = useProcessing();
```

- [ ] **Step 2: Create a ProgressDisplay component**

Add before the `App` component export (after imports but before the function):

```typescript
function ProgressDisplay({ progress }: { progress: ReturnType<typeof useProcessing>["progress"] }) {
  if (!progress.currentImageProgress) return null;

  return (
    <div className="mt-4 space-y-2">
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-sm font-medium text-gray-300">
            Processing: {progress.completedImages} of {progress.totalImages} images
          </span>
          <span className="text-sm font-medium text-gray-400">
            {progress.overallProgress}%
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${progress.overallProgress}%` }}
          />
        </div>
      </div>
      <div className="text-sm text-gray-400">
        {progress.currentImageProgress.filename}: {progress.currentImageProgress.currentStep}...
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace the existing LoadingBar with ProgressDisplay**

Find the section:
```typescript
{processing && (
  <div className="mt-4">
    <LoadingBar progress={-1} label={`Processing: ${currentStep}...`} />
  </div>
)}
```

Replace with:
```typescript
{processing && <ProgressDisplay progress={progress} />}
```

- [ ] **Step 4: Remove the currentStep reference from useOpenCV section**

Find and verify the `useOpenCV` section still looks correct (it should use `progress` from that hook, not from useProcessing)

- [ ] **Step 5: Verify no TypeScript errors**

Run from `packages/gbcam-extract-web`:
```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract-web/src/App.tsx
git commit -m "feat: add enhanced progress display with per-image step indication"
```

---

## Task Group 4: Share Button Feature

### Task 10: Create share utility functions

**Files:**
- Create: `packages/gbcam-extract-web/src/utils/shareImage.ts`

- [ ] **Step 1: Write share utility functions**

```typescript
export async function canShare(): Promise<boolean> {
  return "share" in navigator;
}

export async function shareImage(
  canvas: HTMLCanvasElement,
  filename: string
): Promise<void> {
  if (!("share" in navigator)) {
    throw new Error("Web Share API not supported");
  }

  try {
    canvas.toBlob(async (blob) => {
      if (!blob) throw new Error("Failed to create blob from canvas");

      const file = new File([blob], filename.replace(/\.[^.]+$/, "") + "_gb.png", {
        type: "image/png",
      });

      await navigator.share({
        title: filename,
        text: "Extracted Game Boy Camera image",
        files: [file],
      });
    }, "image/png");
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      throw err;
    }
    // User cancelled share - this is normal, don't throw
  }
}

export async function copyImageToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("Failed to create blob from canvas"));
          return;
        }

        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "image/png": blob,
            }),
          ]);
          resolve();
        } catch (err) {
          reject(err);
        }
      },
      "image/png"
    );
  });
}
```

- [ ] **Step 2: Verify syntax is correct**

Run from `packages/gbcam-extract-web`:
```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/gbcam-extract-web/src/utils/shareImage.ts
git commit -m "feat: add shareImage and copyImageToClipboard utilities"
```

---

### Task 11: Update ResultCard with share and copy buttons

**Files:**
- Modify: `packages/gbcam-extract-web/src/components/ResultCard.tsx`

- [ ] **Step 1: Add imports for share utilities and state management**

Add to imports:
```typescript
import { useState } from "react";
import { canShare, shareImage, copyImageToClipboard } from "../utils/shareImage.js";
```

- [ ] **Step 2: Add state for button feedback**

In the component function body, add after `const canvasRef = ...`:

```typescript
const [showCopyFeedback, setShowCopyFeedback] = useState(false);
const [shareSupported, setShareSupported] = useState(false);

useEffect(() => {
  canShare().then(setShareSupported);
}, []);
```

- [ ] **Step 3: Add share handler**

Add after the `handleDownload` function:

```typescript
const handleShare = async () => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  try {
    await shareImage(canvas, filename);
  } catch (err) {
    console.error("Failed to share image:", err);
  }
};

const handleCopy = async () => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  try {
    await copyImageToClipboard(canvas);
    setShowCopyFeedback(true);
    setTimeout(() => setShowCopyFeedback(false), 2000);
  } catch (err) {
    console.error("Failed to copy image:", err);
  }
};
```

- [ ] **Step 4: Update the buttons section in return**

Replace the button section (lines 63-68) with:

```typescript
<div className="flex flex-wrap gap-2 mt-3">
  <button
    onClick={handleDownload}
    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-xs font-medium transition-colors"
  >
    Download PNG
  </button>
  {shareSupported && (
    <button
      onClick={handleShare}
      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
    >
      Share
    </button>
  )}
  <button
    onClick={handleCopy}
    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
      showCopyFeedback
        ? "bg-gray-600 text-white"
        : "bg-gray-700 hover:bg-gray-600 text-white"
    }`}
  >
    {showCopyFeedback ? "Copied!" : "Copy"}
  </button>
</div>
```

- [ ] **Step 5: Verify no TypeScript errors**

Run from `packages/gbcam-extract-web`:
```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract-web/src/components/ResultCard.tsx
git commit -m "feat: add share and copy-to-clipboard buttons to ResultCard"
```

---

## Task Group 5: Local Test Server

### Task 12: Create serve-dist script

**Files:**
- Create: `packages/gbcam-extract-web/scripts/serve-dist.ts`

- [ ] **Step 1: Write serve-dist.ts script**

```typescript
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, "..");
const distDir = path.join(webDir, "dist");

async function main() {
  // Check if dist exists
  if (!existsSync(distDir)) {
    console.log("🔨 Building website...");
    await new Promise<void>((resolve, reject) => {
      const build = spawn("pnpm", ["build"], {
        cwd: webDir,
        stdio: "inherit",
      });
      build.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Build failed with code ${code}`));
      });
    });
  }

  console.log("🚀 Starting local server...");
  console.log(`📂 Serving from: ${distDir}`);

  // Use npx http-server (lightweight, no extra deps needed if already installed)
  // Fallback: use Node.js built-in http module
  const server = spawn("npx", ["http-server", distDir, "-p", "3000", "-c-1"], {
    stdio: "inherit",
  });

  console.log("🌐 Open http://localhost:3000 in your browser");
  console.log("📴 To test offline: DevTools > Network > Offline");
  console.log("⏹️  Press Ctrl+C to stop\n");

  process.on("SIGINT", () => {
    console.log("\n👋 Shutting down...");
    server.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add serve script to package.json**

Update the `scripts` section to include:

```json
"serve": "node scripts/serve-dist.ts"
```

- [ ] **Step 3: Verify the script has correct syntax**

Run: `node -c packages/gbcam-extract-web/scripts/serve-dist.ts`

Expected: No output (syntax is valid)

- [ ] **Step 4: Commit**

```bash
git add packages/gbcam-extract-web/scripts/serve-dist.ts packages/gbcam-extract-web/package.json
git commit -m "feat: add serve-dist script for local PWA testing"
```

---

### Task 13: Test the serve script

**Files:**
- No new files (testing only)

- [ ] **Step 1: Run the serve script**

Run from `packages/gbcam-extract-web`:
```bash
timeout 5 pnpm serve || true
```

Expected: Script runs, builds if needed, and prints server URL

- [ ] **Step 2: Verify dist folder was created**

Run: `ls -la packages/gbcam-extract-web/dist/`

Expected: dist folder contains built files (index.html, etc.)

- [ ] **Step 3: Manual test (optional, can skip)**

If you have time, open `http://localhost:3000` in a browser while running `pnpm serve` and verify:
- Page loads
- Can upload images
- Can switch palettes
- Can see draft palette option
- Can see share/copy buttons

---

## Task Group 6: Final Integration & Testing

### Task 14: Run full build and typecheck

**Files:**
- No modifications (verification only)

- [ ] **Step 1: Clean build from scratch**

Run from repo root:
```bash
pnpm clean
pnpm install
pnpm typecheck
```

Expected: No errors, all packages typecheck

- [ ] **Step 2: Build the web package**

Run from `packages/gbcam-extract-web`:
```bash
pnpm build
```

Expected: Build succeeds, dist folder is created

- [ ] **Step 3: Verify all new files are present**

Check that these exist:
- `supporting-materials/color-tables/game-boy-color-fun-palettes.csv`
- `packages/gbcam-extract-web/src/data/palettes-generated.ts`
- `packages/gbcam-extract-web/src/hooks/useDraftPalette.ts`
- `packages/gbcam-extract-web/src/utils/shareImage.ts`
- `packages/gbcam-extract-web/scripts/serve-dist.ts`

Run:
```bash
find . -name "palettes-generated.ts" -o -name "useDraftPalette.ts" -o -name "shareImage.ts" -o -name "serve-dist.ts" -o -name "game-boy-color-fun-palettes.csv"
```

Expected: All files found

---

### Task 15: Final commit and summary

**Files:**
- No new files

- [ ] **Step 1: Check git status**

Run:
```bash
git status
```

Expected: Working tree clean (all changes committed)

- [ ] **Step 2: View commit log**

Run:
```bash
git log --oneline -15
```

Expected: See commits from this feature set

- [ ] **Step 3: Create feature summary**

Run:
```bash
echo "✅ Website Enhancements Complete
- Palette CSV-driven architecture
- Draft custom palette with auto-save
- Enhanced progress indication (overall + per-image)
- Share button (native + copy-to-clipboard)
- Local test server for PWA testing"
```

- [ ] **Step 4: Ready for next steps**

All features are implemented and committed. Ready to:
- Create a pull request
- Merge to main
- Deploy to production

---

## Testing Checklist

Before declaring complete, verify:

- [ ] Palette generation works: `pnpm generate:palettes`
- [ ] Build succeeds: `pnpm build`
- [ ] Typecheck passes: `pnpm typecheck`
- [ ] Draft palette persists across page refresh
- [ ] Clicking preset palettes doesn't change draft
- [ ] Draft shows in palette picker when it exists
- [ ] Deleting draft goes back to last non-draft palette
- [ ] Progress bar shows total images and current step
- [ ] Share button appears on platforms that support it
- [ ] Copy button works and shows "Copied!" feedback
- [ ] Local server builds and serves correctly
- [ ] All existing functionality still works (download, palette switching, etc.)

---

## Notes

- All features are independent after Task 4 (palette generation)
- Draft palette uses localStorage key `gbcam_draft_palette`
- Progress tracking already hooks into pipeline's `onProgress` callback
- Share button gracefully degrades on unsupported platforms
- Palette generation is deterministic and can be re-run anytime
