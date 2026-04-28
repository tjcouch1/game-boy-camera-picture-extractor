# Pre-Commit Hook Implementation Summary

This document summarizes the pre-commit hook setup for the Game Boy Camera Picture Extractor repository.

## Files Created/Modified

### 1. **TypeScript Check Script**
- **Path**: `packages/gbcam-extract/scripts/check-and-test.ts`
- **Purpose**: Checks for working changes in the gbcam-extract package and runs `test:pipeline` if relevant changes are detected
- **Key Features**:
  - Uses `git diff` and `git diff --cached` to detect changes
  - Filters to only relevant files: `src/`, `scripts/`, `tsconfig.json`, `package.json`
  - Runs `pnpm test:pipeline` if changes are found
  - Can be run manually: `pnpm check-and-test`

### 2. **Updated package.json**
- **Path**: `packages/gbcam-extract/package.json`
- **Changes**: Added new script entry:
  ```json
  "check-and-test": "tsup scripts/check-and-test.ts --format esm --out-dir dist-scripts --clean && node dist-scripts/check-and-test.js"
  ```
- **Usage**: `pnpm check-and-test` from the gbcam-extract directory

### 3. **Pre-Commit Hook**
- **Path**: `.git/hooks/pre-commit`
- **Purpose**: Git hook that runs automatically before commits
- **Behavior**:
  - Detects changes in `packages/gbcam-extract/`
  - Runs `pnpm check-and-test` if relevant changes exist
  - Blocks commit if tests fail
  - Skips silently if no relevant changes

### 4. **Setup Documentation**
- **Path**: `.github/hooks-setup.md`
- **Contents**: Comprehensive guide for enabling and using the pre-commit hook

## How It Works

```
User runs: git commit
    ↓
Git executes: .git/hooks/pre-commit
    ↓
Hook checks: git diff --name-only, git diff --cached --name-only
    ↓
Hook filters: Only matches src/, scripts/, tsconfig.json, package.json
    ↓
If changes found:
    ↓
    Runs: pnpm check-and-test
    ↓
    Which runs:
    - TypeScript compilation
    - Detects actual working changes
    - Runs test:pipeline if needed
    ↓
If tests pass: Commit proceeds ✓
If tests fail: Commit blocked ✗
```

## Testing

The implementation has been tested and works correctly:

```
✓ Script compiles without errors
✓ Script runs successfully with pnpm check-and-test
✓ Script correctly detects changes vs. ignoring non-relevant files
✓ Script properly skips testing when no relevant changes exist
```

## Usage

### Automatic (Recommended)
Just commit normally - the hook will run automatically:
```bash
git add .
git commit -m "Improve warp algorithm"
# Hook runs automatically, tests execute
```

### Manual Testing
Test the script without committing:
```bash
cd packages/gbcam-extract
pnpm check-and-test
```

### Bypass (Emergency Only)
Skip the hook for a single commit:
```bash
git commit --no-verify
```

## Setup Steps for Users

1. **Make the hook executable** (if on macOS/Linux/WSL):
   ```bash
   chmod +x .git/hooks/pre-commit
   ```

2. **Verify it works**:
   ```bash
   cd packages/gbcam-extract
   pnpm check-and-test
   ```

3. **Make a test commit**:
   ```bash
   echo "// test" >> packages/gbcam-extract/src/common.ts
   git add packages/gbcam-extract/src/common.ts
   git commit -m "test: verify hook"
   ```

On Windows with Git for Windows, the hook should work automatically without additional setup.

## Key Benefits

✓ **Automatic Quality Checks**: Tests run before every commit for relevant changes
✓ **Early Detection**: Catches issues before they're committed
✓ **Smart Filtering**: Only runs tests for actual code changes
✓ **Flexible**: Can be bypassed with `--no-verify` when needed
✓ **Clear Output**: Provides helpful messages about what's being tested
✓ **Cross-Platform**: Works on Windows, macOS, and Linux

## Related Commands

From `packages/gbcam-extract/`:
- `pnpm check-and-test` - Check for changes and run pipeline tests
- `pnpm test:pipeline` - Run full pipeline accuracy tests
- `pnpm test` - Run unit tests only
- `pnpm test:watch` - Run unit tests in watch mode
- `pnpm interleave -- --image thing-1 --py warp,correct --ts crop,sample,quantize` - Debug specific pipeline steps
