# Lint & Format Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `lint`/`lint:fix`/`format`/`format:check` scripts at the repo root that run across both packages, wire them into CI, and add Husky+lint-staged pre-commit hooks.

**Architecture:** ESLint flat config with strict + type-aware rules (`typescript-eslint` `recommendedTypeChecked` + `stylisticTypeChecked`). Single root config consumed by per-package configs that add package-specific globals/plugins. Prettier 3 with `prettier-plugin-tailwindcss` for class sorting. All tooling devDeps at the repo root, accessed via pnpm's hoisted `.bin`. Configs written in TypeScript (`eslint.config.ts`, `prettier.config.ts`) — ESLint loads via `jiti`, Prettier loads natively at the Volta-pinned Node 24.14.1.

**Tech Stack:** ESLint 9 (flat config), typescript-eslint 8, Prettier 3.5+, prettier-plugin-tailwindcss 0.6+, eslint-plugin-react / react-hooks / jsx-a11y, husky 9, lint-staged 15, jiti 2, globals 15, @eslint/compat.

**Spec:** `docs/superpowers/specs/2026-04-27-lint-format-tooling-design.md`

**Reference details for this plan:**
- Existing `tsconfig.json` files only `include` `src/**/*.{ts,tsx}` — every other `.ts` file (configs, scripts, vitest setup, tests) needs `allowDefaultProject` coverage in each package's `eslint.config.ts`.
- Root config files (`eslint.config.ts`, `prettier.config.ts`) are not directly linted because lint runs per-package; that's intentional.
- All commands run from `bash` (Windows Git Bash) using forward-slash paths.

---

## Task 1: Add tooling devDeps to root `package.json`

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add devDeps via pnpm**

Run from repo root:

```bash
pnpm add -wD \
  @eslint/compat@^1.2.0 \
  @eslint/js@^9.0.0 \
  eslint@^9.0.0 \
  eslint-plugin-jsx-a11y@^6.10.0 \
  eslint-plugin-react@^7.37.0 \
  eslint-plugin-react-hooks@^5.0.0 \
  globals@^15.0.0 \
  husky@^9.1.0 \
  jiti@^2.4.0 \
  lint-staged@^15.2.0 \
  prettier@^3.5.0 \
  prettier-plugin-tailwindcss@^0.6.0 \
  typescript-eslint@^8.0.0
```

The `-w` flag installs at the workspace root (this is a pnpm workspace). Versions resolve to latest stable matching the caret range.

- [ ] **Step 2: Verify binaries are accessible from package directories**

```bash
cd packages/gbcam-extract && pnpm exec eslint --version && pnpm exec prettier --version
```

Expected: prints two version strings (e.g., `v9.x.x` and `3.x.x`). No "command not found" errors.

```bash
cd packages/gbcam-extract-web && pnpm exec eslint --version && pnpm exec prettier --version
```

Expected: same.

- [ ] **Step 3: Stage but do not commit yet**

```bash
git add package.json pnpm-lock.yaml
```

(Commit happens in a later task once configs are in place — committing devDeps without configs would leave the repo in a broken state.)

---

## Task 2: Create root `prettier.config.ts`

**Files:**
- Create: `prettier.config.ts`

- [ ] **Step 1: Create the file**

```ts
import { type Config } from "prettier";

const config: Config = {
  printWidth: 100,
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./packages/gbcam-extract-web/src/index.css",
  tailwindFunctions: ["cn", "clsx", "cva"],
};

export default config;
```

- [ ] **Step 2: Verify Prettier loads the config**

From repo root:

```bash
pnpm exec prettier --check README.md
```

Expected: prints `Checking formatting...` then either `All matched files use Prettier code style!` or a list of files that need formatting. **Crucially: no error about loading the config file.** A loader error here means Prettier can't read the TS config — investigate Node version (`node --version` should print `v24.14.1` or similar v22.6+).

---

## Task 3: Create root `.prettierignore`

**Files:**
- Create: `.prettierignore`

- [ ] **Step 1: Create the file**

```
# Lockfile (tracked, but not for prettier)
pnpm-lock.yaml

# Shadcn-generated — managed by shadcn CLI
packages/gbcam-extract-web/src/shadcn/

# Reference materials — preserve exact formatting
supporting-materials/
test-input/
sample-pictures/
```

(Other paths — `node_modules/`, `dist*/`, `test-output*/`, `__pycache__/`, `.venv`, generated files like `UserInstructions.tsx` — are inherited automatically from `.gitignore`, which Prettier reads by default.)

- [ ] **Step 2: Verify ignore file is honored**

```bash
pnpm exec prettier --check pnpm-lock.yaml
```

Expected: `pnpm-lock.yaml` is not checked (output mentions the file is ignored, or no files match). If Prettier *does* check it and reports differences, the ignore file isn't being read — verify the file is at the repo root.

---

## Task 4: Create root `eslint.config.ts`

**Files:**
- Create: `eslint.config.ts`

- [ ] **Step 1: Create the file**

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gitignorePath = path.resolve(__dirname, ".gitignore");

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      "packages/gbcam-extract-web/src/shadcn/**",
      "packages/gbcam-extract-web/src/generated/**",
      "pnpm-lock.yaml",
      "supporting-materials/**",
      "test-input/**",
      "sample-pictures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      eqeqeq: "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": "off", // disable in favor of @typescript-eslint version
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "prefer-const": "error",
    },
  },
);
```

Notes:
- `tseslint.config(...)` is a typed helper that returns a flat config array.
- `includeIgnoreFile(gitignorePath)` reads `.gitignore` and merges its patterns into the ESLint ignore list.
- The base ESLint `no-unused-vars` is turned off because typescript-eslint provides a TypeScript-aware version.
- `parserOptions.projectService` and `tsconfigRootDir` are set per-package in Tasks 5 and 6, not here.

- [ ] **Step 2: Verify ESLint loads the config (without linting any files yet)**

From repo root:

```bash
pnpm exec eslint --print-config eslint.config.ts
```

Expected: prints a large JSON object describing the resolved config for that file. No errors about loading the config or missing peer dependencies. If you see "ESLint couldn't determine the plugin..." or "Cannot find package", the import paths or devDep versions are wrong — review Task 1 install output.

---

## Task 5: Create per-package config and scripts for `gbcam-extract`

**Files:**
- Create: `packages/gbcam-extract/eslint.config.ts`
- Modify: `packages/gbcam-extract/package.json`

- [ ] **Step 1: Create the per-package ESLint config**

Create `packages/gbcam-extract/eslint.config.ts`:

```ts
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";
import root from "../../eslint.config.ts";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default [
  ...root,
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.ts",
            "vitest.config.ts",
            "vitest.setup.ts",
            "test-opencv-init-node.ts",
            "scripts/*.ts",
            "tests/**/*.ts",
          ],
        },
        tsconfigRootDir,
      },
    },
  },
];
```

The `allowDefaultProject` glob list covers every `.ts` file in this package that isn't in `tsconfig.json`'s `include` (which only matches `src/**/*.ts`). Globs are relative to `tsconfigRootDir` (the package directory).

- [ ] **Step 2: Add per-package scripts to `packages/gbcam-extract/package.json`**

Add these four scripts to the `scripts` block (preserve existing scripts):

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

Final `scripts` block should look like (existing entries + new ones):

```json
"scripts": {
  "build": "pnpm run generate:palettes && tsup src/index.ts --format esm --dts",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:opencv-init-node": "tsup test-opencv-init-node.ts --format esm --out-dir dist-test --clean && node dist-test/test-opencv-init-node.js",
  "typecheck": "tsc --noEmit",
  "extract": "tsup scripts/extract.ts --format esm --out-dir dist-scripts --clean && node dist-scripts/extract.js",
  "test:pipeline": "tsup scripts/run-tests.ts --format esm --out-dir dist-scripts --clean && node dist-scripts/run-tests.js",
  "interleave": "tsup scripts/interleave-test.ts --format esm --out-dir dist-scripts --clean && node dist-scripts/interleave-test.js",
  "generate:palettes": "node scripts/generate-palettes.ts",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

- [ ] **Step 3: Verify ESLint runs from this package (errors expected)**

```bash
cd packages/gbcam-extract && pnpm lint
```

Expected: ESLint runs and prints lint errors/warnings against the existing source. **Failing with lint errors is fine** — what matters is that ESLint successfully loaded the config and parsed files. If you see "Parsing error" complaining about a file not being in the project, an `allowDefaultProject` glob is missing — add it. If you see "Cannot find module 'typescript-eslint'", devDeps aren't installed (rerun Task 1 step 1).

- [ ] **Step 4: Verify Prettier runs from this package**

```bash
pnpm format:check
```

Expected: Prettier runs and either passes or reports files that need formatting. No errors about loading the config (Prettier walks up to find `prettier.config.ts` at the root).

---

## Task 6: Create per-package config and scripts for `gbcam-extract-web`

**Files:**
- Create: `packages/gbcam-extract-web/eslint.config.ts`
- Modify: `packages/gbcam-extract-web/package.json`

- [ ] **Step 1: Create the per-package ESLint config**

Create `packages/gbcam-extract-web/eslint.config.ts`:

```ts
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import root from "../../eslint.config.ts";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default [
  ...root,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.ts",
            "vite.config.ts",
            "scripts/*.ts",
          ],
        },
        tsconfigRootDir,
      },
    },
    settings: { react: { version: "detect" } },
  },
];
```

- [ ] **Step 2: Add per-package scripts to `packages/gbcam-extract-web/package.json`**

Add the same four scripts as Task 5 to the `scripts` block:

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

Final `scripts` block (existing + new):

```json
"scripts": {
  "build:instructions": "node scripts/generate-instructions.ts",
  "dev": "pnpm build:instructions && vite",
  "dev:host": "pnpm build:instructions && vite --host",
  "build": "pnpm build:instructions && tsc -b && vite build",
  "preview": "pnpm build:instructions && vite preview",
  "preview:host": "pnpm build:instructions && vite preview --host",
  "serve": "node scripts/serve-dist.ts",
  "typecheck": "tsc --noEmit",
  "postinstall": "node scripts/generate-instructions.ts && node scripts/generate-licenses.ts",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

- [ ] **Step 3: Build `gbcam-extract` first (required for type-aware lint of web)**

The web package imports types from `gbcam-extract` (`import { processPicture } from "gbcam-extract"`). Type-aware lint resolves those types via the built `.d.ts` files in `packages/gbcam-extract/dist/`. Build first:

```bash
pnpm --filter gbcam-extract build
```

Expected: build succeeds; `packages/gbcam-extract/dist/index.d.ts` exists.

- [ ] **Step 4: Verify ESLint runs from the web package (errors expected)**

```bash
cd packages/gbcam-extract-web && pnpm lint
```

Expected: ESLint runs and prints lint errors/warnings against existing source. No "Parsing error" failures. If you see "Cannot find module 'gbcam-extract'", redo step 3.

- [ ] **Step 5: Verify Prettier runs from the web package**

```bash
pnpm format:check
```

Expected: Prettier runs and reports files needing formatting (or passes). No load errors.

---

## Task 7: Add root scripts and `lint-staged` config

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add scripts and lint-staged config**

Edit root `package.json`. Add these to the `scripts` block:

```json
"lint": "pnpm -r run lint",
"lint:fix": "pnpm -r run lint:fix",
"format": "pnpm -r run format",
"format:check": "pnpm -r run format:check",
"prepare": "husky"
```

Add a top-level `lint-staged` block (sibling to `scripts` and `devDependencies`):

```json
"lint-staged": {
  "*.{ts,tsx,js,jsx,mjs,cjs}": [
    "eslint --fix",
    "prettier --write"
  ],
  "*.{json,md,css,html,yml,yaml}": [
    "prettier --write"
  ]
}
```

Final root `package.json` `scripts` block (existing + new):

```json
"scripts": {
  "build": "pnpm -r run build",
  "test": "pnpm -r run test",
  "dev": "pnpm build && pnpm --filter gbcam-extract-web dev",
  "dev:host": "pnpm build && pnpm --filter gbcam-extract-web dev:host",
  "preview": "pnpm build && pnpm --filter gbcam-extract-web preview",
  "preview:host": "pnpm build && pnpm --filter gbcam-extract-web preview:host",
  "typecheck": "pnpm -r run typecheck",
  "extract": "pnpm --filter gbcam-extract run extract",
  "test:pipeline": "pnpm --filter gbcam-extract run test:pipeline",
  "lint": "pnpm -r run lint",
  "lint:fix": "pnpm -r run lint:fix",
  "format": "pnpm -r run format",
  "format:check": "pnpm -r run format:check",
  "prepare": "husky"
}
```

- [ ] **Step 2: Verify root scripts work**

```bash
pnpm format:check
```

Expected: runs `pnpm -r run format:check` which runs `prettier --check .` in each package. Reports files needing formatting (none should yet, since we haven't run `format` — most files will need formatting). No script-resolution errors.

```bash
pnpm lint
```

Expected: runs lint in both packages. Errors are fine (we'll fix in later tasks); script resolution must succeed.

- [ ] **Step 3: Commit configs and devDeps together**

This is the first commit of this feature — everything up through Task 7 has been staged or modified. Stage all of it:

```bash
git add package.json pnpm-lock.yaml prettier.config.ts .prettierignore eslint.config.ts \
  packages/gbcam-extract/eslint.config.ts packages/gbcam-extract/package.json \
  packages/gbcam-extract-web/eslint.config.ts packages/gbcam-extract-web/package.json
git commit -m "chore: add eslint, prettier, lint-staged tooling"
```

---

## Task 8: Initial Prettier format pass

**Files:**
- Modify: many existing source files (auto-formatted by Prettier)

- [ ] **Step 1: Run format across the whole repo**

```bash
pnpm format
```

Expected: Prettier rewrites every `.ts`/`.tsx`/`.css`/`.json`/`.md`/`.html`/`.yml`/`.yaml` file to canonical form. Output lists each file modified (or marked unchanged).

- [ ] **Step 2: Verify format:check now passes**

```bash
pnpm format:check
```

Expected: `All matched files use Prettier code style!` for both packages.

- [ ] **Step 3: Inspect the diff before committing**

```bash
git status
git diff --stat
```

Confirm only formatting changes (whitespace, line wrapping, quote consistency, trailing commas). No semantic code changes. If any file looks suspect, view its diff (`git diff <file>`) and verify it's purely cosmetic.

- [ ] **Step 4: Commit the formatting pass as a single commit**

```bash
git add -A
git commit -m "style: apply prettier formatting across repo"
```

A single commit isolates "noise" from real changes — useful for reviewers and `git blame` (which can later be told to ignore this commit via `.git-blame-ignore-revs`).

---

## Task 9: Initial ESLint auto-fix pass

**Files:**
- Modify: source files where ESLint can auto-fix violations

- [ ] **Step 1: Build `gbcam-extract` first (type-aware lint needs the .d.ts)**

```bash
pnpm --filter gbcam-extract build
```

- [ ] **Step 2: Run lint:fix across the whole repo**

```bash
pnpm lint:fix
```

Expected: ESLint auto-fixes what it can (import sorting from stylistic config, `prefer-const`, `consistent-type-imports`, etc.) and reports remaining errors that need manual attention.

- [ ] **Step 3: Inspect the diff**

```bash
git status
git diff --stat
```

Auto-fixes should be minor (e.g., `let` → `const`, `import { Foo }` → `import type { Foo }`). Review at least one file fully to verify changes are sensible.

- [ ] **Step 4: Commit the auto-fix pass**

```bash
git add -A
git commit -m "style: apply eslint auto-fixes"
```

---

## Task 10: Address remaining lint errors manually

**Files:**
- Modify: `eslint.config.ts` (add targeted rule overrides)
- Modify: source files where genuine fixes are warranted
- Maybe modify: per-package `eslint.config.ts` (for package-scoped rule changes)

This is the longest task. ESLint with strict + type-aware rules will likely report dozens of remaining errors after auto-fix. The goal is to drive `pnpm lint` to **zero errors and an acceptable number of warnings** (no warnings is best; some warnings like `no-console` may be legitimate to leave).

### Decision framework for each remaining error

For each rule violation, choose one of three responses:

1. **Fix the code** — when the rule is right and the code can be improved without semantic risk. Preferred.
2. **Inline disable with comment** — when the rule is correct in general but wrong for this specific call site, and the reason is non-obvious. Format: `// eslint-disable-next-line <rule-name> -- <reason>`.
3. **Disable the rule (or downgrade to warning) in config** — when the rule produces consistent noise across the codebase that isn't actionable. Edit root `eslint.config.ts` and add to the curated rules block.

### Common error categories to expect

Given the codebase (OpenCV.js types are loose `any`-typed; React 19 with hooks; CLI scripts), the following type-aware rules commonly fire and have known good responses in this codebase:

| Rule | Likely response |
|---|---|
| `@typescript-eslint/no-unsafe-assignment` / `-call` / `-member-access` / `-return` / `-argument` | OpenCV.js types are loose. **Disable repo-wide** in root config — there's no realistic way to fix every OpenCV call. Add to root rules. |
| `@typescript-eslint/no-explicit-any` | Mostly avoid. Inline-disable per call site if needed. |
| `@typescript-eslint/no-floating-promises` | **Fix.** Either `await`, return the promise, or `void promise` if intentionally fire-and-forget. This catches real bugs. |
| `@typescript-eslint/no-misused-promises` | **Fix.** Common in React event handlers — wrap async fns in `() => { void asyncFn(); }`. |
| `@typescript-eslint/prefer-nullish-coalescing` | Auto-fixed by lint:fix when safe; remaining cases — fix manually. |
| `@typescript-eslint/restrict-template-expressions` | Sometimes fires on `${error}` etc. Fix by stringifying explicitly: `${String(error)}`. |
| `react-hooks/exhaustive-deps` | **Fix or inline-disable per call site with justification.** Never disable repo-wide. |
| `jsx-a11y/*` | Fix when reasonable; inline-disable with justification when the markup is intentionally non-standard. |

- [ ] **Step 1: Run lint and capture the full output**

```bash
pnpm lint 2>&1 | tee /tmp/lint-output.txt
```

Read through the output. Group errors by rule using:

```bash
grep -oE '@?[a-z-]+/[a-z-]+|^\s+[a-z-]+\s+\w' /tmp/lint-output.txt | sort | uniq -c | sort -rn
```

(Approximate — for a more precise breakdown, run with `--format json` and parse.)

- [ ] **Step 2: Apply config-level disables for noisy unsafe-* rules**

If `no-unsafe-*` rules fire heavily (likely on OpenCV.js code), add to the rules block in root `eslint.config.ts`:

```ts
"@typescript-eslint/no-unsafe-assignment": "off",
"@typescript-eslint/no-unsafe-call": "off",
"@typescript-eslint/no-unsafe-member-access": "off",
"@typescript-eslint/no-unsafe-return": "off",
"@typescript-eslint/no-unsafe-argument": "off",
```

Add a comment above this block explaining: "OpenCV.js types are not strict; these rules produce noise without catching real bugs."

Re-run `pnpm lint` and confirm noise drops.

- [ ] **Step 3: Fix `no-floating-promises` and `no-misused-promises` violations**

These are real bug catchers. Walk through each report:

- For floating promises: add `await`, `return`, or explicit `void promise;` (with a comment explaining why fire-and-forget is intentional).
- For misused promises in event handlers, wrap: `onClick={() => { void asyncHandler(); }}`.

- [ ] **Step 4: Fix or inline-disable remaining rule violations**

Work through the list. For each case, apply the decision framework. Prefer code fixes; use inline disables sparingly with `--` comments explaining why.

- [ ] **Step 5: Verify zero errors**

```bash
pnpm lint
```

Expected: zero errors (warnings allowed). Exit code 0.

- [ ] **Step 6: Verify formatting still passes after manual edits**

```bash
pnpm format:check
```

If it fails, run `pnpm format` and stage the result.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: resolve lint errors and tighten eslint config"
```

If the work is large, consider splitting into multiple commits (e.g., one per category: "fix floating promises", "disable no-unsafe-* rules for opencv", etc.).

---

## Task 11: Set up Husky pre-commit hook

**Files:**
- Create: `.husky/pre-commit`

- [ ] **Step 1: Re-run pnpm install to trigger `prepare`**

```bash
pnpm install
```

The `"prepare": "husky"` script (added in Task 7) runs automatically and creates the `.husky/` directory with a `_/` subdirectory of internal scripts.

Verify:

```bash
ls .husky/
```

Expected: `_/` subdirectory exists. (It contains `husky.sh` and other internals.)

- [ ] **Step 2: Create the pre-commit hook file**

Create `.husky/pre-commit`:

```sh
pnpm exec lint-staged
```

(One line. No shebang. Husky 9+ does not require the older `#!/usr/bin/env sh` and `. "$(dirname -- "$0")/_/husky.sh"` boilerplate.)

- [ ] **Step 3: Make it executable (Unix; no-op on Windows but harmless)**

```bash
chmod +x .husky/pre-commit
```

On Git for Windows, the executable bit is recorded by git via `git update-index --chmod=+x`:

```bash
git update-index --chmod=+x .husky/pre-commit
```

(Run this to record the bit even if the FS doesn't support it; necessary for the hook to run on Linux/macOS contributors.)

- [ ] **Step 4: Smoke-test the hook**

Make a trivial change and try to commit it:

```bash
echo "" >> README.md
git add README.md
git commit -m "test: smoke test pre-commit hook"
```

Expected: lint-staged runs (you'll see "Running tasks for staged files..."), prettier writes README.md, the hook completes, and the commit lands. If the hook fails, the commit is aborted.

If everything looks good, **revert the smoke test commit and the README change**:

```bash
git reset --hard HEAD~1
```

(This works because the README change was a single-character append; if you accidentally committed real changes alongside, use `git reset HEAD~1` to keep the work uncommitted and inspect.)

- [ ] **Step 5: Test the hook on a deliberately broken file**

Quickly verify the hook actually rejects bad code:

```bash
# Introduce a deliberate lint error
echo "const x: any = 1; console.log(x)" >> packages/gbcam-extract/src/common.ts
git add packages/gbcam-extract/src/common.ts
git commit -m "test: hook should reject this"
```

Expected: the commit fails because lint-staged reports an ESLint error.

Revert:

```bash
git reset HEAD packages/gbcam-extract/src/common.ts
git checkout -- packages/gbcam-extract/src/common.ts
```

- [ ] **Step 6: Commit the hook file itself**

```bash
git add .husky/pre-commit
git commit -m "chore: add husky pre-commit hook running lint-staged"
```

---

## Task 12: Add CI lint and format jobs to `.github/workflows/test.yml`

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Replace the workflow file with the new content**

Full replacement contents for `.github/workflows/test.yml`:

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/get-volta-node-version
        id: volta
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ steps.volta.outputs.node-version }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter gbcam-extract build
      - run: pnpm lint

  format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/get-volta-node-version
        id: volta
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ steps.volta.outputs.node-version }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/get-volta-node-version
        id: volta
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ steps.volta.outputs.node-version }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter gbcam-extract build
      - run: pnpm --filter gbcam-extract test
        # Tests don't succeed 100% yet, but we want to run them on CI to track progress
        continue-on-error: true
```

The existing `test` job is preserved verbatim. Two new jobs (`lint`, `format`) are added before it. All three run in parallel.

- [ ] **Step 2: Validate YAML syntax locally**

If you have `yamllint` available:

```bash
yamllint .github/workflows/test.yml
```

Otherwise, parse with Node:

```bash
node -e "console.log(JSON.stringify(require('js-yaml').load(require('fs').readFileSync('.github/workflows/test.yml','utf8')), null, 2))" 2>&1 | head -5
```

(Skip if `js-yaml` isn't installed; GitHub will validate on push.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add lint and format jobs to test workflow"
```

---

## Task 13: Update `AGENTS.md` documentation

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add a "Linting and Formatting" subsection**

Locate the `### Tests` subsection in `AGENTS.md` (under `## How to Run`). After the existing test-related subsections (`### Tests`, `### Interleave test`, `### Inspecting test results`, `### Pipeline debug output`) and **before** `### Website`, insert a new subsection:

````markdown
### Linting and Formatting

From root:

```bash
pnpm lint           # check (CI runs this)
pnpm lint:fix       # auto-fix what's auto-fixable
pnpm format         # write formatted files
pnpm format:check   # check only (CI runs this)
```

Per-package equivalents work the same:

```bash
pnpm --filter gbcam-extract lint
pnpm --filter gbcam-extract-web format
```

A pre-commit hook (Husky + lint-staged) automatically runs `eslint --fix` and `prettier --write` on staged files. Bypass in emergencies with `git commit --no-verify`.
````

- [ ] **Step 2: Verify with prettier**

```bash
pnpm exec prettier --check AGENTS.md
```

Expected: passes. If not, run `pnpm exec prettier --write AGENTS.md`.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document lint and format scripts in AGENTS.md"
```

---

## Task 14: Final verification + VS Code editor check

**Files:** none modified in this task (unless fallback is needed).

- [ ] **Step 1: Run all root commands from a clean state**

```bash
pnpm install --frozen-lockfile
pnpm --filter gbcam-extract build
pnpm lint
pnpm format:check
pnpm typecheck
pnpm --filter gbcam-extract test
```

Expected: all pass (the `test` step may have known accuracy failures — that's pre-existing behavior, not something this work caused).

- [ ] **Step 2: Ask the user to verify VS Code editor integration**

Pause here and ask the user:

> "Implementation is complete. Please verify in VS Code:
> 1. Open `packages/gbcam-extract/src/warp.ts` — ESLint warnings/errors should appear inline (the ESLint extension picks up `packages/gbcam-extract/eslint.config.ts`).
> 2. Open `packages/gbcam-extract-web/src/App.tsx` — same check (uses `packages/gbcam-extract-web/eslint.config.ts`).
> 3. Save a file with bad formatting — Prettier should auto-format on save (if you have Format on Save enabled).
>
> Do both ESLint and Prettier work correctly from each package?"

- [ ] **Step 3: If VS Code integration works → done.**

No further action. Plan complete.

- [ ] **Step 4: If VS Code integration does NOT work → execute the fallback**

Fallback: collapse to a single root config. Steps:

1. **Delete per-package configs:**
   ```bash
   rm packages/gbcam-extract/eslint.config.ts
   rm packages/gbcam-extract-web/eslint.config.ts
   ```

2. **Move all package-specific config into root `eslint.config.ts`** using `files:` glob matchers. Replace root `eslint.config.ts` with:

   ```ts
   import path from "node:path";
   import { fileURLToPath } from "node:url";
   import { includeIgnoreFile } from "@eslint/compat";
   import js from "@eslint/js";
   import tseslint from "typescript-eslint";
   import globals from "globals";
   import react from "eslint-plugin-react";
   import reactHooks from "eslint-plugin-react-hooks";
   import jsxA11y from "eslint-plugin-jsx-a11y";

   const __dirname = path.dirname(fileURLToPath(import.meta.url));
   const gitignorePath = path.resolve(__dirname, ".gitignore");

   export default tseslint.config(
     includeIgnoreFile(gitignorePath),
     {
       ignores: [
         "packages/gbcam-extract-web/src/shadcn/**",
         "packages/gbcam-extract-web/src/generated/**",
         "pnpm-lock.yaml",
         "supporting-materials/**",
         "test-input/**",
         "sample-pictures/**",
       ],
     },
     js.configs.recommended,
     ...tseslint.configs.recommendedTypeChecked,
     ...tseslint.configs.stylisticTypeChecked,
     {
       rules: {
         eqeqeq: "error",
         "no-console": ["warn", { allow: ["warn", "error"] }],
         "no-unused-vars": "off",
         "@typescript-eslint/no-unused-vars": [
           "error",
           { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
         ],
         "prefer-const": "error",
         // (carry over any other rules tightened during Task 10)
       },
     },
     // gbcam-extract package
     {
       files: ["packages/gbcam-extract/**/*.{ts,tsx,js,mjs,cjs}"],
       languageOptions: {
         globals: { ...globals.node, ...globals.browser },
         parserOptions: {
           projectService: {
             allowDefaultProject: [
               "packages/gbcam-extract/eslint.config.ts",
               "packages/gbcam-extract/vitest.config.ts",
               "packages/gbcam-extract/vitest.setup.ts",
               "packages/gbcam-extract/test-opencv-init-node.ts",
               "packages/gbcam-extract/scripts/*.ts",
               "packages/gbcam-extract/tests/**/*.ts",
             ],
           },
           tsconfigRootDir: __dirname,
         },
       },
     },
     // gbcam-extract-web package
     {
       files: ["packages/gbcam-extract-web/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
       extends: [
         react.configs.flat.recommended,
         react.configs.flat["jsx-runtime"],
         reactHooks.configs["recommended-latest"],
         jsxA11y.flatConfigs.recommended,
       ],
       languageOptions: {
         globals: globals.browser,
         parserOptions: {
           projectService: {
             allowDefaultProject: [
               "packages/gbcam-extract-web/eslint.config.ts",
               "packages/gbcam-extract-web/vite.config.ts",
               "packages/gbcam-extract-web/scripts/*.ts",
             ],
           },
           tsconfigRootDir: __dirname,
         },
       },
       settings: { react: { version: "detect" } },
     },
   );
   ```

3. **Change root scripts in `package.json`:**

   Replace the four root lint/format scripts:
   ```json
   "lint": "eslint .",
   "lint:fix": "eslint . --fix",
   "format": "prettier --write .",
   "format:check": "prettier --check ."
   ```
   (No more `pnpm -r run`.)

4. **Remove the four lint/format scripts from each package's `package.json`** (keep all other scripts).

5. **Verify everything still works:**
   ```bash
   pnpm install
   pnpm --filter gbcam-extract build
   pnpm lint
   pnpm format:check
   ```

6. **Re-verify VS Code** — with a single root config, the ESLint extension should reliably pick it up.

7. **Commit:**
   ```bash
   git add -A
   git commit -m "chore: collapse eslint config to single root file for editor compatibility"
   ```

---

## Self-review notes

**Spec coverage:**
- Decision 1 (strict + type-aware): Tasks 4, 5, 6 (recommendedTypeChecked + stylisticTypeChecked, projectService).
- Decision 2 (shadcn excluded): Task 4 (root ignores), Task 3 (.prettierignore).
- Decision 3 (printWidth 100): Task 2.
- Decision 4 (no stylelint, prettier-plugin-tailwindcss): Task 2.
- Decision 5 (root + per-package scripts): Tasks 5, 6, 7.
- Decision 6 (script names): Tasks 5, 6, 7.
- Decision 7 (TS configs): Tasks 2, 4, 5, 6.
- Decision 8 (root devDeps): Task 1 with `-w` flag.
- Decision 9 (.gitignore source + .prettierignore extras): Tasks 3, 4.
- Decision 10 (CI parallel jobs): Task 12.
- Decision 11 (VS Code fallback): Task 14.
- Decision 12 (Husky + lint-staged): Tasks 7, 11.

**Out-of-scope items confirmed not in plan:** stylelint, pre-push hooks, eslint-plugin-tailwindcss for class order, Python file linting.

**Type/name consistency check:** `eslint.config.ts` (consistent across tasks), `prettier.config.ts` (consistent), `tsconfigRootDir` and `projectService.allowDefaultProject` (consistent shape across Tasks 5, 6, 14). Script names match across root and per-package package.json edits.
