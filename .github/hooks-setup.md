# Pre-Commit Hook Setup Guide

## Overview

This repository includes a pre-commit hook that automatically runs the pipeline tests for the `gbcam-extract` package when you make changes to relevant source files.

## What It Does

The pre-commit hook:
1. Detects changes to files in `packages/gbcam-extract/src/`, `scripts/`, `tsconfig.json`, or `package.json`
2. If changes are found, it runs `pnpm check-and-test` from the `gbcam-extract` directory
3. Blocks the commit if tests fail, ensuring code quality

## Setup Instructions

### Step 1: Enable the Hook

The hook script is located at `.git/hooks/pre-commit`. Git automatically looks for executable scripts in this directory when you commit.

#### On macOS/Linux:
```bash
chmod +x .git/hooks/pre-commit
```

#### On Windows (Git Bash or WSL):
```bash
chmod +x .git/hooks/pre-commit
```

#### On Windows (PowerShell):
The file permissions are handled automatically by Git for Windows. No additional action needed.

### Step 2: Verify Installation

To verify the hook is working, make a test change to a file in `packages/gbcam-extract/src/`:

```bash
# Edit a file
echo "// test change" >> packages/gbcam-extract/src/index.ts

# Try to commit
git add packages/gbcam-extract/src/index.ts
git commit -m "test: verify hook is working"

# The hook should run and execute test:pipeline
```

## What Gets Checked

The hook runs when you commit changes to:
- `packages/gbcam-extract/src/**/*` - Any source file changes
- `packages/gbcam-extract/scripts/**/*` - Script changes
- `packages/gbcam-extract/tsconfig.json` - TypeScript config changes
- `packages/gbcam-extract/package.json` - Package configuration changes

Other changes (like README updates, test outputs, etc.) won't trigger the hook.

## Bypassing the Hook (Emergency Only)

If you absolutely need to commit without running the hook:

```bash
git commit --no-verify
```

**Warning**: Use this sparingly! The hook is there to maintain code quality.

## Troubleshooting

### Hook Doesn't Run

1. Verify the hook file exists: `.git/hooks/pre-commit`
2. Check that it's executable (on Unix-like systems): `ls -la .git/hooks/pre-commit`
3. Make sure you have `pnpm` installed and accessible from your shell
4. Try running manually: `cd packages/gbcam-extract && pnpm check-and-test`

### "Command not found: pnpm"

Make sure pnpm is installed globally or accessible in your PATH:
```bash
npm install -g pnpm
```

### Tests are Too Slow

The pipeline tests (`test:pipeline`) can take a while on first run. This is expected. Consider:
- Running with `--no-verify` for WIP commits: `git commit --no-verify`
- Optimizing your code before committing
- Running tests manually: `cd packages/gbcam-extract && pnpm test:pipeline`

### On Windows: Hook Not Executing

1. Verify Git for Windows is installed
2. Try using Git Bash instead of PowerShell for commits
3. Check Git configuration: `git config core.hooksPath`
4. Reinstall Git for Windows with proper shell selection

## Manual Testing

To test the hook manually without committing:

```bash
# Make a change to a source file
echo "test" >> packages/gbcam-extract/src/common.ts

# Run the check manually
cd packages/gbcam-extract
pnpm check-and-test

# Or the full pipeline
pnpm test:pipeline
```

## Hook Script Details

The hook is a bash script that:
1. Gets the git repository root
2. Checks for changes in `packages/gbcam-extract/` using `git diff` and `git diff --cached`
3. Filters changes to only relevant source files
4. If relevant changes exist, runs `pnpm check-and-test`
5. Exits with the same exit code as the test command

### Location
- File: `.git/hooks/pre-commit`
- Script: `packages/gbcam-extract/scripts/check-and-test.ts` (TypeScript source)

### Related Scripts
- `pnpm check-and-test` - Main check script (runs tests if changes detected)
- `pnpm test:pipeline` - Pipeline accuracy tests
- `pnpm test` - Unit tests
