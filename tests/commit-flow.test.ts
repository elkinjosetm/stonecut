/**
 * Tests for verifyAndFix, commitIssue, runAfkLoop, fmtTime, and printSummary.
 *
 * Git operations are injected via the GitOps parameter instead of using
 * mock.module, which leaks across test files in Bun's single-process runner.
 */

import { describe, expect, test } from "bun:test";
import { verifyAndFix, commitIssue, runAfkLoop, fmtTime, printSummary } from "../src/runner";
import type {
	GitOps,
	LogWriter,
	RunResult,
	Runner,
	Session,
	Source,
	WorkingTreeSnapshot,
} from "../src/types";

// -- Fake runner --------------------------------------------------------------

class FakeRunner implements Runner {
	calls: string[] = [];
	private _success: boolean;

	constructor(success = true) {
		this._success = success;
	}

	logEnvironment(): void {}

	async run(prompt: string): Promise<RunResult> {
		this.calls.push(prompt);
		return { success: this._success, exitCode: 0, durationSeconds: 0.1 };
	}
}

// -- Fake logger --------------------------------------------------------------

class FakeLogger implements LogWriter {
	messages: string[] = [];
	log(message: string): void {
		this.messages.push(message);
	}
	close(): void {}
}

// -- Fake git ops -------------------------------------------------------------

function fakeGitOps(overrides: Partial<GitOps> = {}): GitOps {
	return {
		snapshotWorkingTree: () => ({ untracked: new Set() }),
		stageChanges: () => true,
		commitChanges: () => [true, "committed"],
		revertUncommitted: () => {},
		...overrides,
	};
}

// -- Fake session -------------------------------------------------------------

function fakeSession(overrides: Partial<Session> = {}): Session {
	return {
		logger: new FakeLogger(),
		git: fakeGitOps(),
		runner: new FakeRunner(),
		runnerName: "claude",
		...overrides,
	};
}

// -- Fake issue / source for runAfkLoop tests --------------------------------

interface FakeIssue {
	number: number;
	title: string;
	body?: string;
	filename?: string;
}

class FakeSource implements Source<FakeIssue> {
	completed: number[] = [];
	private _issues: FakeIssue[];

	constructor(issues: FakeIssue[] = []) {
		this._issues = [...issues];
	}

	async getNextIssue(): Promise<FakeIssue | null> {
		for (const issue of this._issues) {
			if (!this.completed.includes(issue.number)) {
				return issue;
			}
		}
		return null;
	}

	async getRemainingCount(): Promise<[number, number]> {
		const remaining = this._issues.filter((i) => !this.completed.includes(i.number)).length;
		return [remaining, this._issues.length];
	}

	async completeIssue(issue: FakeIssue): Promise<void> {
		this.completed.push(issue.number);
	}

	async getPrdContent(): Promise<string> {
		return "";
	}
}

// -- verifyAndFix -------------------------------------------------------------

describe("verifyAndFix", () => {
	test("passes on first check", async () => {
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
		const runner = new FakeRunner();
		const git = fakeGitOps();

		const [ok, output] = await commitIssue(runner, "test commit", snapshot, 3, git);

		expect(ok).toBe(true);
		expect(output).toBe("committed");
		expect(runner.calls).toEqual([]);
	});

	test("commit retry on hook failure", async () => {
		const runner = new FakeRunner();
		let commitAttempts = 0;
		const git = fakeGitOps({
			commitChanges: () => {
				commitAttempts++;
				if (commitAttempts <= 1) {
					return [false, "pre-commit hook failed"];
				}
				return [true, "committed"];
			},
		});

		const [ok, output] = await commitIssue(runner, "test commit", snapshot, 3, git);

		expect(ok).toBe(true);
		expect(output).toBe("committed");
		// Runner was called to fix the hook failure
		expect(runner.calls).toHaveLength(1);
		expect(runner.calls[0]).toContain("pre-commit hook failed");
		expect(runner.calls[0]).toContain("The git commit failed with the following output");
	});

	test("commit exhaustion after max retries", async () => {
		const runner = new FakeRunner();
		const git = fakeGitOps({
			commitChanges: () => [false, "hook failed"],
		});

		const [ok, output] = await commitIssue(runner, "test commit", snapshot, 3, git);

		expect(ok).toBe(false);
		expect(output).toBe("hook failed");
		// 3 retries × 1 fix attempt each = 3 runner calls
		expect(runner.calls).toHaveLength(3);
	});

	test("session stops after single retry with maxRetries=1", async () => {
		const runner = new FakeRunner();
		const git = fakeGitOps({
			commitChanges: () => [false, "error"],
		});

		const [ok] = await commitIssue(runner, "msg", snapshot, 1, git);

		expect(ok).toBe(false);
		// Only 1 retry, so 1 runner fix call
		expect(runner.calls).toHaveLength(1);
	});
});

// -- fmtTime ------------------------------------------------------------------

describe("fmtTime", () => {
	test("formats seconds under 60", () => {
		expect(fmtTime(5)).toBe("5s");
		expect(fmtTime(0)).toBe("0s");
		expect(fmtTime(59)).toBe("59s");
	});

	test("formats seconds with rounding", () => {
		expect(fmtTime(2.4)).toBe("2s");
		expect(fmtTime(2.6)).toBe("3s");
	});

	test("formats minutes and seconds", () => {
		expect(fmtTime(60)).toBe("1m 0s");
		expect(fmtTime(90)).toBe("1m 30s");
		expect(fmtTime(155)).toBe("2m 35s");
	});
});

// -- printSummary -------------------------------------------------------------

describe("printSummary", () => {
	test("prints nothing for empty results", () => {
		const logger = new FakeLogger();
		printSummary([], 10, logger);
		expect(logger.messages).toHaveLength(0);
	});

	test("prints per-issue status and totals", () => {
		const logger = new FakeLogger();
		printSummary(
			[
				{
					issueNumber: 1,
					issueFilename: "Task 1",
					success: true,
					elapsedSeconds: 30,
				},
				{
					issueNumber: 2,
					issueFilename: "Task 2",
					success: false,
					elapsedSeconds: 15,
					error: "crash",
				},
			],
			50,
			logger,
		);

		const joined = logger.messages.join("\n");
		expect(joined).toContain("=== Session Summary ===");
		expect(joined).toContain("Issue 1 (Task 1): completed (30s)");
		expect(joined).toContain("Issue 2 (Task 2): failed (15s)");
		expect(joined).toContain("Total: 2 issues — 1 completed, 1 failed");
		expect(joined).toContain("Total time: 50s");
	});
});

// -- runAfkLoop ---------------------------------------------------------------

describe("runAfkLoop", () => {
	test("runner failure does not complete issue", async () => {
		const source = new FakeSource([{ number: 1, title: "Task 1" }]);
		const failRunner: Runner = {
			logEnvironment() {},
			async run() {
				return {
					success: false,
					exitCode: 1,
					durationSeconds: 1.0,
					error: "crash",
				};
			},
		};
		const session = fakeSession({ runner: failRunner });

		const results = await runAfkLoop(
			source,
			1,
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(false);
		expect(source.completed).toEqual([]);
	});

	test("no changes marks failure and calls onNoChanges", async () => {
		const source = new FakeSource([{ number: 1, title: "Task 1" }]);
		const runner = new FakeRunner(true);
		const noChangesCalled: number[] = [];
		const git = fakeGitOps({ stageChanges: () => false });
		const session = fakeSession({ runner, git });

		const results = await runAfkLoop(
			source,
			1,
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
			(issue) => {
				noChangesCalled.push(issue.number);
			},
		);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(false);
		expect(results[0].error).toBe("runner produced no changes");
		expect(source.completed).toEqual([]);
		expect(noChangesCalled).toEqual([1]);
	});

	test("successful commit completes issue", async () => {
		const source = new FakeSource([{ number: 1, title: "Task 1" }]);
		const runner = new FakeRunner(true);
		const git = fakeGitOps();
		const session = fakeSession({ runner, git });

		const results = await runAfkLoop(
			source,
			1,
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(true);
		expect(source.completed).toEqual([1]);
	});

	test("commit failure stops session", async () => {
		const source = new FakeSource([
			{ number: 1, title: "Task 1" },
			{ number: 2, title: "Task 2" },
		]);
		const runner = new FakeRunner(true);
		const git = fakeGitOps({ commitChanges: () => [false, "hook failed"] });
		const session = fakeSession({ runner, git });

		const results = await runAfkLoop(
			source,
			"all",
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		// Only one result — session stopped
		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(false);
		expect(results[0].error).toBe("commit failed after retries");
		expect(source.completed).toEqual([]);
	});

	test("commit retry succeeds", async () => {
		const source = new FakeSource([{ number: 1, title: "Task 1" }]);
		const runner = new FakeRunner(true);
		let commitAttempts = 0;
		const git = fakeGitOps({
			commitChanges: () => {
				commitAttempts++;
				if (commitAttempts <= 1) {
					return [false, "pre-commit hook failed"];
				}
				return [true, "committed"];
			},
		});
		const session = fakeSession({ runner, git });

		const results = await runAfkLoop(
			source,
			1,
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(true);
		expect(source.completed).toEqual([1]);
	});

	test("runner name printed in session header", async () => {
		const source = new FakeSource([]);
		const git = fakeGitOps();
		const logger = new FakeLogger();
		const session = fakeSession({ git, runnerName: "codex", logger });

		await runAfkLoop(
			source,
			"all",
			() => "",
			() => "",
			() => "",
			session,
		);

		expect(logger.messages.join("\n")).toContain("runner: codex");
	});

	test("all issues complete message when no issues", async () => {
		const source = new FakeSource([]);
		const git = fakeGitOps();
		const logger = new FakeLogger();
		const session = fakeSession({ git, logger });

		await runAfkLoop(
			source,
			"all",
			() => "",
			() => "",
			() => "",
			session,
		);

		expect(logger.messages.join("\n")).toContain("All issues complete!");
	});

	// -- Bug #75: retry-stop behavior -----------------------------------------

	test("repeated failure on same issue stops session with --iterations all", async () => {
		const source = new FakeSource([
			{ number: 1, title: "Task 1" },
			{ number: 2, title: "Task 2" },
		]);
		const failRunner: Runner = {
			logEnvironment() {},
			async run() {
				return {
					success: false,
					exitCode: 1,
					durationSeconds: 1.0,
					error: "crash",
				};
			},
		};
		const logger = new FakeLogger();
		const session = fakeSession({ runner: failRunner, logger });

		const results = await runAfkLoop(
			source,
			"all",
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		// Two results: attempt 1 and attempt 2 on issue 1, then stop
		expect(results).toHaveLength(2);
		expect(results[0].issueNumber).toBe(1);
		expect(results[1].issueNumber).toBe(1);
		expect(results.every((r) => !r.success)).toBe(true);
		expect(source.completed).toEqual([]);
		expect(logger.messages.join("\n")).toContain("failed twice consecutively");
	});

	test("failure then success on retry resets tracker and continues", async () => {
		const source = new FakeSource([
			{ number: 1, title: "Task 1" },
			{ number: 2, title: "Task 2" },
		]);
		let callCount = 0;
		const runner: Runner = {
			logEnvironment() {},
			async run() {
				callCount++;
				// First call fails (issue 1 attempt 1), rest succeed
				return {
					success: callCount > 1,
					exitCode: callCount > 1 ? 0 : 1,
					durationSeconds: 0.1,
					error: callCount <= 1 ? "crash" : undefined,
				};
			},
		};
		const session = fakeSession({ runner });

		const results = await runAfkLoop(
			source,
			"all",
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		// Issue 1 failed once, then succeeded on retry, then issue 2 succeeded
		expect(results).toHaveLength(3);
		expect(results[0]).toMatchObject({ issueNumber: 1, success: false });
		expect(results[1]).toMatchObject({ issueNumber: 1, success: true });
		expect(results[2]).toMatchObject({ issueNumber: 2, success: true });
		expect(source.completed).toEqual([1, 2]);
	});

	test("with -i N, failures consume iterations normally", async () => {
		const source = new FakeSource([
			{ number: 1, title: "Task 1" },
			{ number: 2, title: "Task 2" },
		]);
		const failRunner: Runner = {
			logEnvironment() {},
			async run() {
				return {
					success: false,
					exitCode: 1,
					durationSeconds: 0.1,
					error: "crash",
				};
			},
		};
		const session = fakeSession({ runner: failRunner });

		const results = await runAfkLoop(
			source,
			2,
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		// 2 iterations consumed: attempt 1 and attempt 2 on issue 1
		expect(results).toHaveLength(2);
		expect(results[0].issueNumber).toBe(1);
		expect(results[1].issueNumber).toBe(1);
		expect(source.completed).toEqual([]);
	});

	test("no-changes repeated failure stops session", async () => {
		const source = new FakeSource([
			{ number: 1, title: "Task 1" },
			{ number: 2, title: "Task 2" },
		]);
		const runner = new FakeRunner(true);
		const git = fakeGitOps({ stageChanges: () => false });
		const logger = new FakeLogger();
		const session = fakeSession({ runner, git, logger });

		const results = await runAfkLoop(
			source,
			"all",
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({ issueNumber: 1, success: false });
		expect(results[1]).toMatchObject({ issueNumber: 1, success: false });
		expect(logger.messages.join("\n")).toContain("failed twice consecutively");
	});

	// -- Logging tests --------------------------------------------------------

	test("logs retry indicator on second attempt", async () => {
		const source = new FakeSource([{ number: 1, title: "Task 1" }]);
		let callCount = 0;
		const runner: Runner = {
			logEnvironment() {},
			async run() {
				callCount++;
				return {
					success: callCount > 1,
					exitCode: callCount > 1 ? 0 : 1,
					durationSeconds: 0.1,
					error: callCount <= 1 ? "crash" : undefined,
				};
			},
		};
		const logger = new FakeLogger();
		const session = fakeSession({ runner, logger });

		await runAfkLoop(
			source,
			"all",
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		expect(logger.messages.join("\n")).toContain("Retrying issue 1 (attempt 2 of 2)");
	});

	test("logs runner start, staging, and committing", async () => {
		const source = new FakeSource([{ number: 1, title: "Task 1" }]);
		const runner = new FakeRunner(true);
		const logger = new FakeLogger();
		const session = fakeSession({ runner, logger });

		await runAfkLoop(
			source,
			1,
			() => "prompt",
			(i) => i.title,
			(i) => `#${i.number}: ${i.title}`,
			session,
		);

		const joined = logger.messages.join("\n");
		expect(joined).toContain("Running claude...");
		expect(joined).toContain("Staging changes...");
		expect(joined).toContain("Committing...");
		expect(joined).toContain("committed and completed");
	});
});
