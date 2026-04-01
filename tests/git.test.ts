/**
 * Tests for git branch-level operations using real temporary git repos.
 *
 * Each test creates an isolated temp repo and passes `cwd` to git functions
 * so tests are safe to run in parallel without process.chdir races.
 */

import { describe, expect, test } from "bun:test";
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

/** Create a minimal git repo with one initial commit and return its path. */
function makeGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "stonecut-git-test-"));
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

// ---------------------------------------------------------------------------
// defaultBranch
// ---------------------------------------------------------------------------

describe("defaultBranch", () => {
	test("falls back to 'main' when no remote HEAD is set", () => {
		const dir = makeGitRepo();
		expect(defaultBranch(dir)).toBe("main");
	});

	test("returns branch name from refs/remotes/origin/HEAD", () => {
		const dir = makeGitRepo();
		// Simulate a remote HEAD ref by creating the packed ref manually
		Bun.spawnSync(["git", "remote", "add", "origin", dir], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		Bun.spawnSync(["git", "fetch", "origin"], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		// After fetch, origin/HEAD may not be set automatically — set it explicitly
		Bun.spawnSync(
			["git", "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"],
			{ cwd: dir, stdout: "pipe", stderr: "pipe" },
		);
		// Check what branch name we get — the initial branch might be "main" or "master"
		const result = Bun.spawnSync(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		const ref = result.stdout.toString().trim();
		const expected = ref.replace("refs/remotes/origin/", "");
		expect(defaultBranch(dir)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// ensureCleanTree
// ---------------------------------------------------------------------------

describe("ensureCleanTree", () => {
	test("does not throw on a clean tree", () => {
		const dir = makeGitRepo();
		expect(() => ensureCleanTree(dir)).not.toThrow();
	});

	test("throws when there are uncommitted changes", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "README.md"), "modified\n");
		expect(() => ensureCleanTree(dir)).toThrow("Working tree has uncommitted changes");
	});

	test("throws when there are untracked files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "newfile.txt"), "hello");
		expect(() => ensureCleanTree(dir)).toThrow("Working tree has uncommitted changes");
	});
});

// ---------------------------------------------------------------------------
// checkoutOrCreateBranch
// ---------------------------------------------------------------------------

describe("checkoutOrCreateBranch", () => {
	test("creates a new branch when it does not exist", () => {
		const dir = makeGitRepo();
		checkoutOrCreateBranch("feature-branch", dir);
		const result = Bun.spawnSync(["git", "branch", "--show-current"], {
			cwd: dir,
			stdout: "pipe",
		});
		expect(result.stdout.toString().trim()).toBe("feature-branch");
	});

	test("checks out an existing branch", () => {
		const dir = makeGitRepo();
		// Create branch, switch back, then checkout again
		Bun.spawnSync(["git", "checkout", "-b", "existing-branch"], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		// Switch away so we can test checking out existing-branch
		Bun.spawnSync(["git", "checkout", "-b", "temp-branch"], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		checkoutOrCreateBranch("existing-branch", dir);
		const result = Bun.spawnSync(["git", "branch", "--show-current"], {
			cwd: dir,
			stdout: "pipe",
		});
		expect(result.stdout.toString().trim()).toBe("existing-branch");
	});

	test("successive calls toggle between branches", () => {
		const dir = makeGitRepo();
		checkoutOrCreateBranch("branch-a", dir);
		checkoutOrCreateBranch("branch-b", dir);
		const resultB = Bun.spawnSync(["git", "branch", "--show-current"], {
			cwd: dir,
			stdout: "pipe",
		});
		expect(resultB.stdout.toString().trim()).toBe("branch-b");

		checkoutOrCreateBranch("branch-a", dir);
		const resultA = Bun.spawnSync(["git", "branch", "--show-current"], {
			cwd: dir,
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
		const dir = makeGitRepo();
		expect(() => pushBranch("main", dir)).toThrow("Failed to push branch");
	});

	test("succeeds when pushing to a local bare remote", () => {
		// Set up a bare remote repo
		const bareDir = mkdtempSync(join(tmpdir(), "stonecut-bare-"));
		Bun.spawnSync(["git", "init", "--bare", bareDir], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const dir = makeGitRepo();
		Bun.spawnSync(["git", "remote", "add", "origin", bareDir], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});

		const currentBranch = Bun.spawnSync(["git", "branch", "--show-current"], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		})
			.stdout.toString()
			.trim();
		expect(() => pushBranch(currentBranch, dir)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// createPr
// ---------------------------------------------------------------------------

describe("createPr", () => {
	test("throws when gh is not available or repo is not configured", () => {
		const dir = makeGitRepo();
		// gh pr create will fail in a local-only repo with no GitHub remote
		// createPr doesn't accept cwd, so chdir temporarily
		const saved = process.cwd();
		process.chdir(dir);
		try {
			expect(() => createPr("Test PR", "body", "main")).toThrow("Failed to create PR");
		} finally {
			process.chdir(saved);
		}
	});
});

// ---------------------------------------------------------------------------
// snapshotWorkingTree
// ---------------------------------------------------------------------------

describe("snapshotWorkingTree", () => {
	test("captures untracked files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "junk.txt"), "pre-existing junk");
		const snapshot = snapshotWorkingTree(dir);
		expect(snapshot.untracked.has("junk.txt")).toBe(true);
	});

	test("empty when clean", () => {
		const dir = makeGitRepo();
		const snapshot = snapshotWorkingTree(dir);
		expect(snapshot.untracked.size).toBe(0);
	});

	test("does not include tracked modified files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "README.md"), "modified\n");
		const snapshot = snapshotWorkingTree(dir);
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
		expect(stageChanges(snapshot, dir)).toBe(true);
	});

	test("stages new files not in snapshot", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		writeFileSync(join(dir, "new_file.py"), "print('hello')\n");
		expect(stageChanges(snapshot, dir)).toBe(true);
	});

	test("ignores pre-existing untracked files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "junk.txt"), "pre-existing junk");
		const snapshot = snapshotWorkingTree(dir);
		// No actual changes during "session"
		expect(stageChanges(snapshot, dir)).toBe(false);
	});

	test("returns false when no changes", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		expect(stageChanges(snapshot, dir)).toBe(false);
	});

	test("stages mix of modified and new files", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		writeFileSync(join(dir, "README.md"), "modified\n");
		writeFileSync(join(dir, "new_file.py"), "print('hello')\n");
		expect(stageChanges(snapshot, dir)).toBe(true);
		// Verify both are staged
		const result = Bun.spawnSync(["git", "diff", "--cached", "--name-only"], {
			cwd: dir,
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
		Bun.spawnSync(["git", "add", "-u"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
		const [ok] = commitChanges("test commit", dir);
		expect(ok).toBe(true);
		// Verify commit exists
		const result = Bun.spawnSync(["git", "log", "--oneline", "-1"], {
			cwd: dir,
			stdout: "pipe",
		});
		expect(result.stdout.toString()).toContain("test commit");
	});

	test("fails when nothing is staged", () => {
		const dir = makeGitRepo();
		const [ok] = commitChanges("should fail", dir);
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
		revertUncommitted(snapshot, dir);
		const content = Bun.file(join(dir, "README.md")).text();
		expect(content).resolves.toBe("# test\n");
	});

	test("removes new files not in snapshot", () => {
		const dir = makeGitRepo();
		const snapshot: WorkingTreeSnapshot = { untracked: new Set() };
		writeFileSync(join(dir, "new_file.py"), "print('hello')\n");
		revertUncommitted(snapshot, dir);
		expect(existsSync(join(dir, "new_file.py"))).toBe(false);
	});

	test("preserves pre-existing untracked files", () => {
		const dir = makeGitRepo();
		writeFileSync(join(dir, "junk.txt"), "pre-existing junk");
		const snapshot = snapshotWorkingTree(dir);
		writeFileSync(join(dir, "new_file.py"), "should be removed\n");
		writeFileSync(join(dir, "README.md"), "modified\n");
		revertUncommitted(snapshot, dir);
		expect(existsSync(join(dir, "junk.txt"))).toBe(true);
		expect(existsSync(join(dir, "new_file.py"))).toBe(false);
		const content = Bun.file(join(dir, "README.md")).text();
		expect(content).resolves.toBe("# test\n");
	});
});
