# Spec: Reimplement gbcam-extract-web frontend with shadcn/ui

**Date:** 2026-04-27
**Package:** `packages/gbcam-extract-web/`
**Status:** Approved for implementation planning

## Goal

Reimplement the web frontend's UI on top of shadcn/ui to:

1. Replace ad-hoc Tailwind markup with composed shadcn primitives.
2. Eliminate duplicated UI patterns — most notably five separate ad-hoc collapsible sites (including `PipelineDebugViewer`'s internal `CollapsibleSection` helper), scattered timed-flash feedback messages, and repeated localStorage-write boilerplate.
3. Adopt a coherent visual system (nova style, fuchsia accent, neutral base) with light/dark theming.
4. Make the styling RTL-safe (no translations — RTL = layout/style support only).

User-facing functionality and persisted state are preserved exactly. The refactor changes the UI layer only.

## Non-goals

- Internationalisation (translations / multilingual content). RTL is enabled at the styling layer only.
- Changes to the image-processing pipeline (`gbcam-extract`).
- Changes to existing localStorage keys or schemas — current users' saved settings, palettes, and image history must roundtrip across the refactor.
- New product features beyond a single small UX addition: a confirmation dialog before "Delete All History".

## Architectural choices

| Decision | Choice | Why |
|---|---|---|
| shadcn preset | `b2UrMghYe` | nova style, fuchsia accent, neutral base palette (chart colours fuchsia variants). |
| Primitives base | `base` (not `radix`) | Newer track; uniform `render` composition API; superset of `radix` capabilities (multi-select, object values). |
| RTL | `--rtl` enabled | Layout-level direction safety. |
| Theme switching | `next-themes` + `<ModeToggle>` (light/dark/system) | Canonical shadcn pattern; lets users override OS preference. |
| App icon swap | Theme-resolved (`useTheme().resolvedTheme`) | Existing `icon.{png,svg}` is light, `icon-dark.{png,svg}` is dark. |
| Favicon swap | Hybrid: media-query `<link>`s + JS swap on theme override | Fast first paint via media queries; in-app override honoured by JS effect with cache-buster. |
| State persistence | Generic `useLocalStorage<T>` foundation; specialized hooks build on top | Removes duplicated `JSON.parse` / `JSON.stringify` / try-catch boilerplate. |
| Directory layout | `src/shadcn/{components,hooks,utils}/` | All shadcn-installed files isolated from app code. |
| Icon library | `lucide-react` (already a dep) | Replace all emojis. |

## Directory layout (post-refactor)

```
packages/gbcam-extract-web/
  components.json                    # shadcn config (aliases configured below)
  src/
    App.tsx
    main.tsx                         # wraps <App> in <ThemeProvider>
    index.css                        # @import "tailwindcss" + shadcn @theme blocks
    components/
      ImageInput.tsx
      PipelineDebugViewer.tsx        # (replaces former IntermediateViewer.tsx)
      MarkdownRenderer.tsx
      ModeToggle.tsx                 # NEW: theme-toggle dropdown
      PalettePicker.tsx
      ResultCard.tsx
      CollapsibleInstructions.tsx
      # LoadingBar.tsx — DELETED (replaced by <Progress>)
    data/
      palettes.ts
    generated/
      UserInstructions.tsx
    hooks/
      useAppSettings.ts              # NEW: wraps gbcam-app-settings blob
      useClipboardPalette.ts
      useImageHistory.ts             # internals refactored onto useLocalStorage
      useLocalStorage.ts             # NEW: generic JSON-typed localStorage hook
      useOpenCV.ts
      usePaletteSectionState.ts      # internals refactored onto useLocalStorage
      useProcessing.ts
      useUserPalettes.ts             # internals refactored onto useLocalStorage
    shadcn/
      components/                    # shadcn UI primitives (aliases.ui, aliases.components)
      hooks/                         # shadcn-provided hooks (aliases.hooks)
      utils/
        utils.ts                     # cn() (aliases.lib points to folder; aliases.utils points to this file)
    utils/
      filenames.ts
      paletteClipboard.ts
      paletteUI.ts                   # may be reduced/deleted as styles move to shadcn primitives
      serialization.ts
      shareImage.ts
```

`components.json` aliases:

```json
{
  "aliases": {
    "components": "@/shadcn/components",
    "ui": "@/shadcn/components",
    "lib": "@/shadcn/utils",
    "utils": "@/shadcn/utils/utils",
    "hooks": "@/shadcn/hooks"
  }
}
```

`@/` path alias added to `tsconfig.json` (`baseUrl: "."`, `paths: { "@/*": ["src/*"] }`) and to `vite.config.ts` (`resolve.alias`).

## Component-level mapping (existing → shadcn)

| Current file | New shape |
|---|---|
| `App.tsx` | Wrapped in `<ThemeProvider>` (in `main.tsx`). `<Toaster richColors position="bottom-center">` mounted at top. Header gets `<ModeToggle>` next to "Install App". iOS install tip / OpenCV error / SW update banner → `<Alert>`. Settings checkboxes → `<Field>`+`<Checkbox>`+`<FieldLabel>`. Output/Preview Scale `<select>` → `<Select>` (base `items` prop). History batches → `<Card>` per batch wrapped in a `<Collapsible>` outer panel. "Delete All History" → `<Button variant="destructive">` triggering a `<Dialog>` confirmation. localStorage-writing helpers replaced with `useAppSettings`. |
| `CollapsibleInstructions.tsx` | `<Collapsible>` whose trigger uses base's `render={<Button variant="ghost" />}`. Open state via `useLocalStorage("gbcam-instructions-open", true)`. |
| `ImageInput.tsx` | Drop-zone styled with semantic tokens (`bg-muted`, `border-border`, drag state via `bg-accent`). Buttons → `<Button variant="secondary">`. Hidden `<input type="file">` and drag handlers unchanged. |
| `LoadingBar.tsx` | **Deleted.** Replaced inline by `<Progress value={progress} />` with optional sibling `<span>` for label. |
| `ProgressDisplay` (inline in `App.tsx`) | Local component using `<Progress>` + label. |
| `PalettePicker.tsx` | Outer wrapper → `<Card>`. Section headers (User Palettes / Button Combos / BG Presets / Additional / Fun) → single `<Accordion multiple>` with one `<AccordionItem>` per section, persisted via existing `usePaletteSectionState`. Swatch buttons → `<Button variant="outline">` with `data-state="selected"` styling. Editing-palette card → `<Card>` with `<FieldGroup>` for name/colour inputs. Color pickers stay native `<input type="color">` wrapped in `<Field>`+`<FieldLabel>`. Inline `setButtonFeedback` / setTimeouts deleted; replaced with `toast.success("Copied!")` etc. Validation → `<FieldDescription>` + `data-invalid`. |
| `ResultCard.tsx` | `<Card>` with `<CardHeader>` (filename + delete) and `<CardContent>` (canvas + actions). Action buttons → `<Button>` with lucide icons via `data-icon="inline-start"`. Tooltip on icon-only delete → `<Tooltip>`. Processing time → `<Badge variant="secondary">`. Copy feedback → `toast(...)`. |
| `PipelineDebugViewer.tsx` | Outer toggle → `<Collapsible>`. The four nested sections currently driven by an ad-hoc `CollapsibleSection` helper (Intermediate Steps default-open, Debug Images, Metrics, Log) → single `<Accordion multiple>` with one `<AccordionItem>` per section. Each step image → small `<Card>` with dimensions `<Badge>`. Component receives both `intermediates` and `debug` props (both optional); renders nothing if both are absent — which is the case for results loaded from history (debug payload is in-memory only, not persisted). |
| `MarkdownRenderer.tsx` | Structurally unchanged. Class simplified to `prose dark:prose-invert` so it follows the theme. |
| `DebugLogPanel.tsx` | **Out of scope** for this refactor (file is not on main; on a separate branch). |

## Cross-cutting refactors

### 1. Deduplication of collapsibles

Five current implementation sites consolidate to two shadcn primitives:

| Site | Replacement |
|---|---|
| `CollapsibleInstructions` | `<Collapsible>` (single panel, persisted) |
| Palette sections in `PalettePicker.tsx` (5 sections) | one `<Accordion multiple>` (multi-section, persisted) |
| `PipelineDebugViewer` outer "Debug: Pipeline Diagnostics" toggle | `<Collapsible>` (single panel, ephemeral) |
| `PipelineDebugViewer`'s ad-hoc inner `CollapsibleSection` helper (used 4×) | one `<Accordion multiple>` (Intermediate Steps default-expanded; Debug Images / Metrics / Log default-collapsed) — the helper is deleted |
| Image History panel in `App.tsx` | `<Collapsible>` (single panel, ephemeral) |

### 2. Inline timed-flash feedback → sonner toasts

`PalettePicker.tsx` and `ResultCard.tsx` currently maintain `setButtonFeedback` / `showCopyFeedback` state with `setTimeout(2000)` clears. All replaced with `toast.success(...)` / `toast.error(...)` / `toast.info(...)` calls. Single `<Toaster>` mounted in `App.tsx`.

### 3. localStorage abstraction

New generic hook:

```ts
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (val: T | ((prev: T) => T)) => void];
```

Behaviour:
- Lazy initial read with try/catch (handles unavailable storage, parse errors).
- Writes through to localStorage on each setter call, also catches errors.
- Optional cross-tab sync via the `storage` event (decision for the implementation plan).

Refactored consumers (all keep the same storage keys + JSON shapes):

| Consumer | Storage key |
|---|---|
| `useAppSettings` (NEW) | `gbcam-app-settings` |
| `CollapsibleInstructions` | `gbcam-instructions-open` |
| `useImageHistory` | (existing key) |
| `useUserPalettes` | (existing key) |
| `usePaletteSectionState` | (existing key) |

`next-themes` continues to manage its own `theme` key independently.

**Note on debug payload:** Per the existing `serialization.ts`, only the final grayscale image is persisted in `gbcam-image-history` — the `intermediates` and `debug` payloads (debug images, metrics, log) live in memory only and are dropped on reload. The refactor preserves this behavior; the `<PipelineDebugViewer>` is conditionally rendered only when those props exist (i.e., only on freshly-processed results in the current session, never on history items).

### 4. Buttons → variants

| Current style | New |
|---|---|
| `bg-blue-600 hover:bg-blue-700` (primary actions) | `<Button>` (default = primary fuchsia) |
| `bg-green-600 hover:bg-green-700` (Install, Download PNG) | `<Button>` (primary; intentional green→fuchsia under new theme) |
| `bg-red-600 hover:bg-red-700` (delete actions) | `<Button variant="destructive">` |
| `bg-gray-700 hover:bg-gray-600` (secondary actions) | `<Button variant="secondary">` or `variant="outline">` |
| `bg-purple-600 hover:bg-purple-700` (copy/share) | `<Button>` (primary) |
| Tiny rounded icon buttons (`✕`, `✏️`, `📋`, `📄`) | `<Button variant="ghost" size="icon">` + lucide icon |

### 5. Status / feedback / overlays

| Current | New |
|---|---|
| Custom blue tip div (iOS install) | `<Alert>` |
| Red error div (OpenCV failed) | `<Alert variant="destructive">` |
| Imperative DOM banner in `main.tsx` (SW update) | State-driven `<Alert>` rendered in `App.tsx` (driven by a new `useServiceWorker` hook or equivalent) |
| `LoadingBar.tsx` (custom CSS bar) | `<Progress>` |
| ProgressDisplay (custom CSS bar) | `<Progress>` |
| No empty state (just nothing rendered) | `<Empty>` for "No images yet" |
| `window.confirm`-less "Delete All History" | `<Dialog>` confirmation (NEW UX) |

### 6. Icon sweep (emojis → lucide)

All emojis removed. Mapping:

| Emoji | Replacement |
|---|---|
| `✕` | `X` |
| `✏️` | `Pencil` |
| `📋` | `ClipboardPaste` |
| `📄` | `Copy` |
| `📚` | `Library` (or `History`) |
| `🐛` | `Bug` (would have been used by DebugLogPanel — out of scope) |
| `📲` | `Smartphone` |
| `▼ / > / v` chevrons | `ChevronDown` rotated via `data-state` |

Inside `<Button>`, icons use `data-icon="inline-start"` / `data-icon="inline-end"` (no manual size classes). Icon-only buttons get `aria-label`.

### 7. Theme infrastructure

- `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>` from `next-themes`, mounted in `main.tsx` wrapping `<App>`.
- `src/components/ModeToggle.tsx` — `<DropdownMenu>` button, options Light / Dark / System with `<Sun>` / `<Moon>` / `<Monitor>` icons.
- App `<img>` swap: `useTheme()` + a small `mounted` guard; `src` switches between `./icon.svg` ↔ `./icon-dark.svg`.
- `index.html`:
  - Two `<link rel="icon" type="image/svg+xml">` entries with `media="(prefers-color-scheme: light|dark)"`.
  - JS swap effect (in `App.tsx` or a small hook) that updates the `<link>` href when `resolvedTheme` changes (with cache-buster query string).
  - Two `<meta name="theme-color">` entries with matching media queries; values from the preset's `--background`.
- `public/manifest.json`: list both icon variants with `media` keys (newer spec); preserve existing manifest fields otherwise.

### 8. RTL safety

All app-authored Tailwind classes use logical properties:

- `ms-*`/`me-*` instead of `ml-*`/`mr-*`
- `ps-*`/`pe-*` instead of `pl-*`/`pr-*`
- `start-*`/`end-*` instead of `left-*`/`right-*`
- `text-start`/`text-end` instead of `text-left`/`text-right`

Decorative direction-sensitive icons (e.g., `ChevronRight`) avoided in favour of vertical chevrons (`ChevronDown` rotated via `data-state`), which are RTL-symmetric. The `<html>` `dir` attribute is left as the browser default; enabling `--rtl` is a styling guarantee, not a UI toggle.

## Convention: don't edit installed shadcn files

Files installed under `src/shadcn/` are treated as immutable.

If during a refactor commit an edit appears necessary (anticipated cases: a registry import path the CLI didn't rewrite to match aliases; an accessibility nit unsolvable at the call site):

1. Try alternatives first — composition wrappers in `src/components/`, `cn()` overrides at the call site, custom variants via `className`, or a tweak in `index.css`.
2. If still required: make the edit, prefix the changed lines with `// CUSTOM: <one-line explanation>`.
3. Stage everything for that commit.
4. Pause the work and surface the edit for the user's approval before continuing.

## Implementation commit sequence

| # | Commit | Purpose |
|---|---|---|
| 1 | shadcn setup + bulk install | `pnpm shadcn init --preset b2UrMghYe --base base --rtl`; edit `components.json` aliases; add `@/` path alias to `tsconfig.json` + `vite.config.ts`; relocate any default-location files into `src/shadcn/...`; `pnpm add next-themes`; `pnpm shadcn add accordion alert badge button card checkbox collapsible dialog dropdown-menu empty field input label progress select separator sonner tooltip`. **No app/component edits.** |
| 2 | docs: AGENTS.md frontend conventions | Add the new "Frontend Conventions (gbcam-extract-web)" section (content below). |
| 3 | localStorage abstraction | Add `useLocalStorage`, add `useAppSettings`, refactor existing storage hooks onto it, update `App.tsx` and `CollapsibleInstructions` callsites. Storage keys/schemas preserved. |
| 4 | ThemeProvider + ModeToggle + theme-aware icons/favicon | next-themes wrapper, `ModeToggle` component, App icon swap, favicon JS swap with cache-buster, manifest icons, theme-color meta. |
| 5 | Accordions/Collapsibles dedupe | All five ad-hoc collapsible sites → shadcn primitives; `PipelineDebugViewer`'s internal `CollapsibleSection` helper deleted. |
| 6 | Buttons + Cards sweep | Variant mapping; logical Tailwind classes; `<Separator>` for footer. |
| 7 | Form controls | `<Field>`+`<Checkbox>`/`<Select>`/`<Input>` conversions; validation via `data-invalid`+`aria-invalid`. |
| 8 | sonner toast feedback | `<Toaster>` mount; replace inline timed-flash patterns with `toast.*`. |
| 9 | Alerts + Progress + Empty + Delete confirmation | `<Alert>` for banners; `<Progress>` replaces `LoadingBar`/ProgressDisplay; `<Empty>` for no-images state; `<Dialog>` confirmation for "Delete All History". |
| 10 | Icons — emojis → lucide | Sweep replace; `data-icon` placement; icon-only buttons get `aria-label`. |
| 11 | RTL + final polish audit | Grep for any leftover physical Tailwind classes (`ml-*`/`mr-*`/`text-left`/etc.) and convert; smoke-test with `dir="rtl"` on `<html>` in dev. |

If during any commit a shadcn primitive is needed that wasn't pre-installed, that primitive's install gets its own commit between others — per the project rule.

## AGENTS.md addition (commit 2 content)

A new section appended to `AGENTS.md`:

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
  `gbcam-image-history`, user palettes, palette section state) are
  preserved. `next-themes` manages its own `theme` key.
```

## Acceptance criteria

The refactor is complete when:

1. All eleven commits in the sequence above have landed (or have been merged into fewer commits with the user's approval).
2. `pnpm typecheck` passes from the repo root.
3. `pnpm dev` starts the website without errors and the website loads.
4. Manual smoke test: existing user state (debug toggle, palette selections, output/preview scale, expanded palette sections, instructions panel state, user palettes, image history) survives a refactor-build deploy.
5. Theme toggle (light / dark / system) works; app icon and favicon swap with the resolved theme; in-app override is honoured by the favicon (after first paint).
6. All five prior ad-hoc collapsible sites render through shadcn primitives; `PipelineDebugViewer`'s internal `CollapsibleSection` helper is gone.
7. No raw Tailwind colors (`bg-blue-*`, `text-gray-*`, etc.) remain in app code; only semantic tokens.
8. No physical-direction Tailwind classes (`ml-*`, `text-left`, etc.) remain in app code; only logical equivalents.
9. No emojis remain in the rendered UI; lucide icons used throughout.
10. No files in `src/shadcn/` have been modified after install (or any modifications are explicitly approved with `// CUSTOM:` comments).
11. AGENTS.md contains the new Frontend Conventions section.

## Open considerations (deferred to implementation plan)

- Whether `useLocalStorage` should subscribe to the `storage` event for cross-tab sync.
- Exact CSS-variable values for `<meta name="theme-color">` (read from the preset after init).
- Whether to also extract a `useServiceWorker` hook (commit 9 needs the SW update banner to be state-driven; the cleanest shape will fall out at implementation time).
- Whether `paletteUI.ts` constants survive the refactor or get inlined as components migrate.
