/**
 * Tests for git branch-level operations using real temporary git repos.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkoutOrCreateBranch,
	defaultBranch,
	ensureCleanTree,
	pushBranch,
	createPr,
	snapshotWorkingTree,
	stageChanges,
	commitChanges,
	revertUncommitted,
} from "../src/git";
import type { WorkingTreeSnapshot } from "../src/types";

/** Saved cwd so we can restore after each test. */
let savedCwd: string;

/** Create a minimal git repo with one initial commit and return its path. */
function makeGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "forge-git-test-"));
	process.chdir(dir);
	Bun.spawnSync(["git", "init"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
	Bun.spawnSync(["git", "config", "user.email", "test@test.com"], {
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	Bun.spawnSync(["git", "config", "user.name", "Test"], {
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	writeFileSync(join(dir, "README.md"), "# test\n");
	Bun.spawnSync(["git", "add", "."], {
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	Bun.spawnSync(["git", "commit", "-m", "initial"], {
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	return dir;
}

beforeEach(() => {
	savedCwd = process.cwd();
});

afterEach(() => {
	process.chdir(savedCwd);
});

// ---------------------------------------------------------------------------
// defaultBranch
// ---------------------------------------------------------------------------

describe("defaultBranch", () => {
	test("falls back to 'main' when no remote HEAD is set", () => {
		makeGitRepo();
		expect(defaultBranch()).toBe("main");
	});

	test("returns branch name from refs/remotes/origin/HEAD", () => {
		const dir = makeGitRepo();
		// Simulate a remote HEAD ref by creating the packed ref manually
		Bun.spawnSync(["git", "remote", "add", "origin", dir], {
			stdout: "pipe",
			stderr: "pipe",
		});
		Bun.spawnSync(["git", "fetch", "origin"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		// After fetch, origin/HEAD may not be set automatically — set it explicitly
		Bun.spawnSync(
			["git", "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"],
			{ stdout: "pipe", stderr: "pipe" },
		);
		// Check what branch name we get — the initial branch might be "main" or "master"
		const result = Bun.spawnSync(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const ref = result.stdout.toString().trim();
		const expected = ref.replace("refs/remotes/origin/", "");
		expect(defaultBranch()).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// ensureCleanTree
// ---------------------------------------------------------------------------

describe("ensureCleanTree", () => {
	test("does not throw on a clean tree", () => {
		makeGitRepo();
		expect(() => ensureCleanTree()).not.toThrow();
	});

	test("throws when there are uncommitted changes", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "README.md"), "modified\n");
		expect(() => ensureCleanTree()).toThrow("Working tree has uncommitted changes");
	});

	test("throws when there are untracked files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "newfile.txt"), "hello");
		expect(() => ensureCleanTree()).toThrow("Working tree has uncommitted changes");
	});
});

// ---------------------------------------------------------------------------
// checkoutOrCreateBranch
// ---------------------------------------------------------------------------

describe("checkoutOrCreateBranch", () => {
	test("creates a new branch when it does not exist", () => {
		makeGitRepo();
		checkoutOrCreateBranch("feature-branch");
		const result = Bun.spawnSync(["git", "branch", "--show-current"], {
			stdout: "pipe",
		});
		expect(result.stdout.toString().trim()).toBe("feature-branch");
	});

	test("checks out an existing branch", () => {
		makeGitRepo();
		// Create branch, switch back, then checkout again
		Bun.spawnSync(["git", "checkout", "-b", "existing-branch"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		// Get initial branch name
		// Switch away so we can test checking out existing-branch
		Bun.spawnSync(["git", "checkout", "-b", "temp-branch"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		checkoutOrCreateBranch("existing-branch");
		const result = Bun.spawnSync(["git", "branch", "--show-current"], {
			stdout: "pipe",
		});
		expect(result.stdout.toString().trim()).toBe("existing-branch");
	});

	test("successive calls toggle between branches", () => {
		makeGitRepo();
		checkoutOrCreateBranch("branch-a");
		checkoutOrCreateBranch("branch-b");
		const resultB = Bun.spawnSync(["git", "branch", "--show-current"], {
			stdout: "pipe",
		});
		expect(resultB.stdout.toString().trim()).toBe("branch-b");

		checkoutOrCreateBranch("branch-a");
		const resultA = Bun.spawnSync(["git", "branch", "--show-current"], {
			stdout: "pipe",
		});
		expect(resultA.stdout.toString().trim()).toBe("branch-a");
	});
});

// ---------------------------------------------------------------------------
// pushBranch
// ---------------------------------------------------------------------------

describe("pushBranch", () => {
	test("throws when no remote is configured", () => {
		makeGitRepo();
		expect(() => pushBranch("main")).toThrow("Failed to push branch");
	});

	test("succeeds when pushing to a local bare remote", () => {
		// Set up a bare remote repo
		const bareDir = mkdtempSync(join(tmpdir(), "forge-bare-"));
		Bun.spawnSync(["git", "init", "--bare", bareDir], {
			stdout: "pipe",
			stderr: "pipe",
		});

		makeGitRepo();
		Bun.spawnSync(["git", "remote", "add", "origin", bareDir], {
			stdout: "pipe",
			stderr: "pipe",
		});

		expect(() => pushBranch("master")).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// createPr
// ---------------------------------------------------------------------------

describe("createPr", () => {
	test("throws when gh is not available or repo is not configured", () => {
		makeGitRepo();
		// gh pr create will fail in a local-only repo with no GitHub remote
		expect(() => createPr("Test PR", "body", "main")).toThrow("Failed to create PR");
	});
});

// ---------------------------------------------------------------------------
// snapshotWorkingTree
// ---------------------------------------------------------------------------

describe("snapshotWorkingTree", () => {
	test("captures untracked files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "junk.txt"), "pre-existing junk");
		const snapshot = snapshotWorkingTree();
		expect(snapshot.untracked.has("junk.txt")).toBe(true);
	});

	test("empty when clean", () => {
		makeGitRepo();
		const snapshot = snapshotWorkingTree();
		expect(snapshot.untracked.size).toBe(0);
	});

	test("does not include tracked modified files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "README.md"), "modified\n");
		const snapshot = snapshotWorkingTree();
		expect(snapshot.untracked.has("README.md")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// stageChanges
// ---------------------------------------------------------------------------

describe("stageChanges", () => {
	test("stages modified tracked files", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		writeFileSync(join(dir, "README.md"), "modified\n");
		expect(stageChanges(snapshot)).toBe(true);
	});

	test("stages new files not in snapshot", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		writeFileSync(join(dir, "new_file.py"), "print('hello')\n");
		expect(stageChanges(snapshot)).toBe(true);
	});

	test("ignores pre-existing untracked files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "junk.txt"), "pre-existing junk");
		const snapshot = snapshotWorkingTree();
		// No actual changes during "session"
		expect(stageChanges(snapshot)).toBe(false);
	});

	test("returns false when no changes", () => {
		makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		expect(stageChanges(snapshot)).toBe(false);
	});

	test("stages mix of modified and new files", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		writeFileSync(join(dir, "README.md"), "modified\n");
		writeFileSync(join(dir, "new_file.py"), "print('hello')\n");
		expect(stageChanges(snapshot)).toBe(true);
		// Verify both are staged
		const result = Bun.spawnSync(["git", "diff", "--cached", "--name-only"], {
			stdout: "pipe",
		});
		const staged = new Set(result.stdout.toString().trim().split("\n"));
		expect(staged.has("README.md")).toBe(true);
		expect(staged.has("new_file.py")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// commitChanges
// ---------------------------------------------------------------------------

describe("commitChanges", () => {
	test("successful commit", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "README.md"), "modified\n");
		Bun.spawnSync(["git", "add", "-u"], { stdout: "pipe", stderr: "pipe" });
		const [ok, output] = commitChanges("test commit");
		expect(ok).toBe(true);
		// Verify commit exists
		const result = Bun.spawnSync(["git", "log", "--oneline", "-1"], {
			stdout: "pipe",
		});
		expect(result.stdout.toString()).toContain("test commit");
	});

	test("fails when nothing is staged", () => {
		makeGitRepo();
		const [ok] = commitChanges("should fail");
		expect(ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// revertUncommitted
// ---------------------------------------------------------------------------

describe("revertUncommitted", () => {
	test("reverts modified tracked files", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		writeFileSync(join(dir, "README.md"), "modified\n");
		revertUncommitted(snapshot);
		const content = Bun.file(join(dir, "README.md")).text();
		expect(content).resolves.toBe("# test\n");
	});

	test("removes new files not in snapshot", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		writeFileSync(join(dir, "new_file.py"), "print('hello')\n");
		revertUncommitted(snapshot);
		expect(existsSync(join(dir, "new_file.py"))).toBe(false);
	});

	test("preserves pre-existing untracked files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "junk.txt"), "pre-existing junk");
		const snapshot = snapshotWorkingTree();
		writeFileSync(join(dir, "new_file.py"), "should be removed\n");
		writeFileSync(join(dir, "README.md"), "modified\n");
		revertUncommitted(snapshot);
		expect(existsSync(join(dir, "junk.txt"))).toBe(true);
		expect(existsSync(join(dir, "new_file.py"))).toBe(false);
		const content = Bun.file(join(dir, "README.md")).text();
		expect(content).resolves.toBe("# test\n");
	});
});
