# shadcn/ui Frontend Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement `packages/gbcam-extract-web/`'s UI on top of shadcn/ui (preset `b2UrMghYe`, base primitives, RTL enabled), eliminating duplicated UI patterns while preserving all existing user state and behavior.

**Architecture:** 11 sequential commits. Commit 1 installs shadcn + all expected components into isolated `src/shadcn/{components,hooks,utils}/` directories with no app edits. Commit 2 documents conventions in `AGENTS.md`. Commits 3–11 apply cross-cutting refactors first (storage, theme, accordion dedupe), then per-pattern sweeps (buttons, cards, forms, toasts, alerts, icons), ending with an RTL/polish audit. shadcn-installed files are immutable; any required edit gets a `// CUSTOM:` comment and a pause for user review.

**Tech Stack:** React 19, Tailwind v4 (CSS-first), shadcn/ui v4.5.0 (`base` primitives, preset `b2UrMghYe` = nova/fuchsia/neutral, `--rtl`), `next-themes` for light/dark, `lucide-react` for icons, `sonner` for toasts. Build: Vite 6, pnpm monorepo. No frontend test framework — verification via `pnpm typecheck` and manual `pnpm dev` smoke testing.

---

## Pre-flight

- [ ] **Step 0a: Confirm clean working tree**

Run from repo root:

```bash
git status
```

Expected: only intentional in-progress work shown. If there are unrelated staged/unstaged changes, commit or stash them before proceeding so each plan task produces a focused commit.

- [ ] **Step 0b: Confirm shadcn CLI is available**

Run from `packages/gbcam-extract-web/`:

```bash
pnpm shadcn --version
```

Expected: `4.5.0` (or newer 4.x).

- [ ] **Step 0c: Read the spec**

Read `docs/superpowers/specs/2026-04-27-shadcn-refactor-design.md` end-to-end before starting. The spec defines acceptance criteria for the whole refactor; this plan implements it.

---

## Task 1: shadcn setup + bulk install (commit 1)

**Files:**
- Create: `packages/gbcam-extract-web/components.json`
- Create: `packages/gbcam-extract-web/src/shadcn/components/*` (~18 component files via CLI)
- Create: `packages/gbcam-extract-web/src/shadcn/utils/utils.ts`
- Modify: `packages/gbcam-extract-web/package.json`
- Modify: `packages/gbcam-extract-web/tsconfig.json`
- Modify: `packages/gbcam-extract-web/vite.config.ts`
- Modify: `packages/gbcam-extract-web/src/index.css`

This task makes **no app/component edits** — only install + config.

- [ ] **Step 1.1: Run shadcn init**

Run from `packages/gbcam-extract-web/`:

```bash
pnpm shadcn init --preset b2UrMghYe --base base --rtl --yes
```

Expected: creates `components.json`, edits `src/index.css` to add the nova/fuchsia/neutral CSS variables and `@theme inline` block, writes `cn()` to whatever `lib`/`utils` location the CLI defaults to (`src/lib/utils.ts` typically). May install peer deps (`clsx`, `tailwind-merge`, `class-variance-authority`).

- [ ] **Step 1.2: Inspect what init created**

Run from `packages/gbcam-extract-web/`:

```bash
ls -la src/lib 2>/dev/null
ls -la src/components 2>/dev/null
ls -la src/hooks 2>/dev/null
cat components.json
```

Note where `utils.ts` landed and what aliases `components.json` set by default. The next steps relocate these.

- [ ] **Step 1.3: Edit `components.json` aliases**

Open `packages/gbcam-extract-web/components.json` and set the `aliases` block to exactly:

```json
"aliases": {
  "components": "@/shadcn/components",
  "ui": "@/shadcn/components",
  "lib": "@/shadcn/utils",
  "utils": "@/shadcn/utils/utils",
  "hooks": "@/shadcn/hooks"
}
```

Leave all other fields the CLI generated unchanged (style, baseColor, tailwind config, iconLibrary, etc.).

- [ ] **Step 1.4: Add `@/` path alias to `tsconfig.json`**

Edit `packages/gbcam-extract-web/tsconfig.json` to read:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 1.5: Add `@/` resolve.alias to `vite.config.ts`**

Edit `packages/gbcam-extract-web/vite.config.ts` to add a `resolve.alias`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["opencv.js"],
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,png,svg,json}"],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.png$/,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
  base: "./",
});
```

- [ ] **Step 1.6: Relocate `utils.ts` to the new shadcn folder**

If init created `src/lib/utils.ts`, move it:

```bash
mkdir -p src/shadcn/utils
git mv src/lib/utils.ts src/shadcn/utils/utils.ts
rmdir src/lib 2>/dev/null || true
```

If init created any other files in default locations (e.g., `src/components/ui/`, `src/hooks/`), inspect them. UI primitive directories should be empty at this point (we haven't `add`ed any). Hooks directory may not exist yet.

Open `src/shadcn/utils/utils.ts` and verify it's the standard:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

If init wrote different contents, leave them — that's the CLI's choice.

- [ ] **Step 1.7: Install `next-themes`**

Run from `packages/gbcam-extract-web/`:

```bash
pnpm add next-themes
```

Expected: `next-themes` appears under `dependencies` in `package.json`.

- [ ] **Step 1.8: Bulk-install all expected shadcn components**

Run from `packages/gbcam-extract-web/`:

```bash
pnpm shadcn add accordion alert badge button card checkbox collapsible dialog dropdown-menu empty field input label progress select separator sonner tooltip --yes
```

Expected: all components land in `src/shadcn/components/` (per the alias set in step 1.3). Each is a `.tsx` file. Some may pull in deps to `src/shadcn/hooks/` (e.g., a `use-mobile` hook for some primitives).

- [ ] **Step 1.9: Verify all installed components landed in the right place**

Run from `packages/gbcam-extract-web/`:

```bash
ls src/shadcn/components/
ls src/shadcn/utils/
ls src/shadcn/hooks/ 2>/dev/null
ls src/lib/ 2>/dev/null && echo "ERROR: src/lib still exists"
ls src/components/ui/ 2>/dev/null && echo "ERROR: src/components/ui still exists"
```

Expected: 18+ files in `src/shadcn/components/`, `utils.ts` in `src/shadcn/utils/`, no leftover `src/lib/` or `src/components/ui/` directories. If a leftover directory contains files, inspect and either move to `src/shadcn/...` or delete (only if confirmed shadcn-generated).

- [ ] **Step 1.10: Spot-check a component imports `cn` from the right path**

Run from `packages/gbcam-extract-web/`:

```bash
grep -n "from " src/shadcn/components/button.tsx | head -10
```

Expected: any import of `cn` reads `from "@/shadcn/utils/utils"`. If it instead reads `@/lib/utils`, the CLI didn't pick up the new aliases — fix by editing the import (this counts as a `// CUSTOM:` edit; document and continue per the protocol). Re-running `pnpm shadcn add <component> --overwrite` after fixing aliases is also acceptable.

- [ ] **Step 1.11: Verify typecheck passes**

Run from repo root:

```bash
pnpm typecheck
```

Expected: PASS. If errors mention `@/shadcn/utils/utils` not resolving, the path alias setup is wrong — re-check steps 1.4 and 1.5.

- [ ] **Step 1.12: Smoke-test the dev server**

Run from `packages/gbcam-extract-web/`:

```bash
pnpm dev
```

Open the printed URL in a browser. Expected: app loads as before (no theme/visual changes yet — we haven't edited any app code). No console errors mentioning shadcn or `@/` imports. Stop the dev server (`Ctrl+C`) when verified.

- [ ] **Step 1.13: Commit**

Run from repo root:

```bash
git add packages/gbcam-extract-web/components.json \
        packages/gbcam-extract-web/tsconfig.json \
        packages/gbcam-extract-web/vite.config.ts \
        packages/gbcam-extract-web/src/index.css \
        packages/gbcam-extract-web/src/shadcn/ \
        packages/gbcam-extract-web/package.json \
        pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(web): set up shadcn/ui with preset b2UrMghYe (base, rtl)

Initialize shadcn with nova/fuchsia/neutral preset using base primitives
and RTL support. Configure aliases to isolate shadcn files in
src/shadcn/{components,hooks,utils}/. Add @/ path alias. Bulk-install the
component set this refactor needs (accordion, alert, badge, button, card,
checkbox, collapsible, dialog, dropdown-menu, empty, field, input, label,
progress, select, separator, sonner, tooltip). Install next-themes for
the upcoming theme provider work. No app or component edits in this
commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: clean commit. `git status` shows working tree clean.

---

## Task 2: AGENTS.md frontend conventions (commit 2)

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 2.1: Append the conventions section to AGENTS.md**

The existing `AGENTS.md` ends with a "Goal" section at the bottom. Append a new top-level section **after** the "Goal" section. Open `AGENTS.md` and add at the end of the file:

```markdown

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
```

- [ ] **Step 2.2: Verify the file is syntactically valid markdown**

Open `AGENTS.md` and skim the new section — confirm no broken table syntax, no unclosed code fences, headings nest properly under existing structure.

- [ ] **Step 2.3: Commit**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
docs: add Frontend Conventions section to AGENTS.md

Document shadcn/ui usage patterns for the gbcam-extract-web package:
component lookup commands, no-edit policy on installed shadcn files,
semantic color and logical Tailwind class rules, lucide-only icon policy,
base-primitive composition rules, theming approach, and the new
useLocalStorage abstraction for state persistence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: localStorage abstraction (commit 3)

**Files:**
- Create: `packages/gbcam-extract-web/src/hooks/useLocalStorage.ts`
- Create: `packages/gbcam-extract-web/src/hooks/useAppSettings.ts`
- Modify: `packages/gbcam-extract-web/src/hooks/useImageHistory.ts`
- Modify: `packages/gbcam-extract-web/src/hooks/useUserPalettes.ts`
- Modify: `packages/gbcam-extract-web/src/hooks/usePaletteSectionState.ts`
- Modify: `packages/gbcam-extract-web/src/components/CollapsibleInstructions.tsx`
- Modify: `packages/gbcam-extract-web/src/App.tsx`

All existing storage keys + JSON shapes preserved.

- [ ] **Step 3.1: Create `useLocalStorage.ts`**

Create `packages/gbcam-extract-web/src/hooks/useLocalStorage.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";

type SetValue<T> = (value: T | ((prev: T) => T)) => void;

/**
 * Generic typed localStorage hook with JSON serialization, error tolerance,
 * and cross-tab sync via the storage event.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, SetValue<T>] {
  const readValue = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initialValue;
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  }, [key, initialValue]);

  const [value, setValueState] = useState<T>(readValue);
  const valueRef = useRef(value);
  valueRef.current = value;

  const setValue: SetValue<T> = useCallback(
    (next) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: T) => T)(valueRef.current)
          : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch (e) {
        console.error(`useLocalStorage: failed to write key "${key}"`, e);
      }
      setValueState(resolved);
    },
    [key],
  );

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      try {
        setValueState(JSON.parse(e.newValue) as T);
      } catch {
        // Ignore parse errors from other-tab writes.
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [key]);

  return [value, setValue];
}
```

- [ ] **Step 3.2: Create `useAppSettings.ts`**

Create `packages/gbcam-extract-web/src/hooks/useAppSettings.ts`:

```ts
import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage.js";
import type { PaletteEntry } from "../data/palettes.js";

const STORAGE_KEY = "gbcam-app-settings";

export interface AppSettings {
  debug: boolean;
  clipboardEnabled: boolean;
  outputScale: number;
  previewScale: number;
  paletteSelection?: PaletteEntry;
}

const DEFAULTS: AppSettings = {
  debug: false,
  clipboardEnabled: false,
  outputScale: 1,
  previewScale: 2,
};

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage<AppSettings>(
    STORAGE_KEY,
    DEFAULTS,
  );

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [setSettings],
  );

  return { settings: { ...DEFAULTS, ...settings }, updateSetting };
}
```

- [ ] **Step 3.3: Refactor `usePaletteSectionState.ts` to use `useLocalStorage`**

Replace `packages/gbcam-extract-web/src/hooks/usePaletteSectionState.ts` contents with:

```ts
import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage.js";

const STORAGE_KEY = "gbcam-palette-sections-expanded";

export function usePaletteSectionState() {
  const [expanded, setExpanded] = useLocalStorage<string[]>(STORAGE_KEY, []);

  const isExpanded = useCallback(
    (sectionTitle: string): boolean => expanded.includes(sectionTitle),
    [expanded],
  );

  const toggleExpanded = useCallback(
    (sectionTitle: string) => {
      setExpanded((prev) =>
        prev.includes(sectionTitle)
          ? prev.filter((s) => s !== sectionTitle)
          : [...prev, sectionTitle],
      );
    },
    [setExpanded],
  );

  return { isExpanded, toggleExpanded };
}
```

Note: storage key + JSON shape (string array) preserved. Set was just an in-memory representation; on disk it was always JSON-serialized as an array.

- [ ] **Step 3.4: Refactor `useUserPalettes.ts` to use `useLocalStorage`**

Edit `packages/gbcam-extract-web/src/hooks/useUserPalettes.ts`. Replace the storage helpers and `useState`/`useEffect` block at the top of the function with `useLocalStorage`. Keep the `STORAGE_VERSION` check semantics (if version mismatch, treat as empty).

Replace lines 1-46 (everything from the imports through `useEffect(() => { saveToStorage(...) }, [palettes])`) with:

```ts
import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage.js";

const STORAGE_KEY = "gbcam-user-palettes";
const STORAGE_VERSION = "1";
const STORAGE_VERSION_KEY = "gbcam-user-palettes-version";

export interface UserPaletteEntry {
  id: string;
  name: string;
  colors: [string, string, string, string];
  isEditing?: boolean;
  savedColors?: [string, string, string, string];
  savedName?: string;
}

function generateId(): string {
  return `palette-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function readVersionedInitial(): UserPaletteEntry[] {
  try {
    if (localStorage.getItem(STORAGE_VERSION_KEY) !== STORAGE_VERSION) {
      return [];
    }
  } catch {
    return [];
  }
  return [];
}

export function useUserPalettes() {
  const [palettes, setPalettes] = useLocalStorage<UserPaletteEntry[]>(
    STORAGE_KEY,
    readVersionedInitial(),
  );

  // Ensure version key is up to date whenever we have palettes.
  // (Cheap to write; runs on every state change.)
  try {
    localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
  } catch {
    // ignore
  }
```

(Keep all the callback functions — `createPaletteInEditMode`, `updatePalette`, `savePalette`, `cancelPaletteEdit`, `deletePalette`, `startEditingPalette` — unchanged. They already use `setPalettes`, which works the same way.)

- [ ] **Step 3.5: Refactor `useImageHistory.ts` to use `useLocalStorage`**

`useImageHistory` is more complex because it has async deserialization. Replace the storage helpers and the load `useEffect` at the top with `useLocalStorage` for the *raw* serialized form, then do async deserialize in a `useEffect`.

Open `packages/gbcam-extract-web/src/hooks/useImageHistory.ts`. Replace:

- Lines 34-92 (the `loadHistoryFromStorage`, `deserializeHistoryBatches`, `loadSettingsFromStorage`, `saveHistoryToStorage`, `saveSettingsToStorage` functions) and
- Lines 94-138 (the `useState` declarations and the two `useEffect` blocks that handle load and save)

with the version below. The `archiveResults`, `deleteFromHistory`, `deleteBatch`, `deleteAllHistory`, `updateSettings`, `pruneHistory` callbacks below those lines stay unchanged.

```ts
import { useState, useCallback, useEffect } from "react";
import type { PipelineResult } from "gbcam-extract";
import {
  serializePipelineResult,
  deserializePipelineResult,
  isSerializedPipelineResult,
} from "../utils/serialization.js";
import { useLocalStorage } from "./useLocalStorage.js";

export interface ProcessingResult {
  result: PipelineResult;
  filename: string;
  processingTime: number;
}

export interface ImageHistoryBatch {
  id: string;
  timestamp: number;
  results: ProcessingResult[];
}

export interface HistorySettings {
  maxSize: number;
}

const HISTORY_STORAGE_KEY = "gbcam-image-history";
const HISTORY_SETTINGS_KEY = "gbcam-history-settings";
const DEFAULT_MAX_SIZE = 10;
const MAX_BATCH_SIZE = 10;

function generateId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Serialized form on disk (each result has a serialized PipelineResult).
type SerializedHistory = Array<{
  id: string;
  timestamp: number;
  results: Array<{
    filename: string;
    processingTime: number;
    result: unknown; // SerializedPipelineResult shape
  }>;
}>;

async function deserializeHistoryBatches(
  raw: SerializedHistory,
): Promise<ImageHistoryBatch[]> {
  return Promise.all(
    raw.map(async (batch) => ({
      ...batch,
      results: await Promise.all(
        batch.results.map(async (item) => ({
          ...item,
          result: isSerializedPipelineResult(item.result)
            ? await deserializePipelineResult(item.result)
            : (item.result as PipelineResult),
        })),
      ),
    })),
  );
}

function serializeHistoryBatches(
  history: ImageHistoryBatch[],
): SerializedHistory {
  return history.map((batch) => ({
    ...batch,
    results: batch.results.map((item) => ({
      ...item,
      result: serializePipelineResult(item.result),
    })),
  }));
}

export function useImageHistory() {
  // Raw serialized form persisted via the localStorage hook.
  const [serializedHistory, setSerializedHistory] =
    useLocalStorage<SerializedHistory>(HISTORY_STORAGE_KEY, []);
  const [settings, setSettings] = useLocalStorage<HistorySettings>(
    HISTORY_SETTINGS_KEY,
    { maxSize: DEFAULT_MAX_SIZE },
  );

  // Deserialized in-memory form (async deserialize on mount/storage change).
  const [history, setHistory] = useState<ImageHistoryBatch[]>([]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  useEffect(() => {
    let mounted = true;
    deserializeHistoryBatches(serializedHistory)
      .then((deserialized) => {
        if (mounted) {
          setHistory(deserialized);
          setIsHistoryLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setHistory([]);
          setIsHistoryLoaded(true);
          setSerializedHistory([]);
        }
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only re-deserialize on mount; subsequent in-memory updates flow the other direction.

  // Re-serialize and persist whenever in-memory history changes after load.
  useEffect(() => {
    if (!isHistoryLoaded) return;
    setSerializedHistory(serializeHistoryBatches(history));
  }, [history, isHistoryLoaded, setSerializedHistory]);
```

Keep the rest of the file (the `archiveResults` through `return` block) **unchanged** — those callbacks already operate on the in-memory `history` state and call `setHistory` / `setSettings`.

- [ ] **Step 3.6: Update `CollapsibleInstructions.tsx` to use `useLocalStorage`**

Replace `packages/gbcam-extract-web/src/components/CollapsibleInstructions.tsx` contents with:

```tsx
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";

const INSTRUCTIONS_STORAGE_KEY = "gbcam-instructions-open";

/**
 * Collapsible instructions panel that persists open/closed state to localStorage.
 */
export function CollapsibleInstructions({ markdown }: { markdown: string }) {
  const [isOpen, setIsOpen] = useLocalStorage<boolean>(
    INSTRUCTIONS_STORAGE_KEY,
    true,
  );

  return (
    <div className="mb-6 border border-gray-600 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-left font-semibold text-gray-100 flex items-center justify-between transition-colors"
      >
        <span>Instructions</span>
        <span
          className="text-lg transform transition-transform"
          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="p-4 bg-gray-900 text-gray-300 max-h-96 overflow-y-auto">
          <MarkdownRenderer markdown={markdown} />
        </div>
      )}
    </div>
  );
}
```

(The visual styling is intentionally kept identical — Task 5 will swap this to `<Collapsible>`. This task only changes storage plumbing.)

- [ ] **Step 3.7: Update `App.tsx` to use `useAppSettings`**

Open `packages/gbcam-extract-web/src/App.tsx`. Replace the block from the top of the `App` component down through the localStorage-loading `useEffect`, plus the four setter callbacks.

Specifically:

1. Remove the `APP_SETTINGS_KEY` constant near the top of the file.
2. Remove the `useState` calls for `debug`, `clipboardEnabled`, `outputScale`, `previewScale`, and `paletteEntry`.
3. Remove the five hand-rolled setter callbacks (`setDebug`, `setClipboardEnabled`, `setOutputScale`, `setPreviewScale`, `handlePaletteSelected`).
4. Remove the `useEffect` that loads settings from localStorage.
5. Add `import { useAppSettings } from "./hooks/useAppSettings.js";` at the top.
6. Inside the `App` component, replace those removed pieces with:

```ts
const { settings, updateSetting } = useAppSettings();
const debug = settings.debug;
const clipboardEnabled = settings.clipboardEnabled;
const outputScale = settings.outputScale;
const previewScale = settings.previewScale;
const paletteEntry = settings.paletteSelection ?? {
  name: "Down",
  colors: ["#FFFFA5", "#FF9494", "#9494FF", "#000000"],
};

const setDebug = (value: boolean) => updateSetting("debug", value);
const setClipboardEnabled = (value: boolean) =>
  updateSetting("clipboardEnabled", value);
const setOutputScale = (value: number) => updateSetting("outputScale", value);
const setPreviewScale = (value: number) =>
  updateSetting("previewScale", value);
const handlePaletteSelected = (entry: PaletteEntry) =>
  updateSetting("paletteSelection", entry);
```

All existing call sites that read these or call the setters work unchanged.

- [ ] **Step 3.8: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: PASS. If errors, the most likely cause is a missed import or stale reference to a removed `setDebug` etc. — re-read the diff.

- [ ] **Step 3.9: Smoke-test storage roundtrip**

Run `pnpm dev` from `packages/gbcam-extract-web/`. Open the app in a browser. With dev tools open:

1. Toggle "Debug mode" on. In Application → Local Storage, confirm `gbcam-app-settings` updates with `"debug":true`.
2. Reload the page. Confirm "Debug mode" is still on.
3. Expand the Instructions panel; confirm `gbcam-instructions-open` reflects state.
4. If you have prior `gbcam-image-history` data, confirm history loads on mount.

Stop the dev server.

- [ ] **Step 3.10: Commit**

```bash
git add packages/gbcam-extract-web/src/hooks/useLocalStorage.ts \
        packages/gbcam-extract-web/src/hooks/useAppSettings.ts \
        packages/gbcam-extract-web/src/hooks/useImageHistory.ts \
        packages/gbcam-extract-web/src/hooks/useUserPalettes.ts \
        packages/gbcam-extract-web/src/hooks/usePaletteSectionState.ts \
        packages/gbcam-extract-web/src/components/CollapsibleInstructions.tsx \
        packages/gbcam-extract-web/src/App.tsx
git commit -m "$(cat <<'EOF'
refactor(web): centralize localStorage on a useLocalStorage hook

Add a generic useLocalStorage<T> hook that handles JSON ser/de, error
tolerance, and cross-tab sync via the storage event. Add useAppSettings
that wraps the gbcam-app-settings blob. Refactor useImageHistory,
useUserPalettes, usePaletteSectionState to ride on top — keeping all
existing storage keys and JSON shapes so user state survives this commit.
Replace App.tsx's hand-rolled setter callbacks with updateSetting; replace
CollapsibleInstructions's bespoke localStorage handling with the hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ThemeProvider + ModeToggle + theme-aware icons/favicon (commit 4)

**Files:**
- Modify: `packages/gbcam-extract-web/src/main.tsx`
- Create: `packages/gbcam-extract-web/src/components/ModeToggle.tsx`
- Create: `packages/gbcam-extract-web/src/hooks/useFaviconSwap.ts`
- Modify: `packages/gbcam-extract-web/src/App.tsx`
- Modify: `packages/gbcam-extract-web/index.html`
- Modify: `packages/gbcam-extract-web/public/manifest.json`

- [ ] **Step 4.1: Wrap App in ThemeProvider in `main.tsx`**

Open `packages/gbcam-extract-web/src/main.tsx`. Add the import and wrap `<App />`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.js";
import "./index.css";

// (keep the existing service worker registration block unchanged)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4.2: Create `ModeToggle.tsx`**

Create `packages/gbcam-extract-web/src/components/ModeToggle.tsx`:

```tsx
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/shadcn/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shadcn/components/dropdown-menu";

export function ModeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" aria-label="Toggle theme" />}
      >
        <Sun className="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("light")}>
          <Sun data-icon="inline-start" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>
          <Moon data-icon="inline-start" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <Monitor data-icon="inline-start" />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

If the installed `Button` component's API doesn't match `render={<Button .../>}` (i.e. the CLI installed a radix variant despite our preset), inspect `src/shadcn/components/button.tsx` and adapt. If a real `// CUSTOM:` edit is needed in any installed component, follow the no-edit protocol.

- [ ] **Step 4.3: Create `useFaviconSwap.ts`**

Create `packages/gbcam-extract-web/src/hooks/useFaviconSwap.ts`:

```ts
import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Updates the runtime favicon link to match the resolved (light/dark) theme.
 * The static <link rel="icon"> tags in index.html handle first paint via
 * media queries; this hook overrides the favicon when the user picks a theme
 * different from their OS preference.
 */
export function useFaviconSwap() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;
    const isDark = resolvedTheme === "dark";
    const href = isDark ? "./icon-dark.svg" : "./icon.svg";
    const cacheBuster = `?v=${resolvedTheme}`;

    let link = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"][data-runtime="true"]',
    );
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      link.dataset.runtime = "true";
      document.head.appendChild(link);
    }
    link.href = `${href}${cacheBuster}`;
  }, [resolvedTheme]);
}
```

- [ ] **Step 4.4: Update `App.tsx` to use `useTheme` for the icon and call `useFaviconSwap`**

In `packages/gbcam-extract-web/src/App.tsx`:

1. Add imports at the top:

```ts
import { useTheme } from "next-themes";
import { useFaviconSwap } from "./hooks/useFaviconSwap.js";
import { ModeToggle } from "./components/ModeToggle.js";
```

2. Inside the `App` function, near the other hook calls:

```ts
const { resolvedTheme } = useTheme();
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
useFaviconSwap();
const iconSrc =
  mounted && resolvedTheme === "dark" ? "./icon-dark.svg" : "./icon.svg";
```

3. Replace the existing app-icon `<img>` JSX:

```tsx
<img src="./icon.svg" alt="App Icon" className="w-8 h-8" />
```

with:

```tsx
<img src={iconSrc} alt="App Icon" className="size-8" />
```

4. In the header `<div className="flex justify-between items-center mb-6">` block, change the right-side install-button area to also include `<ModeToggle />`. Find:

```tsx
{isInstallable && (
  <button
    onClick={handleInstallApp}
    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
    title="Install this app on your device"
  >
    Install App
  </button>
)}
```

Wrap in a flex container alongside ModeToggle:

```tsx
<div className="flex items-center gap-2">
  <ModeToggle />
  {isInstallable && (
    <button
      onClick={handleInstallApp}
      className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
      title="Install this app on your device"
    >
      Install App
    </button>
  )}
</div>
```

(The Install button still uses raw classes — Task 6 will sweep it. We're focused on theme infra in this commit.)

- [ ] **Step 4.5: Update `index.html` favicon and theme-color meta**

Open `packages/gbcam-extract-web/index.html`. Replace the `<head>` block to add media-query favicon links and theme-color pairs:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
    <link rel="manifest" href="./manifest.json" />
    <link rel="icon" type="image/svg+xml" href="./icon.svg" media="(prefers-color-scheme: light)" />
    <link rel="icon" type="image/svg+xml" href="./icon-dark.svg" media="(prefers-color-scheme: dark)" />
    <link rel="icon" type="image/png" href="./icon.png" media="(prefers-color-scheme: light)" />
    <link rel="icon" type="image/png" href="./icon-dark.png" media="(prefers-color-scheme: dark)" />
    <title>Game Boy Camera Extractor</title>
  </head>
  <body class="bg-background text-foreground min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Note `body` classes switched to semantic tokens (`bg-background text-foreground`) — this stops fighting with the theme provider.

- [ ] **Step 4.6: Update `public/manifest.json` with both icon variants**

Edit `packages/gbcam-extract-web/public/manifest.json`. Replace the `icons` array to list both light and dark variants. The shortcuts and screenshots can keep the light icon as their default.

```json
"icons": [
  {
    "src": "icon.png",
    "sizes": "192x192",
    "type": "image/png",
    "purpose": "any"
  },
  {
    "src": "icon-dark.png",
    "sizes": "192x192",
    "type": "image/png",
    "purpose": "any"
  },
  {
    "src": "icon.png",
    "sizes": "512x512",
    "type": "image/png",
    "purpose": "any maskable"
  },
  {
    "src": "icon-dark.png",
    "sizes": "512x512",
    "type": "image/png",
    "purpose": "any maskable"
  },
  {
    "src": "icon.svg",
    "sizes": "any",
    "type": "image/svg+xml",
    "purpose": "any"
  },
  {
    "src": "icon-dark.svg",
    "sizes": "any",
    "type": "image/svg+xml",
    "purpose": "any"
  }
]
```

(PWA manifest icon `media` field is poorly supported across browsers; listing both lets the OS pick. Browsers without preference fall back to the first matching size.)

- [ ] **Step 4.7: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4.8: Smoke-test theme switching**

Run `pnpm dev`. In the browser:

1. Click `<ModeToggle>` (sun/moon icon, top-right of header).
2. Pick "Light" → page goes light, app icon swaps, favicon swaps within ~100ms.
3. Pick "Dark" → page goes dark, icons swap.
4. Pick "System" → matches OS preference.
5. Reload — choice persists (localStorage `theme` key from next-themes).

Stop dev server.

- [ ] **Step 4.9: Commit**

```bash
git add packages/gbcam-extract-web/src/main.tsx \
        packages/gbcam-extract-web/src/App.tsx \
        packages/gbcam-extract-web/src/components/ModeToggle.tsx \
        packages/gbcam-extract-web/src/hooks/useFaviconSwap.ts \
        packages/gbcam-extract-web/index.html \
        packages/gbcam-extract-web/public/manifest.json
git commit -m "$(cat <<'EOF'
feat(web): add ThemeProvider, ModeToggle, theme-aware icons and favicon

Wrap the app in next-themes' ThemeProvider with system/light/dark options,
persisted to localStorage. Add a ModeToggle dropdown to the header (sun/
moon/monitor icons via lucide). Swap the app <img> based on the resolved
theme. Add media-query favicon links in index.html plus a JS-driven swap
hook so in-app theme overrides update the favicon (with cache-buster).
List light/dark icon variants in the PWA manifest. Switch <body> to
semantic color tokens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Accordions / Collapsibles dedupe (commit 5)

**Files:**
- Modify: `packages/gbcam-extract-web/src/components/CollapsibleInstructions.tsx`
- Modify: `packages/gbcam-extract-web/src/components/PipelineDebugViewer.tsx`
- Modify: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`
- Modify: `packages/gbcam-extract-web/src/App.tsx` (Image History section)

Each rewrite uses `<Collapsible>` (single panel) or `<Accordion multiple>` (multi-panel) primitives from `@/shadcn/components/...`. Triggers use `render={<Button variant="ghost" />}` (base style). Chevrons use `lucide-react` `ChevronDown` rotated via `data-state`.

- [ ] **Step 5.1: Rewrite `CollapsibleInstructions.tsx`**

Replace `packages/gbcam-extract-web/src/components/CollapsibleInstructions.tsx` contents:

```tsx
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shadcn/components/collapsible";
import { Button } from "@/shadcn/components/button";
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";

const INSTRUCTIONS_STORAGE_KEY = "gbcam-instructions-open";

export function CollapsibleInstructions({ markdown }: { markdown: string }) {
  const [isOpen, setIsOpen] = useLocalStorage<boolean>(
    INSTRUCTIONS_STORAGE_KEY,
    true,
  );

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="mb-6 rounded-lg border bg-card text-card-foreground"
    >
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="w-full justify-between rounded-b-none px-4 py-3 font-semibold"
          />
        }
      >
        Instructions
        <ChevronDown
          className="transition-transform data-[state=open]:rotate-180"
          data-icon="inline-end"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-96 overflow-y-auto p-4">
          <MarkdownRenderer markdown={markdown} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 5.2: Rewrite `PipelineDebugViewer.tsx`**

This file replaces the former `IntermediateViewer.tsx`. It currently has:

- An outer toggle (`Debug: Pipeline Diagnostics`)
- Its own ad-hoc `CollapsibleSection` helper used four times (Intermediate Steps default-open, Debug Images, Metrics, Log)

Both the outer toggle and the inner helper get replaced with shadcn primitives. The `CollapsibleSection` helper is deleted entirely.

Replace `packages/gbcam-extract-web/src/components/PipelineDebugViewer.tsx` contents with:

```tsx
import { useEffect, useMemo, useRef } from "react";
import type { GBImageData, PipelineResult } from "gbcam-extract";
import { ChevronDown } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shadcn/components/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shadcn/components/collapsible";
import { Badge } from "@/shadcn/components/badge";
import { Button } from "@/shadcn/components/button";
import { Card } from "@/shadcn/components/card";

interface PipelineDebugViewerProps {
  intermediates?: PipelineResult["intermediates"];
  debug?: PipelineResult["debug"];
}

/** Render a GBImageData onto a canvas, scaled to fit `maxW` pixels wide. */
function StepCanvas({
  label,
  image,
  maxW = 256,
}: {
  label: string;
  image: GBImageData;
  maxW?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = image.width > maxW ? maxW / image.width : 1;
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);

    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const cloned = new Uint8ClampedArray(image.data);
    const imgData = new ImageData(cloned, image.width, image.height);
    const tmp = document.createElement("canvas");
    tmp.width = image.width;
    tmp.height = image.height;
    tmp.getContext("2d")!.putImageData(imgData, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }, [image, maxW]);

  return (
    <Card
      className="flex flex-col items-center gap-1 p-2 shrink-0"
      style={{ maxWidth: maxW }}
    >
      <p className="text-xs font-medium text-muted-foreground text-center break-all">
        {label}
      </p>
      <canvas
        ref={canvasRef}
        className="rounded border"
        style={{ imageRendering: "pixelated" }}
      />
      <Badge variant="secondary" className="text-[10px]">
        {image.width} × {image.height}
      </Badge>
    </Card>
  );
}

/** Group debug image keys by the step they belong to (prefix before first underscore). */
function groupDebugImages(
  images: Record<string, GBImageData>,
): Array<{ step: string; entries: Array<[string, GBImageData]> }> {
  const groups = new Map<string, Array<[string, GBImageData]>>();
  for (const [name, img] of Object.entries(images)) {
    const step = name.split("_")[0] ?? "other";
    if (!groups.has(step)) groups.set(step, []);
    groups.get(step)!.push([name, img]);
  }
  const stepOrder = ["warp", "correct", "crop", "sample", "quantize"];
  return stepOrder
    .filter((s) => groups.has(s))
    .map((step) => ({
      step,
      entries: groups.get(step)!.sort(([a], [b]) => a.localeCompare(b)),
    }));
}

export function PipelineDebugViewer({
  intermediates,
  debug,
}: PipelineDebugViewerProps) {
  const intermediateSteps = useMemo(() => {
    if (!intermediates) return [];
    return [
      { label: "Warp", image: intermediates.warp },
      { label: "Correct", image: intermediates.correct },
      { label: "Crop", image: intermediates.crop },
      { label: "Sample", image: intermediates.sample },
    ];
  }, [intermediates]);

  const debugImageGroups = useMemo(
    () => (debug?.images ? groupDebugImages(debug.images) : []),
    [debug],
  );

  if (!intermediates && !debug) return null;

  const hasMetrics = !!debug && Object.keys(debug.metrics).length > 0;
  const hasLog = !!debug && debug.log.length > 0;

  // Build the list of inner accordion item values that should be open by default.
  const defaultOpen: string[] = [];
  if (intermediateSteps.length > 0) defaultOpen.push("intermediate");

  return (
    <Collapsible className="mt-2 rounded-lg bg-muted/40 p-3">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
      >
        Debug: Pipeline Diagnostics
        <ChevronDown
          className="transition-transform data-[state=open]:rotate-180"
          data-icon="inline-end"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Accordion multiple defaultValue={defaultOpen} className="mt-2">
          {intermediateSteps.length > 0 && (
            <AccordionItem value="intermediate">
              <AccordionTrigger>Intermediate Steps</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-wrap items-start gap-3">
                  {intermediateSteps.map((step) => (
                    <StepCanvas
                      key={step.label}
                      label={step.label}
                      image={step.image}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {debugImageGroups.length > 0 && (
            <AccordionItem value="debug-images">
              <AccordionTrigger>Debug Images</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  {debugImageGroups.map(({ step, entries }) => (
                    <div key={step}>
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        {step}
                      </p>
                      <div className="flex flex-wrap items-start gap-3">
                        {entries.map(([name, img]) => (
                          <StepCanvas key={name} label={name} image={img} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {hasMetrics && (
            <AccordionItem value="metrics">
              <AccordionTrigger>Metrics</AccordionTrigger>
              <AccordionContent>
                <pre className="overflow-x-auto whitespace-pre rounded bg-background/60 p-2 text-[11px]">
                  {JSON.stringify(debug!.metrics, null, 2)}
                </pre>
              </AccordionContent>
            </AccordionItem>
          )}

          {hasLog && (
            <AccordionItem value="log">
              <AccordionTrigger>Log ({debug!.log.length} lines)</AccordionTrigger>
              <AccordionContent>
                <pre className="overflow-x-auto whitespace-pre rounded bg-background/60 p-2 text-[11px]">
                  {debug!.log.join("\n")}
                </pre>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

Note: this component is only rendered next to *current* results in `App.tsx` (line ~412 of the current source: `{(r.result.intermediates || r.result.debug) && <PipelineDebugViewer ... />}`). Results loaded from history don't have `intermediates`/`debug` (per `serialization.ts`), so the conditional + the component's own `if (!intermediates && !debug) return null` together hide it for history items. No change to the App.tsx wiring is needed in this task.

- [ ] **Step 5.3: Rewrite the palette section list in `PalettePicker.tsx`**

This is the biggest change in this task. The five `<PaletteSection>` instances at the bottom of `PalettePicker.tsx` (User Palettes / Button Combos / BG Presets / Additional / Fun) consolidate into one `<Accordion multiple>`.

Find the inner `PaletteSection` component (lines ~88-161 of the current file) and the five `<PaletteSection>` JSX usages (the bottom of the `return` block). Replace `PaletteSection` with a smaller `<AccordionItem>`-based renderer, and replace the five usages with a single `<Accordion>`.

Edit `packages/gbcam-extract-web/src/components/PalettePicker.tsx`:

1. Add imports near the top:

```ts
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shadcn/components/accordion";
```

2. Delete the existing `PaletteSection` function (lines ~88-161).

3. Replace it with a new `PaletteSectionItem` that renders a single `AccordionItem`:

```tsx
function PaletteSectionItem({
  title,
  entries,
  selected,
  onSelectWithName,
  onEdit,
  isBuiltIn,
}: {
  title: string;
  entries: (PaletteEntry | UserPaletteEntry)[];
  selected: PaletteEntry;
  onSelectWithName: (entry: PaletteEntry) => void;
  onEdit?: (id: string, entry: UserPaletteEntry) => void;
  isBuiltIn?: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <AccordionItem value={title}>
      <AccordionTrigger>
        {title} ({entries.length})
      </AccordionTrigger>
      <AccordionContent>
        <div className="grid grid-cols-2 gap-1.5 ms-3 sm:grid-cols-3">
          {entries.map((entry, i) => {
            const isUserPalette = "id" in entry;
            const isSelected =
              entry.name === selected.name &&
              entry.colors.every((c, j) => c === selected.colors[j]);
            const doesMatchColors = entry.colors.every(
              (c, j) => c === selected.colors[j],
            );
            const isEditing =
              isUserPalette && "isEditing" in entry && entry.isEditing;

            return (
              <PaletteSwatch
                key={isUserPalette ? (entry as UserPaletteEntry).id : i}
                entry={entry}
                isSelected={isSelected}
                doesMatchColors={doesMatchColors}
                isBuiltIn={!!isBuiltIn}
                isEditing={isEditing}
                onClick={() => {
                  onSelectWithName(
                    "id" in entry
                      ? { name: entry.name, colors: entry.colors }
                      : entry,
                  );
                }}
                onEdit={
                  isUserPalette && onEdit && !isBuiltIn
                    ? () => onEdit(i.toString(), entry as UserPaletteEntry)
                    : undefined
                }
              />
            );
          })}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
```

4. Locate the bottom of the main `PalettePicker` function's `return` — the five `<PaletteSection ... />` usages — and replace with one `<Accordion>` wrapping `<PaletteSectionItem>`s. The `usePaletteSectionState` hook becomes the controlled `value`/`onValueChange`:

```tsx
{(() => {
  const sectionTitles = ["User Palettes", "Button Combos", "BG Presets", "Additional", "Fun"];
  const expandedValues = sectionTitles.filter((t) => isExpanded(t));

  return (
    <Accordion
      multiple
      value={expandedValues}
      onValueChange={(next: string[]) => {
        // Diff next vs current and toggle each.
        const current = new Set(expandedValues);
        const target = new Set(next);
        sectionTitles.forEach((title) => {
          if (current.has(title) !== target.has(title)) {
            toggleExpanded(title);
          }
        });
      }}
    >
      <PaletteSectionItem
        title="User Palettes"
        entries={savedUserPalettes}
        selected={selected}
        onSelectWithName={onSelectWithName}
        onEdit={(_, palette) => {
          handleStartEdit((palette as UserPaletteEntry).id);
        }}
      />
      <PaletteSectionItem
        title="Button Combos"
        entries={BUTTON_COMBO_PALETTES}
        selected={selected}
        onSelectWithName={onSelectWithName}
        isBuiltIn
      />
      <PaletteSectionItem
        title="BG Presets"
        entries={BG_PRESETS}
        selected={selected}
        onSelectWithName={onSelectWithName}
        isBuiltIn
      />
      <PaletteSectionItem
        title="Additional"
        entries={ADDITIONAL_PALETTES}
        selected={selected}
        onSelectWithName={onSelectWithName}
        isBuiltIn
      />
      <PaletteSectionItem
        title="Fun"
        entries={FUN_PALETTES_EXPORT}
        selected={selected}
        onSelectWithName={onSelectWithName}
        isBuiltIn
      />
    </Accordion>
  );
})()}
```

- [ ] **Step 5.4: Replace the Image History panel in `App.tsx` with `<Collapsible>`**

In `packages/gbcam-extract-web/src/App.tsx`, locate the Image History block (the `{history.length > 0 && (...)}` section near the bottom).

1. Remove the `useState` for `isHistoryExpanded` from `useImageHistory` destructuring and replace with controlled `<Collapsible>` state. Or — simpler — keep `isHistoryExpanded` / `setIsHistoryExpanded` from the hook and feed them into `<Collapsible open={...} onOpenChange={...}>`.

2. Replace the `<button onClick={() => setIsHistoryExpanded(...)}>` toggle plus the `{isHistoryExpanded && ...}` conditional with:

```tsx
import { ChevronDown, Library } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shadcn/components/collapsible";
import { Button } from "@/shadcn/components/button";
```

```tsx
{history.length > 0 && (
  <Collapsible
    open={isHistoryExpanded}
    onOpenChange={setIsHistoryExpanded}
    className="mt-8"
  >
    <CollapsibleTrigger
      render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
    >
      <Library data-icon="inline-start" />
      Image History (
      {history.reduce((sum, batch) => sum + batch.results.length, 0)} images)
      <ChevronDown
        className="transition-transform data-[state=open]:rotate-180"
        data-icon="inline-end"
      />
    </CollapsibleTrigger>
    <CollapsibleContent>
      {/* (existing inner contents — settings row + history.map(...) — stay here unchanged for this commit) */}
    </CollapsibleContent>
  </Collapsible>
)}
```

(The inner controls — max-size input, "Delete All History" button, batch list — are still in their old form. Tasks 6, 7, 9 will sweep them.)

- [ ] **Step 5.5: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5.6: Smoke-test all converted collapsibles**

Run `pnpm dev`. Verify:

1. Instructions panel: opens/closes; state persists across reload (localStorage `gbcam-instructions-open`).
2. Palette accordion: each of the 5 sections opens/closes; multi-section open works; state persists (localStorage `gbcam-palette-sections-expanded`).
3. Pipeline Debug Viewer: with debug mode on, the outer "Debug: Pipeline Diagnostics" toggle opens/closes; inside it, the inner accordion shows "Intermediate Steps" expanded by default plus collapsed "Debug Images", "Metrics", "Log" sections (when populated). None of this is persisted (expected — the debug payload is in-memory only and is dropped from history per `serialization.ts`).
4. Image History (only visible if history isn't empty): opens/closes; not persisted (expected).
5. Chevrons rotate down→up on open (visual check).

Stop dev server.

- [ ] **Step 5.7: Commit**

```bash
git add packages/gbcam-extract-web/src/components/CollapsibleInstructions.tsx \
        packages/gbcam-extract-web/src/components/PipelineDebugViewer.tsx \
        packages/gbcam-extract-web/src/components/PalettePicker.tsx \
        packages/gbcam-extract-web/src/App.tsx
git commit -m "$(cat <<'EOF'
refactor(web): replace ad-hoc collapsibles with shadcn Collapsible/Accordion

Eliminate five duplicated collapsible sites (instructions panel, palette
section list, PipelineDebugViewer outer toggle, PipelineDebugViewer's inner
CollapsibleSection helper used 4×, image history) by switching to shadcn's
Collapsible (single-panel) and Accordion (multi-panel) primitives. The
palette section list and the PipelineDebugViewer inner sections each become
a single <Accordion multiple>. The CollapsibleSection helper inside
PipelineDebugViewer is deleted. Triggers compose with base's
render={<Button .../>} pattern. Chevrons are lucide ChevronDown rotated
via data-state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Buttons + Cards sweep (commit 6)

**Files:**
- Modify: `packages/gbcam-extract-web/src/App.tsx`
- Modify: `packages/gbcam-extract-web/src/components/ImageInput.tsx`
- Modify: `packages/gbcam-extract-web/src/components/ResultCard.tsx`
- Modify: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`
- Modify: `packages/gbcam-extract-web/src/utils/paletteUI.ts` (if it survives)

Replace every raw `<button className="bg-{color}-600 ...">` with `<Button>` and the right `variant`. Wrap card-shaped sections in `<Card>` with proper subcomponents. Switch to logical Tailwind classes (`ms-*`/`me-*`/`ps-*`/`pe-*`/`text-start`/`text-end`).

The variant mapping (from spec):

| Original style | Variant |
|---|---|
| Primary blue (Download All, etc.) | (default — primary fuchsia) |
| Green (Install, Download PNG) | (default) |
| Red (delete actions) | `destructive` |
| Gray (Choose Files, Camera, Cancel) | `secondary` |
| Purple (Copy/Share) | (default) |
| Tiny rounded icon-only | `ghost` + `size="icon"` (icons added in Task 10) |

- [ ] **Step 6.1: Sweep `ImageInput.tsx`**

Replace `packages/gbcam-extract-web/src/components/ImageInput.tsx` contents:

```tsx
import { useRef, useState, useCallback } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/shadcn/components/button";
import { cn } from "@/shadcn/utils/utils";

interface ImageInputProps {
  onImagesSelected: (files: File[]) => void;
  disabled?: boolean;
}

export function ImageInput({ onImagesSelected, disabled }: ImageInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFiles.length > 0) {
        onImagesSelected(imageFiles);
      }
    },
    [onImagesSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  return (
    <div>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={cn(
          "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          disabled
            ? "border-border text-muted-foreground/50 cursor-not-allowed"
            : dragOver
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-foreground/40 cursor-pointer",
        )}
      >
        <div className="flex flex-col items-center gap-3">
          <Upload className="opacity-50 size-10" />
          <p className="text-sm">Drag and drop images here, or click to browse</p>
          <p className="text-xs text-muted-foreground">Supports multiple files</p>
        </div>
      </div>

      <div className="flex gap-3 mt-3">
        <Button
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          Choose Files
        </Button>
        <Button
          variant="secondary"
          onClick={() => cameraInputRef.current?.click()}
          disabled={disabled}
        >
          Camera Capture
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
```

- [ ] **Step 6.2: Sweep `ResultCard.tsx`**

Open `packages/gbcam-extract-web/src/components/ResultCard.tsx`. Replace the JSX `return` (everything from `return (` to the closing `);`) with shadcn `<Card>`/`<Button>`/`<Badge>` versions. Keep the existing hooks and effects (the canvas drawing is unchanged).

The new `return`:

```tsx
return (
  <Card className="p-3 sm:p-4">
    <CardHeader className="flex-row items-start gap-2 p-0 mb-3 space-y-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" title={filename}>
          {filename}
        </p>
        <Badge variant="secondary" className="mt-0.5">
          {processingTime.toFixed(0)}ms
        </Badge>
      </div>
      {onDelete && (
        <Button
          variant="destructive"
          size="icon"
          onClick={onDelete}
          aria-label="Delete result"
          className="size-7"
        >
          {/* Icon added in Task 10 */}
          <span aria-hidden>×</span>
        </Button>
      )}
    </CardHeader>
    <CardContent className="flex flex-col sm:flex-row gap-3 p-0">
      <canvas
        ref={canvasRef}
        className="rounded border self-start"
        style={{ imageRendering: "pixelated", maxWidth: "100%" }}
      />
      <div className="flex flex-wrap gap-2 items-start content-start">
        <Button onClick={handleDownload}>Download PNG</Button>
        {shareSupported && (
          <Button variant="secondary" onClick={handleShare}>
            Share
          </Button>
        )}
        <Button variant="secondary" onClick={handleCopy} aria-label="Copy image">
          {showCopyFeedback || "Copy"}
        </Button>
      </div>
    </CardContent>
  </Card>
);
```

Add the imports at the top:

```ts
import { Button } from "@/shadcn/components/button";
import { Badge } from "@/shadcn/components/badge";
import { Card, CardContent, CardHeader } from "@/shadcn/components/card";
```

(The temporary `<span aria-hidden>×</span>` is the placeholder until Task 10 swaps it for `<X />`. Same for the copy feedback `showCopyFeedback || "Copy"` — Task 8 will replace that with sonner toasts.)

- [ ] **Step 6.3: Sweep `App.tsx` — install button, output/preview scale row, history controls**

In `packages/gbcam-extract-web/src/App.tsx`:

1. Add imports near the top:

```ts
import { Button } from "@/shadcn/components/button";
import { Card, CardContent } from "@/shadcn/components/card";
import { Separator } from "@/shadcn/components/separator";
```

2. Replace the Install App button (search for `bg-green-600 hover:bg-green-700`):

```tsx
{isInstallable && (
  <Button onClick={handleInstallApp} title="Install this app on your device">
    Install App
  </Button>
)}
```

3. Replace the iOS install tip dismiss `<button>` (the `✕` button at the end of the tip block) with `<Button variant="ghost" size="icon">` — temporary content `<span aria-hidden>×</span>`. Task 10 swaps the icon. The outer `<div>` wrapping the tip stays raw markup for now; Task 9 wraps it in `<Alert>`.

4. Replace the Download All button:

```tsx
<Button
  onClick={() => {
    results.forEach((r) => {
      downloadResult(
        r.filename,
        r.result,
        paletteEntry.colors,
        paletteEntry.name,
        outputScale,
      );
    });
  }}
>
  Download All ({results.length})
</Button>
```

5. The output/preview scale `<select>` rows stay as native `<select>` for this commit — Task 7 swaps them to `<Select>`.

6. Replace the "Delete All History" button:

```tsx
<Button variant="destructive" size="sm" onClick={deleteAllHistory} className="ms-auto">
  Delete All History
</Button>
```

(The confirmation dialog is added in Task 9.)

7. Wrap each history batch in `<Card>`:

```tsx
{history.map((batch) => (
  <Card key={batch.id} className="bg-muted/40 p-4">
    <CardContent className="p-0">
      <div className="text-xs text-muted-foreground mb-3">
        {new Date(batch.timestamp).toLocaleString()} ({batch.results.length} images)
      </div>
      <div className="grid gap-3">
        {batch.results.map((result, idx) => (
          <ResultCard
            key={`${batch.id}-${idx}`}
            result={result.result}
            filename={result.filename}
            processingTime={result.processingTime}
            palette={paletteEntry.colors}
            paletteName={paletteEntry.name}
            outputScale={outputScale}
            previewScale={previewScale}
            onDelete={() => deleteFromHistory(batch.id, idx)}
          />
        ))}
      </div>
    </CardContent>
  </Card>
))}
```

8. Replace the `<footer>` divider area. Remove `border-t border-gray-700 bg-gray-900/50` and instead emit a `<Separator>` then a plain footer:

```tsx
<Separator />
<footer className="bg-background/50">
  <div className="container mx-auto px-4 py-4 max-w-4xl flex justify-center gap-4">
    <a
      href="./licenses.html"
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      Open Source Licenses and Credits
    </a>
  </div>
</footer>
```

9. Replace the outermost App `<div>`'s `bg-gray-900 text-white` with semantic tokens:

```tsx
<div className="min-h-screen bg-background text-foreground flex flex-col">
```

10. Sweep any remaining `text-left` → `text-start`, `ml-auto` → `ms-auto`, `mr-*` → `me-*`, `pl-*` → `ps-*`, `pr-*` → `pe-*`, `bg-gray-*` / `text-gray-*` → semantic tokens (`bg-muted`, `text-muted-foreground`, `bg-background`, `text-foreground`) in this file. (Final RTL audit happens in Task 11; do the obvious ones now.)

- [ ] **Step 6.4: Sweep `PalettePicker.tsx`**

Open `packages/gbcam-extract-web/src/components/PalettePicker.tsx`. The outer wrapper, the editing-palette card, the `+ Custom` button, the editing action buttons (Cancel/Delete/Save), and the swatch buttons all need shadcn replacements.

1. Add imports near the top:

```ts
import { Button } from "@/shadcn/components/button";
import { Card, CardContent } from "@/shadcn/components/card";
import { cn } from "@/shadcn/utils/utils";
```

2. Replace the outer wrapper from `<div className="bg-gray-800 rounded-lg p-4">` to `<Card className="p-4">` (and corresponding closing tag).

3. Replace the `+ Custom` button:

```tsx
<Button variant="secondary" size="sm" onClick={handleCreateCustom}>
  + Custom
</Button>
```

4. Replace the clipboard paste-new `<button>` (the `📋` one) with:

```tsx
{clipboardEnabled && (
  <Button
    variant="secondary"
    size="icon"
    onClick={handlePasteNewPalette}
    disabled={!hasClipboardPalette}
    aria-label={
      hasClipboardPalette
        ? "Paste palette from clipboard"
        : "Clipboard does not contain a palette"
    }
  >
    {/* Icon added in Task 10 */}
    <span aria-hidden>📋</span>
  </Button>
)}
```

5. In the inner editing-palette block (the `editingPalettes.map(...)`), replace the outer `<div>` with `<Card>`. Replace each Cancel/Delete/Save button:

```tsx
{palette.savedName && (
  <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); handleCancelEdit(palette.id); }}>
    Cancel
  </Button>
)}
<Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); handleDeletePalette(palette.id); }}>
  Delete
</Button>
<Button size="sm" onClick={(e) => { e.stopPropagation(); handleSavePalette(palette.id); }} disabled={!!editingPaletteErrors[palette.id]}>
  Save
</Button>
```

6. Replace the inner `<button>` inside the `PaletteSwatch` component with `<Button variant="outline" size="sm" data-selected={isSelected ? "true" : undefined}>`. Move the conditional `bgClass` mapping out — let the `<Button>` variant handle it; use `cn()` for the `data-selected` highlight:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={onClick}
  className={cn(
    "justify-start gap-2 h-auto px-2 py-1.5",
    isSelected && "ring-2 ring-primary",
    doesMatchColors && !isSelected && "border-primary/60",
  )}
>
  <div className="flex shrink-0">
    {entry.colors.map((c, i) => (
      <div
        key={i}
        className="size-4 first:rounded-s last:rounded-e"
        style={{ backgroundColor: c }}
      />
    ))}
  </div>
  <span className="truncate">{entry.name}</span>
  {!isBuiltIn && onEdit && (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      className="ms-auto text-primary hover:text-primary/80 cursor-pointer"
      title="Edit palette"
    >
      {/* Icon added in Task 10 */}
      <span aria-hidden>✏️</span>
    </span>
  )}
</Button>
```

(`first:rounded-s` / `last:rounded-e` are logical-direction equivalents of `first:rounded-l` / `last:rounded-r`.)

7. Sweep remaining `bg-gray-*`, `text-gray-*`, `border-gray-*`, `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left` → semantic tokens / logical classes.

- [ ] **Step 6.5: Reduce `paletteUI.ts`**

Open `packages/gbcam-extract-web/src/utils/paletteUI.ts`. Update the Tailwind-class constants to semantic tokens:

```ts
export const PALETTE_COLOR_LABELS = ["Light", "Mid-L", "Mid-D", "Dark"];

export const PALETTE_TEXT_CLASS = "text-xs text-foreground";

export const PALETTE_LABEL_CLASS = "text-[10px] text-muted-foreground";

export const PALETTE_INPUT_CLASS =
  "w-full px-2 py-1 bg-input rounded text-xs text-foreground placeholder-muted-foreground border border-input focus:border-ring outline-none";
```

(Task 7 may swap the input itself for shadcn `<Input>` and remove `PALETTE_INPUT_CLASS` entirely — leave the constant in place for this task.)

- [ ] **Step 6.6: Verify typecheck and smoke-test**

```bash
pnpm typecheck
```

```bash
pnpm dev
```

Smoke check:
1. Buttons across the app use the fuchsia primary / muted secondary / red destructive variants.
2. ResultCard, palette picker, history batches render as `<Card>`s with the new theme.
3. ImageInput drop zone works.
4. Footer divider visible (Separator).
5. No raw `bg-gray-*` / `text-gray-*` / `border-gray-*` colors visible (right-click → Inspect a few elements).

Stop dev server.

- [ ] **Step 6.7: Commit**

```bash
git add packages/gbcam-extract-web/src/App.tsx \
        packages/gbcam-extract-web/src/components/ImageInput.tsx \
        packages/gbcam-extract-web/src/components/ResultCard.tsx \
        packages/gbcam-extract-web/src/components/PalettePicker.tsx \
        packages/gbcam-extract-web/src/utils/paletteUI.ts
git commit -m "$(cat <<'EOF'
refactor(web): replace raw buttons and card divs with shadcn primitives

Sweep replace bespoke <button> markup with <Button> + variants per the
spec mapping (primary fuchsia / secondary muted / destructive). Wrap
card-shaped sections (ResultCard outer, PalettePicker outer, history
batches, PipelineDebugViewer step canvases) in <Card> with proper subcomponents.
Use <Separator> for the footer divider. Migrate to semantic color tokens
and logical Tailwind classes (ms-*/me-*, ps-*/pe-*, text-start). Icon
content for icon-only buttons stays as emoji placeholders until Task 10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Form controls (commit 7)

**Files:**
- Modify: `packages/gbcam-extract-web/src/App.tsx`
- Modify: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`

Convert checkboxes (Debug / Clipboard) to `<Field>`+`<Checkbox>`+`<FieldLabel>`. Convert Output/Preview Scale `<select>` to shadcn `<Select>` (base `items` prop). Convert palette name input + history max-size input to `<Field>`+`<Input>`. Color pickers stay native `<input type="color">` wrapped in `<Field>`+`<FieldLabel>`. Validation uses `data-invalid` + `aria-invalid` + `<FieldDescription>`.

- [ ] **Step 7.1: Convert App.tsx settings checkboxes**

In `packages/gbcam-extract-web/src/App.tsx`, add imports:

```ts
import { Checkbox } from "@/shadcn/components/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/shadcn/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/components/select";
import { Input } from "@/shadcn/components/input";
```

Replace the settings checkbox row:

```tsx
<FieldGroup className="mb-6 flex-row flex-wrap items-center gap-4">
  <Field className="flex-row items-center gap-2">
    <Checkbox
      id="debug-mode"
      checked={debug}
      onCheckedChange={(v) => setDebug(v === true)}
    />
    <FieldLabel htmlFor="debug-mode">Debug mode</FieldLabel>
  </Field>
  <Field className="flex-row items-center gap-2">
    <Checkbox
      id="clipboard-enabled"
      checked={clipboardEnabled}
      onCheckedChange={(v) => setClipboardEnabled(v === true)}
    />
    <FieldLabel htmlFor="clipboard-enabled">Enable Copy/Paste Palettes</FieldLabel>
  </Field>
</FieldGroup>
```

- [ ] **Step 7.2: Convert Output / Preview Scale selects**

Define items arrays once near the top of the App component:

```ts
const OUTPUT_SCALE_ITEMS = [
  { value: "1", label: "1x (128x112)" },
  { value: "2", label: "2x (256x224)" },
  { value: "3", label: "3x (384x336)" },
  { value: "4", label: "4x (512x448)" },
  { value: "8", label: "8x (1024x896)" },
  { value: "16", label: "16x (2048x1792)" },
];

const PREVIEW_SCALE_ITEMS = [
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "3", label: "3x" },
  { value: "4", label: "4x" },
  { value: "8", label: "8x" },
  { value: "16", label: "16x" },
];
```

Replace the existing two `<label>` + `<select>` blocks with:

```tsx
<Field className="flex-row items-center gap-2">
  <FieldLabel htmlFor="output-scale">Output Scale:</FieldLabel>
  <Select
    items={OUTPUT_SCALE_ITEMS}
    value={String(outputScale)}
    onValueChange={(v: string) => setOutputScale(parseInt(v, 10))}
  >
    <SelectTrigger id="output-scale" className="w-fit">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        {OUTPUT_SCALE_ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  </Select>
</Field>

<Field className="flex-row items-center gap-2">
  <FieldLabel htmlFor="preview-scale">Preview Scale:</FieldLabel>
  <Select
    items={PREVIEW_SCALE_ITEMS}
    value={String(previewScale)}
    onValueChange={(v: string) => setPreviewScale(parseInt(v, 10))}
  >
    <SelectTrigger id="preview-scale" className="w-fit">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        {PREVIEW_SCALE_ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  </Select>
</Field>
```

- [ ] **Step 7.3: Convert history max-size input**

Replace the `<input type="number">` and its label in the history settings row:

```tsx
<Field className="flex-row items-center gap-2">
  <Input
    id="history-max-size"
    type="number"
    min={1}
    max={100}
    value={historySettings.maxSize}
    onChange={(e) =>
      updateHistorySettings({
        maxSize: Math.max(1, parseInt(e.target.value, 10) || 1),
      })
    }
    className="w-16"
  />
  <FieldLabel htmlFor="history-max-size">max images to keep in history</FieldLabel>
</Field>
```

- [ ] **Step 7.4: Convert palette name input in `PalettePicker.tsx`**

In the editing-palette card section of `PalettePicker.tsx`, replace the name `<input>` and the validation error `<p>` with `<Field>` composition:

```tsx
import { Field, FieldDescription, FieldLabel } from "@/shadcn/components/field";
import { Input } from "@/shadcn/components/input";
```

```tsx
<Field
  className="mb-2"
  data-invalid={editingPaletteErrors[palette.id] ? true : undefined}
>
  <FieldLabel htmlFor={`palette-name-${palette.id}`} className="sr-only">
    Palette name
  </FieldLabel>
  <Input
    id={`palette-name-${palette.id}`}
    type="text"
    value={palette.name}
    placeholder="Palette name"
    aria-invalid={
      editingPaletteErrors[palette.id] ? true : undefined
    }
    onChange={(e) => {
      e.stopPropagation();
      handlePaletteNameChange(palette.id, e.target.value);
    }}
  />
  {editingPaletteErrors[palette.id] && (
    <FieldDescription className="text-destructive text-[10px]">
      {editingPaletteErrors[palette.id]}
    </FieldDescription>
  )}
</Field>
```

- [ ] **Step 7.5: Wrap color pickers in `<Field>` + `<FieldLabel>`**

In `PalettePicker.tsx`, the four color picker `<label>`s in the editing block:

```tsx
{palette.colors.map((c, i) => (
  <Field key={i} className="items-center gap-1">
    <Input
      id={`palette-color-${palette.id}-${i}`}
      type="color"
      value={c}
      onChange={(e) => {
        e.stopPropagation();
        handlePaletteColorChange(palette.id, i, e.target.value);
      }}
      className="size-8 cursor-pointer bg-transparent p-0"
    />
    <FieldLabel
      htmlFor={`palette-color-${palette.id}-${i}`}
      className="text-[10px]"
    >
      {PALETTE_COLOR_LABELS[i]}
    </FieldLabel>
  </Field>
))}
```

(Native `<input type="color">` works fine inside shadcn `<Input>` — `<Input>` is just a styled wrapper around the native element.)

- [ ] **Step 7.6: Verify typecheck and smoke-test**

```bash
pnpm typecheck
```

```bash
pnpm dev
```

Test:
1. Debug / Clipboard checkboxes toggle and persist.
2. Output Scale / Preview Scale selects open with 6 options each, change applies.
3. Palette name input — enter empty name, see "Palette name cannot be empty" error styled with destructive.
4. Color pickers in editing palette work.
5. History max-size input accepts only 1-100.

Stop dev server.

- [ ] **Step 7.7: Commit**

```bash
git add packages/gbcam-extract-web/src/App.tsx \
        packages/gbcam-extract-web/src/components/PalettePicker.tsx
git commit -m "$(cat <<'EOF'
refactor(web): convert form controls to shadcn Field/Checkbox/Select/Input

Wrap settings checkboxes (debug, clipboard) in <Field>+<Checkbox>+<FieldLabel>.
Convert Output/Preview Scale dropdowns to shadcn <Select> (base items prop).
Wrap history max-size input and palette name input in <Field>+<Input>;
move palette name validation to <FieldDescription> with data-invalid +
aria-invalid. Color pickers stay native <input type="color"> inside <Input>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: sonner toast feedback (commit 8)

**Files:**
- Modify: `packages/gbcam-extract-web/src/App.tsx`
- Modify: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`
- Modify: `packages/gbcam-extract-web/src/components/ResultCard.tsx`

- [ ] **Step 8.1: Mount `<Toaster>` in App**

In `packages/gbcam-extract-web/src/App.tsx`, add the import:

```ts
import { Toaster } from "@/shadcn/components/sonner";
```

Inside the App `return`, add `<Toaster />` near the very top of the outermost `<div>` (before the inner `container`):

```tsx
<div className="min-h-screen bg-background text-foreground flex flex-col">
  <Toaster richColors position="bottom-center" />
  <div className="container mx-auto px-4 py-8 max-w-4xl flex-1">
    ...
  </div>
  ...
</div>
```

- [ ] **Step 8.2: Replace `setButtonFeedback` in `PalettePicker.tsx` with `toast` calls**

In `packages/gbcam-extract-web/src/components/PalettePicker.tsx`:

1. Add the import:

```ts
import { toast } from "sonner";
```

2. Delete the `buttonFeedback` state and all `setButtonFeedback` / `setTimeout` calls. Replace each with a `toast` call:

`handleCopyPaletteToClipboard`:

```ts
const handleCopyPaletteToClipboard = async (palette: UserPaletteEntry) => {
  const success = await writePaletteToClipboard({
    name: palette.name,
    colors: palette.colors,
  });
  if (success) {
    toast.success("Palette copied to clipboard");
  } else {
    toast.error("Copy failed — check browser permissions");
  }
};
```

`handlePastePaletteColors`:

```ts
const handlePastePaletteColors = async (paletteId: string) => {
  const palette = userPalettes.find((p) => p.id === paletteId);
  if (!palette) return;
  const paletteData = await readPaletteFromClipboard();
  if (paletteData) {
    updatePalette(paletteId, { colors: paletteData.colors });
    if (isPaletteSelected(palette)) {
      onSelectWithName({ name: palette.name, colors: paletteData.colors });
    }
    toast.success("Palette colors pasted");
  } else {
    toast.info("Clipboard does not contain a palette");
  }
};
```

`handlePasteNewPalette`:

```ts
const handlePasteNewPalette = async () => {
  const paletteData = await readPaletteFromClipboard();
  if (paletteData) {
    const newPalette = createPaletteInEditMode(
      paletteData.name,
      paletteData.colors,
    );
    setSelectedEditingPaletteId(newPalette.id);
    onSelectWithName({ name: newPalette.name, colors: newPalette.colors });
    toast.success("Palette pasted");
  } else {
    toast.info("Clipboard does not contain a palette");
  }
};
```

3. Remove all `buttonFeedback[`copy-${palette.id}`]` / `buttonFeedback[`paste-${palette.id}`]` / `buttonFeedback["paste-new"]` references in JSX. Buttons use icon-only content (placeholder `<span aria-hidden>📋</span>` etc. until Task 10).

- [ ] **Step 8.3: Replace `showCopyFeedback` in `ResultCard.tsx`**

In `packages/gbcam-extract-web/src/components/ResultCard.tsx`:

1. Add the import:

```ts
import { toast } from "sonner";
```

2. Delete the `showCopyFeedback` state.

3. Replace the `handleCopy` body:

```ts
const handleCopy = useCallback(async () => {
  const outputCanvas = buildOutputCanvas(result, palette, outputScale);
  if (!outputCanvas) return;
  try {
    await copyImageToClipboard(outputCanvas);
    toast.success("Image copied to clipboard");
  } catch (err) {
    const errorMsg = (err as Error).message || "Failed to copy";
    toast.error(`Copy failed: ${errorMsg}`);
    console.error("Failed to copy image:", err);
  }
}, [result, palette, outputScale]);
```

4. The Copy button content becomes static:

```tsx
<Button variant="secondary" onClick={handleCopy} aria-label="Copy image">
  Copy
</Button>
```

- [ ] **Step 8.4: Verify typecheck and smoke-test**

```bash
pnpm typecheck
```

```bash
pnpm dev
```

Test:
1. Click "Copy" on a result — toast appears at bottom center: "Image copied to clipboard".
2. With clipboard mode enabled, paste an empty clipboard into a palette — info toast.
3. Copy a palette — success toast.
4. Toast auto-dismisses after the sonner default duration.

Stop dev server.

- [ ] **Step 8.5: Commit**

```bash
git add packages/gbcam-extract-web/src/App.tsx \
        packages/gbcam-extract-web/src/components/PalettePicker.tsx \
        packages/gbcam-extract-web/src/components/ResultCard.tsx
git commit -m "$(cat <<'EOF'
refactor(web): replace inline timed-flash feedback with sonner toasts

Mount <Toaster> in App. Delete buttonFeedback state and the per-button
setTimeout patterns in PalettePicker; replace with toast.success /
toast.info / toast.error calls. Same for ResultCard's showCopyFeedback.
Removes ~6 setTimeout calls and a state object.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Alerts + Progress + Empty + Delete confirmation (commit 9)

**Files:**
- Modify: `packages/gbcam-extract-web/src/App.tsx`
- Create: `packages/gbcam-extract-web/src/hooks/useServiceWorker.ts`
- Modify: `packages/gbcam-extract-web/src/main.tsx`
- Delete: `packages/gbcam-extract-web/src/components/LoadingBar.tsx`

- [ ] **Step 9.1: Create `useServiceWorker.ts` to surface SW update state**

The current SW update banner is built imperatively in `main.tsx`. Move detection into a hook so a state-driven `<Alert>` can render in `App.tsx`.

Create `packages/gbcam-extract-web/src/hooks/useServiceWorker.ts`:

```ts
import { useEffect, useState } from "react";

export function useServiceWorker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;

    navigator.serviceWorker
      .register("/sw.js", { scope: "./" })
      .then((reg) => {
        registration = reg;
        console.log("Service Worker registered:", reg);

        const interval = setInterval(() => reg.update(), 60000);

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setUpdateAvailable(true);
            }
          });
        });

        return () => clearInterval(interval);
      })
      .catch((err) => {
        console.warn("Service Worker registration failed:", err);
      });

    return () => {
      // Nothing to actively tear down — registration persists across mounts.
    };
  }, []);

  const reload = () => location.reload();

  return { updateAvailable, reload, registration };
}
```

- [ ] **Step 9.2: Slim `main.tsx`**

Replace `packages/gbcam-extract-web/src/main.tsx` contents (keep ThemeProvider wrapper):

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
```

(SW registration moves into the hook.)

- [ ] **Step 9.3: Replace iOS install tip / OpenCV error / SW update banners with `<Alert>`**

In `packages/gbcam-extract-web/src/App.tsx`:

```ts
import { Alert, AlertDescription, AlertTitle } from "@/shadcn/components/alert";
import { Smartphone, X, AlertTriangle } from "lucide-react";
import { useServiceWorker } from "./hooks/useServiceWorker.js";
```

Inside `App`:

```ts
const { updateAvailable, reload } = useServiceWorker();
```

Replace the iOS install tip block with:

```tsx
{showIOSInstallTip && (
  <Alert className="mb-4">
    <Smartphone />
    <AlertTitle>Install as App</AlertTitle>
    <AlertDescription>
      Tap the <strong>Share</strong> button (<span className="font-mono">⎙</span>)
      in Safari, then choose <strong>"Add to Home Screen"</strong>.
    </AlertDescription>
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setShowIOSInstallTip(false)}
      aria-label="Dismiss"
      className="ms-auto"
    >
      <X />
    </Button>
  </Alert>
)}
```

Replace the OpenCV error block with:

```tsx
{status === "error" && (
  <Alert variant="destructive" className="mb-6">
    <AlertTriangle />
    <AlertTitle>Failed to load OpenCV</AlertTitle>
    <AlertDescription>{error}</AlertDescription>
  </Alert>
)}
```

Add the SW update alert (anywhere logical, e.g. just below the iOS install tip):

```tsx
{updateAvailable && (
  <Alert className="mb-4">
    <AlertTitle>App updated</AlertTitle>
    <AlertDescription>Refresh to get the latest version.</AlertDescription>
    <Button variant="secondary" size="sm" onClick={reload} className="ms-auto">
      Refresh
    </Button>
  </Alert>
)}
```

- [ ] **Step 9.4: Replace `LoadingBar` and `ProgressDisplay` with `<Progress>`**

In `App.tsx`:

```ts
import { Progress } from "@/shadcn/components/progress";
```

Replace the OpenCV-loading block:

```tsx
{status === "loading" && (
  <div className="mb-6 flex flex-col gap-1">
    <p className="text-sm text-muted-foreground">Loading OpenCV.js...</p>
    <Progress value={cvProgress} />
  </div>
)}
```

Replace `ProgressDisplay` (at top of file) with an inline render:

```tsx
function ProgressDisplay({ progress }: { progress: ProcessingProgress }) {
  if (!progress.currentImageProgress) return null;

  return (
    <div className="mt-4 space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          Image {progress.currentImageProgress.index + 1} of {progress.totalImages}: {" "}
          {progress.currentImageProgress.filename}
        </span>
        <span>{progress.overallProgress}%</span>
      </div>
      <Progress value={progress.overallProgress} />
      <div className="text-xs text-muted-foreground">
        Step: {progress.currentImageProgress.currentStep || "Starting..."}
      </div>
    </div>
  );
}
```

Remove the `LoadingBar` import from `App.tsx`.

- [ ] **Step 9.5: Delete `LoadingBar.tsx`**

```bash
git rm packages/gbcam-extract-web/src/components/LoadingBar.tsx
```

- [ ] **Step 9.6: Add `<Empty>` for the no-results state**

In `App.tsx`, add an Empty render when `status === "ready"` AND `results.length === 0` AND `history.length === 0` AND not currently processing:

```ts
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shadcn/components/empty";
import { ImageIcon } from "lucide-react";
```

After the `<ImageInput>` and `processing` blocks, but before the palette picker (or wherever fits the layout best):

```tsx
{status === "ready" && !processing && results.length === 0 && history.length === 0 && (
  <Empty className="my-6">
    <EmptyHeader>
      <ImageIcon className="size-10 text-muted-foreground" />
      <EmptyTitle>No images yet</EmptyTitle>
      <EmptyDescription>
        Drop a phone photo of a Game Boy Camera image to get started.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
)}
```

- [ ] **Step 9.7: Add `<Dialog>` confirmation for "Delete All History"**

```ts
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shadcn/components/dialog";
```

Replace the existing "Delete All History" `<Button>` with:

```tsx
<Dialog>
  <DialogTrigger
    render={<Button variant="destructive" size="sm" className="ms-auto" />}
  >
    Delete All History
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Delete all history?</DialogTitle>
      <DialogDescription>
        This will permanently remove all archived image batches. This action
        cannot be undone.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
      <DialogClose
        render={
          <Button variant="destructive" onClick={deleteAllHistory} />
        }
      >
        Delete All
      </DialogClose>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 9.8: Verify typecheck and smoke-test**

```bash
pnpm typecheck
```

```bash
pnpm dev
```

Test:
1. iOS Safari simulation: install tip renders as `<Alert>`.
2. Force OpenCV failure (rename `opencv.js` temporarily, or block it via DevTools network) → destructive alert.
3. Empty state shows when no results + no history.
4. "Delete All History" opens dialog, Cancel closes without action, Delete All clears.
5. Loading bar (`<Progress>`) shows during OpenCV load and processing.

Stop dev server.

- [ ] **Step 9.9: Commit**

```bash
git add packages/gbcam-extract-web/src/App.tsx \
        packages/gbcam-extract-web/src/main.tsx \
        packages/gbcam-extract-web/src/hooks/useServiceWorker.ts \
        packages/gbcam-extract-web/src/components/LoadingBar.tsx
git commit -m "$(cat <<'EOF'
refactor(web): convert banners/progress/empty state to shadcn primitives

Replace iOS install tip, OpenCV error, and SW update banner with <Alert>;
move SW update detection to a useServiceWorker hook so it can drive a
state-rendered alert. Replace LoadingBar.tsx (deleted) and the
ProgressDisplay markup with <Progress>. Add an <Empty> state when no
results or history are present. Wrap "Delete All History" in a <Dialog>
confirmation with destructive Delete All action.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Icons — emojis to lucide (commit 10)

**Files:**
- Modify: `packages/gbcam-extract-web/src/App.tsx`
- Modify: `packages/gbcam-extract-web/src/components/PalettePicker.tsx`
- Modify: `packages/gbcam-extract-web/src/components/ResultCard.tsx`

Sweep replace remaining emoji placeholders with lucide icons. Apply `data-icon="inline-start"` / `data-icon="inline-end"` per shadcn rule.

The mapping:

| Emoji | Replacement | Where |
|---|---|---|
| `×` (close in iOS tip) | `<X />` | Already done in Task 9 |
| `×` (delete result) | `<X />` | `ResultCard.tsx` delete button |
| `📋` | `<ClipboardPaste />` | PalettePicker paste-new + paste-into-palette buttons |
| `📄` | `<Copy />` | PalettePicker copy-palette buttons |
| `✏️` | `<Pencil />` | PalettePicker edit indicator on swatches |
| `📚` | `<Library />` | Already done in Task 5 (Image History trigger) |

- [ ] **Step 10.1: Sweep `ResultCard.tsx`**

Add import:

```ts
import { X, Download, Share2, Copy as CopyIcon } from "lucide-react";
```

Replace the delete button content `<span aria-hidden>×</span>` with `<X />`:

```tsx
<Button
  variant="destructive"
  size="icon"
  onClick={onDelete}
  aria-label="Delete result"
  className="size-7"
>
  <X />
</Button>
```

Optionally enhance other action buttons with leading icons (only if they fit visually — ResultCard buttons have text labels; icons via `data-icon`):

```tsx
<Button onClick={handleDownload}>
  <Download data-icon="inline-start" />
  Download PNG
</Button>
{shareSupported && (
  <Button variant="secondary" onClick={handleShare}>
    <Share2 data-icon="inline-start" />
    Share
  </Button>
)}
<Button variant="secondary" onClick={handleCopy} aria-label="Copy image">
  <CopyIcon data-icon="inline-start" />
  Copy
</Button>
```

- [ ] **Step 10.2: Sweep `PalettePicker.tsx`**

Add imports:

```ts
import { ClipboardPaste, Copy as CopyIcon, Pencil, Plus } from "lucide-react";
```

Replace `+ Custom` button content:

```tsx
<Button variant="secondary" size="sm" onClick={handleCreateCustom}>
  <Plus data-icon="inline-start" />
  Custom
</Button>
```

Replace `📋` paste-new button content with `<ClipboardPaste />`:

```tsx
<Button
  variant="secondary"
  size="icon"
  onClick={handlePasteNewPalette}
  disabled={!hasClipboardPalette}
  aria-label={
    hasClipboardPalette
      ? "Paste palette from clipboard"
      : "Clipboard does not contain a palette"
  }
>
  <ClipboardPaste />
</Button>
```

Replace `📄` copy-palette button content with `<CopyIcon />`. Replace `📋` paste-into-palette buttons content with `<ClipboardPaste />`.

Replace the `✏️` edit indicator on user palette swatches with `<Pencil className="size-3" />`. (`size-3` is acceptable here — this is a small inline indicator inside a label, not inside a `<Button>`.)

- [ ] **Step 10.3: Sweep `App.tsx`**

Verify the install button and any other text that previously had emojis. The Install button doesn't currently have an icon; you may add one:

```ts
import { Download as DownloadIcon } from "lucide-react";
```

```tsx
{isInstallable && (
  <Button onClick={handleInstallApp} title="Install this app on your device">
    <DownloadIcon data-icon="inline-start" />
    Install App
  </Button>
)}
```

- [ ] **Step 10.4: Grep for any leftover emojis**

Run from `packages/gbcam-extract-web/`:

```bash
grep -rn "📋\|📄\|✏️\|✕\|×\|📚\|📲\|🐛\|▼\|>\s*\\[" src/ --include="*.tsx" --include="*.ts" || echo "Clean"
```

Expected: "Clean" (or only matches inside comments/strings that aren't user-facing). If anything user-facing remains, replace it.

- [ ] **Step 10.5: Verify typecheck and smoke-test**

```bash
pnpm typecheck
```

```bash
pnpm dev
```

Visual check: every button/icon position now shows a lucide icon instead of an emoji.

Stop dev server.

- [ ] **Step 10.6: Commit**

```bash
git add packages/gbcam-extract-web/src/App.tsx \
        packages/gbcam-extract-web/src/components/ResultCard.tsx \
        packages/gbcam-extract-web/src/components/PalettePicker.tsx
git commit -m "$(cat <<'EOF'
refactor(web): replace remaining emojis with lucide icons

Sweep replace ×, 📋, 📄, ✏️ placeholders left from earlier tasks with
lucide-react components (X, ClipboardPaste, Copy, Pencil) plus
data-icon="inline-start"/end. Add icons to Install / Download / Share /
Copy buttons. After this commit the rendered UI contains zero emojis.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: RTL + final polish audit (commit 11)

**Files:**
- Modify: any remaining file in `packages/gbcam-extract-web/src/` that uses physical Tailwind classes or raw Tailwind colors.

- [ ] **Step 11.1: Grep for physical-direction Tailwind classes**

From `packages/gbcam-extract-web/`:

```bash
grep -rn "\bml-\|\bmr-\|\bpl-\|\bpr-\|\btext-left\b\|\btext-right\b\|\bleft-\|\bright-" src/ --include="*.tsx" --include="*.ts"
```

For every match in app code (NOT inside `src/shadcn/`), convert to logical equivalents:

| Physical | Logical |
|---|---|
| `ml-N` | `ms-N` |
| `mr-N` | `me-N` |
| `pl-N` | `ps-N` |
| `pr-N` | `pe-N` |
| `text-left` | `text-start` |
| `text-right` | `text-end` |
| `left-N` | `start-N` |
| `right-N` | `end-N` |
| `rounded-l-*` | `rounded-s-*` |
| `rounded-r-*` | `rounded-e-*` |
| `border-l-*` | `border-s-*` |
| `border-r-*` | `border-e-*` |

Note: matches inside `src/shadcn/` are left alone (no-edit policy).

- [ ] **Step 11.2: Grep for raw Tailwind colors in app code**

```bash
grep -rn "bg-gray-\|text-gray-\|border-gray-\|bg-blue-\|text-blue-\|bg-green-\|text-green-\|bg-red-\|text-red-\|bg-purple-\|text-purple-\|bg-yellow-" src/ --include="*.tsx" --include="*.ts" | grep -v "src/shadcn/" || echo "Clean"
```

For every match, convert to a semantic equivalent:

| Raw | Semantic |
|---|---|
| `bg-gray-900` (page bg) | `bg-background` |
| `bg-gray-800` (panel bg) | `bg-card` or `bg-muted` |
| `bg-gray-700` (input bg) | `bg-input` |
| `text-gray-100`/`text-white` | `text-foreground` |
| `text-gray-200`/`text-gray-300`/`text-gray-400` | `text-muted-foreground` |
| `text-gray-500`/`text-gray-600` | `text-muted-foreground` (or accept lower contrast via `text-muted-foreground/70`) |
| `border-gray-600`/`border-gray-700` | `border-border` |
| `border-blue-500`/`focus:border-blue-500` | `focus:border-ring` |
| `bg-blue-*` (status backgrounds) | `bg-primary/N` for accent overlays |
| `bg-red-900/50` (destructive overlay) | `bg-destructive/10` |
| Etc. | judgment call — pick the closest semantic token |

For each rewrite, check the spec section "Section 4d. Raw `<button>` → `<Button>` variants" for guidance on intent.

- [ ] **Step 11.3: Smoke-test in `dir="rtl"`**

Run `pnpm dev`. Open DevTools → Console:

```js
document.documentElement.setAttribute("dir", "rtl");
```

Expected: layout flips horizontally — buttons in right-to-left flow, drop zones still readable, accordion chevrons remain vertically symmetric. No content is cut off, no negative-direction overflow.

Set back:

```js
document.documentElement.setAttribute("dir", "ltr");
```

Stop dev server.

- [ ] **Step 11.4: Final typecheck + dev smoke-test in both themes**

```bash
pnpm typecheck
```

```bash
pnpm dev
```

Test:
1. Light theme: page bg is light, text is dark, buttons fuchsia-on-dark-text.
2. Dark theme: page bg is dark, text is light, buttons fuchsia-on-light-text.
3. System theme: matches OS.
4. All five collapsible sites work (Instructions, palette accordion, PipelineDebugViewer outer + inner accordion, Image History).
5. All buttons have appropriate variants.
6. All form controls work and validate.
7. All toasts trigger.
8. Empty state shows when applicable.
9. Delete All History dialog works.
10. ModeToggle works and persists.
11. App icon swaps with theme.
12. Favicon swaps with theme.
13. No console errors.

Stop dev server.

- [ ] **Step 11.5: Final emoji + raw-color sanity grep**

```bash
grep -rn "📋\|📄\|✏️\|📚\|📲\|🐛\|▼" packages/gbcam-extract-web/src/ --include="*.tsx" --include="*.ts" || echo "No emojis"
```

```bash
grep -rn "bg-gray-\|text-gray-\|bg-blue-\|text-blue-\|bg-green-\|text-green-\|bg-red-\|text-red-\|bg-purple-\|text-purple-" packages/gbcam-extract-web/src/ --include="*.tsx" --include="*.ts" | grep -v "src/shadcn/" || echo "No raw colors in app code"
```

Both should report clean.

- [ ] **Step 11.6: Commit**

```bash
git add packages/gbcam-extract-web/src/
git commit -m "$(cat <<'EOF'
chore(web): final RTL + semantic-token + polish audit

Sweep remaining physical Tailwind classes (ml-*/mr-*/pl-*/pr-*/text-left/
text-right/left-*/right-*) to logical equivalents (ms-/me-/ps-/pe-/
text-start/text-end/start-/end-). Convert remaining raw Tailwind colors
(bg-gray-*, text-gray-*, etc.) to semantic tokens (bg-background, bg-card,
bg-muted, text-foreground, text-muted-foreground, border-border,
focus:border-ring). Verified via grep that no emojis or raw colors remain
in app code (src/shadcn/ files left untouched per policy). Verified RTL
layout via dir="rtl" smoke test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step F.1: Full typecheck from repo root**

```bash
pnpm typecheck
```

Expected: PASS across all packages.

- [ ] **Step F.2: Full dev smoke**

```bash
cd packages/gbcam-extract-web
pnpm dev
```

Confirm acceptance criteria from the spec:

1. Existing user state survives (debug toggle, palette selections, output/preview scale, expanded palette sections, instructions panel state, user palettes, image history).
2. Theme toggle works (light/dark/system); app icon and favicon swap with resolved theme; in-app override is honored.
3. All five prior ad-hoc collapsible sites render through shadcn primitives; `PipelineDebugViewer`'s internal `CollapsibleSection` helper is gone.
4. No raw Tailwind colors remain in app code.
5. No physical-direction Tailwind classes remain in app code.
6. No emojis remain in the rendered UI.
7. No files in `src/shadcn/` modified after install (or any modifications wear `// CUSTOM:` and were approved).
8. AGENTS.md contains the Frontend Conventions section.

- [ ] **Step F.3: Optional production build smoke**

```bash
pnpm build
```

Expected: PASS. Warnings about asset sizes are acceptable. Errors require investigation.

- [ ] **Step F.4: Report completion**

Summarize: 11 commits landed, all acceptance criteria met (or note any deviation), any `// CUSTOM:` edits made and where.

---

## If you need a shadcn component that wasn't pre-installed

If during any task you realize you need a primitive not in the bulk install (e.g. `popover`, `hover-card`, `scroll-area`, `alert-dialog`):

1. Stop work on the current task.
2. Run from `packages/gbcam-extract-web/`:

```bash
pnpm shadcn add <name> --yes
```

3. Verify it landed in `src/shadcn/components/`.
4. Stage and commit:

```bash
git add packages/gbcam-extract-web/src/shadcn/components/<name>.tsx \
        packages/gbcam-extract-web/components.json
git commit -m "chore(web): install shadcn <name> component"
```

5. Resume the original task.

## If you need to edit a file under `src/shadcn/`

1. Try alternatives first: composition wrappers in `src/components/`, `cn()` overrides at the call site, custom variants via `className`, or a tweak in `index.css`.
2. If still required: make the edit, prefix the changed lines with `// CUSTOM: <one-line explanation>`.
3. Stage everything for the current task's commit.
4. **Pause and surface the edit for the user's approval before continuing.**
