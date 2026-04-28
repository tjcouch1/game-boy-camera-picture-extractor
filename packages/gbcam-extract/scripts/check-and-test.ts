#!/usr/bin/env node
/**
 * Check for working changes in the gbcam-extract package
 * and run test:pipeline if there are any changes.
 */

import { execSync } from 'child_process';
import path from 'path';
import process from 'process';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');

/**
 * Get the list of working changes in the package directory
 * Returns the output of `git diff --name-only` which lists modified/added/deleted files
 */
function getWorkingChanges(): string[] {
  try {
    const output = execSync('git diff --name-only', {
      cwd: PACKAGE_DIR,
      encoding: 'utf-8',
    });
    return output
      .trim()
      .split('\n')
      .filter((file) => file.length > 0);
  } catch (error) {
    console.error('Failed to get working changes:', error);
    return [];
  }
}

/**
 * Get the list of staged changes in the package directory
 * Returns the output of `git diff --cached --name-only`
 */
function getStagedChanges(): string[] {
  try {
    const output = execSync('git diff --cached --name-only', {
      cwd: PACKAGE_DIR,
      encoding: 'utf-8',
    });
    return output
      .trim()
      .split('\n')
      .filter((file) => file.length > 0);
  } catch (error) {
    console.error('Failed to get staged changes:', error);
    return [];
  }
}

/**
 * Check if there are any relevant changes in src/ or scripts/
 */
function hasRelevantChanges(changes: string[]): boolean {
  return changes.some(
    (file) =>
      file.startsWith('src/') ||
      file.startsWith('scripts/') ||
      file === 'tsconfig.json' ||
      file === 'package.json',
  );
}

/**
 * Run the test:pipeline script
 */
function runTestPipeline(): void {
  try {
    console.log('Running test:pipeline...');
    execSync('pnpm test:pipeline', {
      cwd: PACKAGE_DIR,
      stdio: 'inherit',
    });
    console.log('✓ test:pipeline completed successfully');
  } catch (error) {
    console.error('✗ test:pipeline failed');
    process.exit(1);
  }
}

async function main() {
  const workingChanges = getWorkingChanges();
  const stagedChanges = getStagedChanges();
  const allChanges = [...new Set([...workingChanges, ...stagedChanges])];

  if (allChanges.length === 0) {
    console.log('No changes detected. Skipping test:pipeline.');
    process.exit(0);
  }

  if (!hasRelevantChanges(allChanges)) {
    console.log(
      'Changes detected, but none in src/, scripts/, or config files. Skipping test:pipeline.',
    );
    console.log('Changed files:', allChanges.join(', '));
    process.exit(0);
  }

  console.log('Changes detected in relevant files:');
  allChanges.forEach((file) => console.log(`  ${file}`));
  console.log();

  runTestPipeline();
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
