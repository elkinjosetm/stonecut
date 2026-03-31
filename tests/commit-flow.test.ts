/**
 * Tests for verifyAndFix and commitIssue.
 */

import { describe, expect, mock, test } from "bun:test";
import type { RunResult, Runner, WorkingTreeSnapshot } from "../src/types";

// -- Fake runner --------------------------------------------------------------

class FakeRunner implements Runner {
  calls: string[] = [];
  private _success: boolean;

  constructor(success = true) {
    this._success = success;
  }

  async run(prompt: string): Promise<RunResult> {
    this.calls.push(prompt);
    return { success: this._success, exitCode: 0, durationSeconds: 0.1 };
  }
}

// -- verifyAndFix -------------------------------------------------------------

describe("verifyAndFix", () => {
  test("passes on first check", async () => {
    // Import fresh module for each test group
    const { verifyAndFix } = await import("../src/runner");
    const runner = new FakeRunner();

    const [ok, output] = await verifyAndFix(
      runner,
      () => [true, "all good"],
      (err) => `fix: ${err}`,
    );

    expect(ok).toBe(true);
    expect(output).toBe("all good");
    expect(runner.calls).toEqual([]);
  });

  test("fix then pass", async () => {
    const { verifyAndFix } = await import("../src/runner");
    const runner = new FakeRunner();
    let callCount = 0;

    const [ok, output] = await verifyAndFix(
      runner,
      () => {
        callCount++;
        if (callCount === 1) return [false, "lint error"];
        return [true, "fixed"];
      },
      (err) => `fix: ${err}`,
    );

    expect(ok).toBe(true);
    expect(output).toBe("fixed");
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toContain("lint error");
  });

  test("fix then still fails", async () => {
    const { verifyAndFix } = await import("../src/runner");
    const runner = new FakeRunner();

    const [ok, output] = await verifyAndFix(
      runner,
      () => [false, "persistent error"],
      (err) => `fix: ${err}`,
    );

    expect(ok).toBe(false);
    expect(output).toBe("persistent error");
    expect(runner.calls).toHaveLength(1);
  });
});

// -- commitIssue --------------------------------------------------------------

describe("commitIssue", () => {
  const snapshot: WorkingTreeSnapshot = { untracked: new Set() };

  test("commit succeeds on first attempt", async () => {
    // Mock git module before importing runner
    const stageChangesMock = mock(() => true);
    const commitChangesMock = mock(() => [true, "committed"] as [boolean, string]);

    mock.module("../src/git", () => ({
      stageChanges: stageChangesMock,
      commitChanges: commitChangesMock,
    }));

    // Re-import to pick up mocked module
    const { commitIssue } = await import("../src/runner");
    const runner = new FakeRunner();

    const [ok, output] = await commitIssue(runner, "test commit", snapshot);

    expect(ok).toBe(true);
    expect(output).toBe("committed");
    expect(runner.calls).toEqual([]);
  });

  test("commit retry on hook failure", async () => {
    let commitAttempts = 0;
    const stageChangesMock = mock(() => true);
    const commitChangesMock = mock(() => {
      commitAttempts++;
      if (commitAttempts <= 1) {
        return [false, "pre-commit hook failed"] as [boolean, string];
      }
      return [true, "committed"] as [boolean, string];
    });

    mock.module("../src/git", () => ({
      stageChanges: stageChangesMock,
      commitChanges: commitChangesMock,
    }));

    const { commitIssue } = await import("../src/runner");
    const runner = new FakeRunner();

    const [ok, output] = await commitIssue(runner, "test commit", snapshot);

    expect(ok).toBe(true);
    expect(output).toBe("committed");
    // Runner was called to fix the hook failure
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toContain("pre-commit hook failed");
    expect(runner.calls[0]).toContain(
      "The git commit failed with the following output",
    );
  });

  test("commit exhaustion after max retries", async () => {
    const stageChangesMock = mock(() => true);
    const commitChangesMock = mock(
      () => [false, "hook failed"] as [boolean, string],
    );

    mock.module("../src/git", () => ({
      stageChanges: stageChangesMock,
      commitChanges: commitChangesMock,
    }));

    const { commitIssue } = await import("../src/runner");
    const runner = new FakeRunner();

    const [ok, output] = await commitIssue(runner, "test commit", snapshot, 3);

    expect(ok).toBe(false);
    expect(output).toBe("hook failed");
    // 3 retries × 1 fix attempt each = 3 runner calls
    expect(runner.calls).toHaveLength(3);
  });

  test("session stops after single retry with maxRetries=1", async () => {
    const stageChangesMock = mock(() => true);
    const commitChangesMock = mock(
      () => [false, "error"] as [boolean, string],
    );

    mock.module("../src/git", () => ({
      stageChanges: stageChangesMock,
      commitChanges: commitChangesMock,
    }));

    const { commitIssue } = await import("../src/runner");
    const runner = new FakeRunner();

    const [ok, _output] = await commitIssue(runner, "msg", snapshot, 1);

    expect(ok).toBe(false);
    // Only 1 retry, so 1 runner fix call
    expect(runner.calls).toHaveLength(1);
  });
});
