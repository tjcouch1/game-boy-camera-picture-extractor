#!/usr/bin/env tsx
/*
 * Thin CLI entry for the blotch detector. The library functions and
 * the `runCli()` argument-parsing live in `blotch-detection.ts`; this
 * file exists only so the library can be imported from other scripts
 * (e.g., `run-tests.ts` for the per-pipeline overlay step) without
 * triggering `runCli()` at import time. tsup bundles imported modules
 * into the same output file as the entry script, so a top-level
 * `runCli()` call inside the library would also run during
 * `run-tests.js`'s import phase — splitting the entry point out is
 * the simplest reliable fix.
 */
import { runCli } from "./blotch-detection.js";

runCli();
