/**
 * Skills management — setup and removal of Claude Code skill symlinks.
 *
 * Exports pure functions; CLI integration is in cli.ts.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export const SKILL_NAMES = ["forge-interview", "forge-prd", "forge-issues"];

/** Old skill names that used ':' as separator — used for migration only. */
const LEGACY_SKILL_NAMES = ["forge:interview", "forge:prd", "forge:issues"];

/**
 * Return the path to the skills/ directory shipped with this package.
 */
export function getSkillsSourceDir(): string {
  return resolve(import.meta.dir, "skills");
}

/**
 * Return the skills target directory, optionally creating it.
 */
export function getSkillsTargetDir(opts: {
  create?: boolean;
  claudeRoot?: string;
} = {}): string {
  const { create = true, claudeRoot } = opts;
  const target = claudeRoot
    ? join(claudeRoot, "skills")
    : join(homedir(), ".claude", "skills");
  if (create) {
    mkdirSync(target, { recursive: true });
  }
  return target;
}

/** Check if path exists as a symlink (without following it). */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Check if something exists at path (symlink or real). */
function pathExists(path: string): boolean {
  // existsSync follows symlinks, so also check lstat for dangling symlinks
  if (existsSync(path)) return true;
  return isSymlink(path);
}

export interface SkillsOutput {
  messages: string[];
  warnings: string[];
}

/**
 * Install Forge skills as symlinks into the target skills directory.
 */
export function setupSkills(claudeRoot?: string): SkillsOutput {
  const sourceDir = getSkillsSourceDir();
  const output: SkillsOutput = { messages: [], warnings: [] };

  if (!existsSync(sourceDir) || !lstatSync(sourceDir).isDirectory()) {
    throw new Error(`Skills directory not found at ${sourceDir}`);
  }

  const targetDir = getSkillsTargetDir({ claudeRoot });

  // Migrate legacy forge:* symlinks
  for (const legacyName of LEGACY_SKILL_NAMES) {
    const legacy = join(targetDir, legacyName);
    if (isSymlink(legacy)) {
      unlinkSync(legacy);
      output.messages.push(`Migrated: removed legacy skill link '${legacyName}'`);
    }
  }

  for (const name of SKILL_NAMES) {
    const source = join(sourceDir, name);
    const target = join(targetDir, name);

    if (!existsSync(source) || !lstatSync(source).isDirectory()) {
      output.warnings.push(`Warning: skill source not found: ${source}`);
      continue;
    }

    if (isSymlink(target)) {
      const existing = realpathSync(target);
      if (existing === realpathSync(source)) {
        // Already points to the right place — skip silently
        continue;
      }
      const linkTarget = readlinkSync(target);
      output.warnings.push(
        `Warning: ${target} already exists as symlink -> ${linkTarget}. Skipping.`,
      );
      continue;
    }

    if (pathExists(target)) {
      // Regular file or directory
      output.warnings.push(
        `Warning: ${target} already exists (not a symlink). Skipping.`,
      );
      continue;
    }

    symlinkSync(source, target);
    output.messages.push(`Linked ${name} -> ${source}`);
  }

  return output;
}

/**
 * Remove Forge skill symlinks from the target skills directory.
 */
export function removeSkills(claudeRoot?: string): SkillsOutput {
  const sourceDir = getSkillsSourceDir();
  const targetDir = getSkillsTargetDir({ create: false, claudeRoot });
  const output: SkillsOutput = { messages: [], warnings: [] };

  if (!existsSync(targetDir) || !lstatSync(targetDir).isDirectory()) {
    return output;
  }

  for (const name of SKILL_NAMES) {
    const target = join(targetDir, name);

    if (!isSymlink(target)) {
      continue;
    }

    // Only remove if it points into the Forge package
    const resolved = realpathSync(target);
    const expected = realpathSync(join(sourceDir, name));
    if (resolved !== expected) {
      continue;
    }

    unlinkSync(target);
    output.messages.push(`Removed ${name}`);
  }

  // Also clean up any legacy forge:* symlinks
  for (const legacyName of LEGACY_SKILL_NAMES) {
    const legacy = join(targetDir, legacyName);
    if (isSymlink(legacy)) {
      unlinkSync(legacy);
      output.messages.push(`Removed legacy skill link '${legacyName}'`);
    }
  }

  return output;
}
