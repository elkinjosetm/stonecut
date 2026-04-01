/**
 * Tests for setup-skills and remove-skills — uses real temporary directories.
 */

import { describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { SKILL_NAMES, getSkillsSourceDir, setupSkills, removeSkills } from "../src/skills";

/** Create a fresh temp directory for each test. */
function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "stonecut-skills-test-"));
}

/** Create a claude root with a skills/ subdirectory. */
function makeClaudeRoot(): string {
	const root = makeTmpDir();
	const skillsDir = join(root, "skills");
	mkdirSync(skillsDir, { recursive: true });
	return root;
}

// ---------------------------------------------------------------------------
// Symlink creation
// ---------------------------------------------------------------------------

describe("setupSkills", () => {
	test("creates symlinks", () => {
		const root = makeClaudeRoot();
		const result = setupSkills(root);
		const skillsDir = join(root, "skills");

		expect(result.warnings).toHaveLength(0);
		for (const name of SKILL_NAMES) {
			const link = join(skillsDir, name);
			expect(lstatSync(link).isSymbolicLink()).toBe(true);
			expect(realpathSync(link)).toBe(realpathSync(join(getSkillsSourceDir(), name)));
		}
	});

	test("prints linked skills", () => {
		const root = makeClaudeRoot();
		const result = setupSkills(root);

		for (const name of SKILL_NAMES) {
			expect(result.messages.some((m) => m.includes(`Linked ${name}`))).toBe(true);
		}
	});

	test("idempotent — second run skips silently", () => {
		const root = makeClaudeRoot();
		setupSkills(root);
		const result2 = setupSkills(root);

		// Second run should produce no "Linked" messages
		for (const name of SKILL_NAMES) {
			expect(result2.messages.some((m) => m.includes(`Linked ${name}`))).toBe(false);
		}

		// Symlinks still valid
		const skillsDir = join(root, "skills");
		for (const name of SKILL_NAMES) {
			const link = join(skillsDir, name);
			expect(lstatSync(link).isSymbolicLink()).toBe(true);
			expect(realpathSync(link)).toBe(realpathSync(join(getSkillsSourceDir(), name)));
		}
	});
});

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

describe("setupSkills conflicts", () => {
	test("warns symlink pointing elsewhere", () => {
		const root = makeClaudeRoot();
		const otherDir = makeTmpDir();
		const skillsDir = join(root, "skills");
		const name = SKILL_NAMES[0];
		symlinkSync(otherDir, join(skillsDir, name));

		const result = setupSkills(root);
		expect(result.warnings.some((w) => w.includes("already exists as symlink"))).toBe(true);

		// Original symlink untouched
		expect(readlinkSync(join(skillsDir, name))).toBe(otherDir);
	});

	test("warns regular directory", () => {
		const root = makeClaudeRoot();
		const skillsDir = join(root, "skills");
		const name = SKILL_NAMES[0];
		mkdirSync(join(skillsDir, name));

		const result = setupSkills(root);
		expect(result.warnings.some((w) => w.includes("not a symlink"))).toBe(true);

		// Directory untouched
		expect(lstatSync(join(skillsDir, name)).isDirectory()).toBe(true);
		expect(lstatSync(join(skillsDir, name)).isSymbolicLink()).toBe(false);
	});

	test("warns regular file", () => {
		const root = makeClaudeRoot();
		const skillsDir = join(root, "skills");
		const name = SKILL_NAMES[0];
		writeFileSync(join(skillsDir, name), "not a skill");

		const result = setupSkills(root);
		expect(result.warnings.some((w) => w.includes("not a symlink"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Remove skills
// ---------------------------------------------------------------------------

describe("removeSkills", () => {
	test("removes stonecut symlinks", () => {
		const root = makeClaudeRoot();
		setupSkills(root);
		const skillsDir = join(root, "skills");
		for (const name of SKILL_NAMES) {
			expect(lstatSync(join(skillsDir, name)).isSymbolicLink()).toBe(true);
		}

		const result = removeSkills(root);
		for (const name of SKILL_NAMES) {
			expect(existsSync(join(skillsDir, name))).toBe(false);
			expect(result.messages.some((m) => m.includes(`Removed ${name}`))).toBe(true);
		}
	});

	test("leaves non-stonecut symlinks", () => {
		const root = makeClaudeRoot();
		const otherDir = makeTmpDir();
		const skillsDir = join(root, "skills");
		for (const name of SKILL_NAMES) {
			symlinkSync(otherDir, join(skillsDir, name));
		}

		removeSkills(root);
		// All symlinks should still be there — they don't point to Stonecut
		for (const name of SKILL_NAMES) {
			expect(lstatSync(join(skillsDir, name)).isSymbolicLink()).toBe(true);
			expect(readlinkSync(join(skillsDir, name))).toBe(otherDir);
		}
	});

	test("missing paths produce no error", () => {
		const root = makeClaudeRoot();
		// Nothing exists at the target paths
		const result = removeSkills(root);
		expect(result.messages).toHaveLength(0);
	});

	test("regular files not removed", () => {
		const root = makeClaudeRoot();
		const skillsDir = join(root, "skills");
		for (const name of SKILL_NAMES) {
			writeFileSync(join(skillsDir, name), "not a skill");
		}

		removeSkills(root);
		for (const name of SKILL_NAMES) {
			expect(existsSync(join(skillsDir, name))).toBe(true);
		}
	});

	test("noop when target dir missing", () => {
		const tmp = makeTmpDir();
		const nonexistent = join(tmp, "does-not-exist");

		const result = removeSkills(nonexistent);
		expect(result.messages).toHaveLength(0);
		expect(existsSync(nonexistent)).toBe(false);
	});

	test("regular directories not removed", () => {
		const root = makeClaudeRoot();
		const skillsDir = join(root, "skills");
		for (const name of SKILL_NAMES) {
			mkdirSync(join(skillsDir, name));
		}

		removeSkills(root);
		for (const name of SKILL_NAMES) {
			expect(lstatSync(join(skillsDir, name)).isDirectory()).toBe(true);
			expect(lstatSync(join(skillsDir, name)).isSymbolicLink()).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// --target flag (setup-skills)
// ---------------------------------------------------------------------------

describe("setupSkills --target", () => {
	test("creates symlinks at target", () => {
		const root = makeTmpDir();
		mkdirSync(join(root, ".claude-acme"));
		const claudeRoot = join(root, ".claude-acme");

		setupSkills(claudeRoot);
		const skillsDir = join(claudeRoot, "skills");
		expect(existsSync(skillsDir)).toBe(true);
		for (const name of SKILL_NAMES) {
			const link = join(skillsDir, name);
			expect(lstatSync(link).isSymbolicLink()).toBe(true);
			expect(realpathSync(link)).toBe(realpathSync(join(getSkillsSourceDir(), name)));
		}
	});

	test("creates skills subdir if missing", () => {
		const root = makeTmpDir();
		const claudeRoot = join(root, ".claude-fresh");
		mkdirSync(claudeRoot);
		const skillsDir = join(claudeRoot, "skills");
		expect(existsSync(skillsDir)).toBe(false);

		setupSkills(claudeRoot);
		expect(existsSync(skillsDir)).toBe(true);
		for (const name of SKILL_NAMES) {
			expect(lstatSync(join(skillsDir, name)).isSymbolicLink()).toBe(true);
		}
	});

	test("conflict detection with target", () => {
		const root = makeTmpDir();
		const claudeRoot = join(root, ".claude-conflict");
		const skillsDir = join(claudeRoot, "skills");
		mkdirSync(skillsDir, { recursive: true });

		const name = SKILL_NAMES[0];
		writeFileSync(join(skillsDir, name), "not a skill");

		const result = setupSkills(claudeRoot);
		expect(result.warnings.some((w) => w.includes("not a symlink"))).toBe(true);
	});

	test("idempotent with target", () => {
		const root = makeTmpDir();
		const claudeRoot = join(root, ".claude-idem");
		mkdirSync(claudeRoot);

		setupSkills(claudeRoot);
		const result2 = setupSkills(claudeRoot);
		for (const name of SKILL_NAMES) {
			expect(result2.messages.some((m) => m.includes(`Linked ${name}`))).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// --target flag (remove-skills)
// ---------------------------------------------------------------------------

describe("removeSkills --target", () => {
	test("removes stonecut symlinks at target", () => {
		const root = makeTmpDir();
		const claudeRoot = join(root, ".claude-acme");
		mkdirSync(claudeRoot);

		setupSkills(claudeRoot);
		const skillsDir = join(claudeRoot, "skills");
		for (const name of SKILL_NAMES) {
			expect(lstatSync(join(skillsDir, name)).isSymbolicLink()).toBe(true);
		}

		const result = removeSkills(claudeRoot);
		for (const name of SKILL_NAMES) {
			expect(existsSync(join(skillsDir, name))).toBe(false);
			expect(result.messages.some((m) => m.includes(`Removed ${name}`))).toBe(true);
		}
	});

	test("noop when target does not exist", () => {
		const tmp = makeTmpDir();
		const nonexistent = join(tmp, "no-such-root");

		const result = removeSkills(nonexistent);
		expect(result.messages).toHaveLength(0);
		expect(existsSync(nonexistent)).toBe(false);
	});

	test("leaves non-stonecut symlinks at target", () => {
		const root = makeTmpDir();
		const claudeRoot = join(root, ".claude-other");
		const skillsDir = join(claudeRoot, "skills");
		mkdirSync(skillsDir, { recursive: true });

		const otherDir = makeTmpDir();
		for (const name of SKILL_NAMES) {
			symlinkSync(otherDir, join(skillsDir, name));
		}

		removeSkills(claudeRoot);
		for (const name of SKILL_NAMES) {
			expect(lstatSync(join(skillsDir, name)).isSymbolicLink()).toBe(true);
			expect(readlinkSync(join(skillsDir, name))).toBe(otherDir);
		}
	});
});
