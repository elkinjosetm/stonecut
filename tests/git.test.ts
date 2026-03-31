/**
 * Tests for git branch-level operations using real temporary git repos.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkoutOrCreateBranch,
  defaultBranch,
  ensureCleanTree,
  pushBranch,
  createPr,
} from "../src/git";

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
    const result = Bun.spawnSync(
      ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
      { stdout: "pipe", stderr: "pipe" },
    );
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
    expect(() => ensureCleanTree()).toThrow(
      "Working tree has uncommitted changes",
    );
  });

  test("throws when there are untracked files", () => {
    const dir = makeGitRepo();
    writeFileSync(join(dir, "newfile.txt"), "hello");
    expect(() => ensureCleanTree()).toThrow(
      "Working tree has uncommitted changes",
    );
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
    expect(() => createPr("Test PR", "body", "main")).toThrow(
      "Failed to create PR",
    );
  });
});
