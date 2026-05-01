# Lint & Format Tooling — Design

**Date:** 2026-04-27
**Status:** Draft, pending user review

## Goal

Add `lint` (ESLint) and `format` (Prettier) scripts at the repo root that run across both `gbcam-extract` and `gbcam-extract-web`. Wire them into CI. Establish a sustainable tooling baseline that handles a forthcoming shadcn/ui frontend refactor without friction.

Stylelint is **not** included — Tailwind v4 + minimal CSS surface make it low-value today. Add later if real CSS grows.

## Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Lint strictness | Strict + type-aware (`typescript-eslint` `recommendedTypeChecked` + `stylisticTypeChecked`) |
| 2 | Shadcn-generated files | Excluded entirely from lint and format (`packages/gbcam-extract-web/src/shadcn/**`) |
| 3 | Prettier print width | 100; all other Prettier 3 defaults preserved |
| 4 | Stylelint | Skipped. Prettier handles `.css` formatting; `prettier-plugin-tailwindcss` sorts Tailwind classes in TSX |
| 5 | Script layout | Root + per-package scripts (matches existing `pnpm -r` pattern). Single root configs imported by per-package configs. |
| 6 | Script names | `lint`, `lint:fix`, `format` (writes), `format:check` (read-only, for CI) |
| 7 | Config file format | TypeScript (`eslint.config.ts`, `prettier.config.ts`) |
| 8 | DevDep location | Root `package.json` only; per-package scripts use `pnpm exec` via hoisting |
| 9 | Ignore source | `.gitignore` (loaded into both ESLint and Prettier); `.prettierignore` adds the small set of tracked-but-not-formatted paths |
| 10 | CI integration | `.github/workflows/test.yml`: add parallel `lint` and `format` jobs, both fail-fast |
| 11 | VS Code fallback | If per-package configs don't resolve cleanly in editor, collapse to single root config. Verified at end of implementation, not documented in AGENTS.md. |
| 12 | Pre-commit hooks | Husky + lint-staged. Runs `eslint --fix` and `prettier --write` on staged files only. Local-only; CI runs full lint/format separately. |

## File Layout

```
<repo root>
├── eslint.config.ts                           # Root ESLint flat config (base)
├── prettier.config.ts                         # Root Prettier config
├── .prettierignore                            # Plain text — supplements .gitignore
├── .husky/pre-commit                          # Runs lint-staged on commit
├── package.json                               # Root: tooling devDeps, scripts, lint-staged config
├── .github/workflows/test.yml                 # Modified: adds lint + format jobs
├── AGENTS.md                                  # Updated: adds "Linting and Formatting" section
└── packages/
    ├── gbcam-extract/
    │   ├── eslint.config.ts                   # Imports root, adds Node + browser globals + tsconfig
    │   └── package.json                       # Adds 4 scripts
    └── gbcam-extract-web/
        ├── eslint.config.ts                   # Imports root, adds browser + React + a11y + tsconfig
        └── package.json                       # Adds 4 scripts
```

## ESLint Configuration

### Root `eslint.config.ts`

Exports a flat config array consumed by per-package configs:

- `@eslint/js` `recommended`
- `typescript-eslint` `recommendedTypeChecked` + `stylisticTypeChecked`
- `parserOptions.projectService: true` (auto-discovers tsconfig per file; works with config files at the repo root)
- `parserOptions.projectService.allowDefaultProject: ["eslint.config.ts", "prettier.config.ts", "packages/*/eslint.config.ts"]` so root and per-package config files are linted without being added to any tsconfig `include`
- Curated extra rules:
  - `eqeqeq: error`
  - `no-console: ["warn", { allow: ["warn", "error"] }]`
  - `no-unused-vars: error` with `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"`
  - `prefer-const: error`
- Ignores via `includeIgnoreFile(.gitignore)` from `@eslint/compat`, plus extra ignores:
  - `packages/gbcam-extract-web/src/shadcn/**`
  - `packages/gbcam-extract-web/src/generated/**`
  - `pnpm-lock.yaml`
  - `supporting-materials/**`
  - `test-input/**`

### `packages/gbcam-extract/eslint.config.ts`

```ts
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import root from "../../eslint.config.ts";
import globals from "globals";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default [
  ...root,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir },
    },
  },
];
```

Node + browser globals because OpenCV.js code is shared between the CLI scripts and the web package.

### `packages/gbcam-extract-web/eslint.config.ts`

```ts
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import root from "../../eslint.config.ts";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default [
  ...root,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir },
    },
    settings: { react: { version: "detect" } },
  },
];
```

## Prettier Configuration

### Root `prettier.config.ts`

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

All other settings keep Prettier 3 defaults: 2-space indent, double quotes, semicolons, `trailingComma: "all"`, `arrowParens: "always"`, `bracketSpacing: true` — all of which match existing code.

`tailwindStylesheet` points the plugin at the Tailwind v4 CSS-first config so `@theme` tokens resolve when sorting classes. `tailwindFunctions` makes the plugin sort classes inside `cn()` / `clsx()` / `cva()` — shadcn's standard wrappers.

### Root `.prettierignore`

Plain text. Prettier reads `.gitignore` automatically; this file adds:

```
pnpm-lock.yaml
packages/gbcam-extract-web/src/shadcn/
supporting-materials/
test-input/
sample-pictures/
```

(`node_modules/`, `dist*/`, `test-output*/`, generated files, `.venv` etc. are inherited from `.gitignore`.)

## DevDep Additions (Root `package.json`)

All tooling devDeps live in the root `package.json` and are accessed by per-package scripts via `pnpm exec`.

```json
{
  "devDependencies": {
    "@eslint/compat": "^1.2.0",
    "@eslint/js": "^9.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-jsx-a11y": "^6.10.0",
    "eslint-plugin-react": "^7.37.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "globals": "^15.0.0",
    "husky": "^9.1.0",
    "jiti": "^2.4.0",
    "lint-staged": "^15.2.0",
    "prettier": "^3.5.0",
    "prettier-plugin-tailwindcss": "^0.6.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

Latest stable as of 2026-04-27; pin to caret minors. `jiti` enables `eslint.config.ts` loading. Prettier `prettier.config.ts` works natively at Volta-pinned Node 24.14.1 (no flag needed).

## Script Additions

### Root `package.json` (new scripts)

```json
{
  "scripts": {
    "lint": "pnpm -r run lint",
    "lint:fix": "pnpm -r run lint:fix",
    "format": "pnpm -r run format",
    "format:check": "pnpm -r run format:check",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,mjs,cjs}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md,css,html,yml,yaml}": [
      "prettier --write"
    ]
  }
}
```

`prepare` runs automatically after `pnpm install` and initializes the `.husky/` git hook directory. Husky 9 no-ops cleanly in CI when `.git` is absent, so no CI guard is needed.

### Each package's `package.json` (identical 4 scripts)

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

## CI Integration

Modify `.github/workflows/test.yml` to add two new jobs alongside the existing `test` job. All three jobs run in parallel.

### `lint` job

```yaml
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
```

The `build` step is required because the web package imports types from `gbcam-extract`, and type-aware lint must resolve those types across the package boundary.

### `format` job

```yaml
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
```

No `build` step needed; Prettier doesn't resolve types.

### Existing `test` job

Unchanged. Keeps `continue-on-error: true` because pipeline accuracy is still being improved.

`deploy.yml` is **not** modified. Lint runs on every PR via `test.yml`; the deploy workflow runs only on push to `production` and assumes already-merged code is clean.

## Pre-commit Hooks

Local-only pre-commit hook runs ESLint and Prettier on **staged files only** via `lint-staged`. Full-repo lint runs in CI; pre-commit catches issues earlier on the developer's machine without scanning untouched files.

### `.husky/pre-commit`

```sh
pnpm exec lint-staged
```

Single-line script. The Husky 9+ format omits the older `#!/usr/bin/env sh` shebang and `husky.sh` source line.

### Behavior

- On `git commit`, only files staged in the current commit are processed.
- For staged JS/TS files: `eslint --fix` runs first, then `prettier --write`. Both auto-modify files; `lint-staged` re-stages the changes automatically before the commit completes.
- For staged JSON/MD/CSS/HTML/YAML: only `prettier --write` runs.
- Files in shadcn / generated / ignored paths are skipped because each tool consults its own ignore configuration.
- Type-aware ESLint on staged files is fast in practice — `typescript-eslint`'s `projectService` caches the project graph between files in a single `lint-staged` invocation.
- Hook runs **only on commit**, not push. Typecheck stays a manual / CI job because it's project-wide and can't be narrowed by staged files.
- CI does not run the hook (Husky no-ops without `.git`); CI runs full `pnpm lint` and `pnpm format:check` instead.
- Bypass with `git commit --no-verify` in emergencies.

### Initial setup

After adding `husky` and `lint-staged` to devDeps and `"prepare": "husky"` to scripts, running `pnpm install` once initializes `.husky/`. The `.husky/pre-commit` file is then created and committed to the repo.

## Documentation Updates

Add a `### Linting and Formatting` subsection to `AGENTS.md` under `## How to Run`:

```markdown
### Linting and Formatting

From root:

\`\`\`bash
pnpm lint           # check
pnpm lint:fix       # auto-fix
pnpm format         # write formatted files
pnpm format:check   # check only (used in CI)
\`\`\`

Per-package equivalents (`pnpm --filter gbcam-extract lint`, etc.) work the same.
```

(No mention of the VS Code fallback — that's an implementation-time check, not documentation.)

## Implementation-time Verification (not user-facing)

After all wiring is complete:

1. Run `pnpm lint` and `pnpm format:check` from root — both must pass on a fresh clone (after one-time `pnpm format` to apply formatting and `pnpm lint:fix` to auto-fix what's auto-fixable; remaining lint errors must be addressed manually).
2. Ask the user to confirm VS Code's ESLint and Prettier extensions resolve correctly when editing files in each package.
3. **Fallback path** — if VS Code can't resolve per-package configs:
   - Delete `packages/*/eslint.config.ts`
   - Move per-package config logic into root `eslint.config.ts` using `files:` matchers (per-glob overrides for web vs extract)
   - Change root scripts from `pnpm -r run lint` to `eslint .` and `prettier .` directly
   - Remove per-package `lint`/`format` scripts
   - This is a one-commit collapse if needed.

## Out of Scope

- Stylelint (revisit if real CSS grows)
- Pre-push hooks (typecheck stays manual / CI-only)
- `eslint-plugin-tailwindcss` class-order linting in TSX (Prettier plugin handles this)
- Linting Python files (`gbcam-extract-py/` is historical reference)
- Linting / formatting `supporting-materials/` ASCII art and reference images
