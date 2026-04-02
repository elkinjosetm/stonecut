/**
 * Tests for CLI command setup, flag parsing, validation, stonecut report,
 * execution paths, and pre-execution prompts.
 */

import { describe, expect, mock, spyOn, test } from "bun:test";
import {
	buildReport,
	buildProgram,
	parseIterations,
	preExecution,
	promptForSource,
	pushAndMaybePr,
	validateRunSource,
} from "../src/cli";
import type { IterationResult, LogWriter } from "../src/types";

// ---------------------------------------------------------------------------
// parseIterations
// ---------------------------------------------------------------------------

describe("parseIterations", () => {
	test("valid positive integer", () => {
		expect(parseIterations("3")).toBe(3);
	});

	test("valid integer 1", () => {
		expect(parseIterations("1")).toBe(1);
	});

	test("'all' returns string", () => {
		expect(parseIterations("all")).toBe("all");
	});

	test("zero throws", () => {
		expect(() => parseIterations("0")).toThrow("Must be a positive integer or 'all'");
	});

	test("negative throws", () => {
		expect(() => parseIterations("-1")).toThrow("Must be a positive integer or 'all'");
	});

	test("non-numeric throws", () => {
		expect(() => parseIterations("abc")).toThrow("Must be a positive integer or 'all'");
	});

	test("float throws", () => {
		expect(() => parseIterations("2.5")).toThrow("Must be a positive integer or 'all'");
	});
});

// ---------------------------------------------------------------------------
// validateRunSource
// ---------------------------------------------------------------------------

describe("validateRunSource", () => {
	test("local only returns local kind", () => {
		const result = validateRunSource("my-prd", undefined);
		expect(result).toEqual({ kind: "local", name: "my-prd" });
	});

	test("github only returns github kind", () => {
		const result = validateRunSource(undefined, 42);
		expect(result).toEqual({ kind: "github", number: 42 });
	});

	test("neither returns prompt signal", () => {
		const result = validateRunSource(undefined, undefined);
		expect(result).toEqual({ kind: "prompt" });
	});

	test("both throws", () => {
		expect(() => validateRunSource("my-prd", 42)).toThrow(
			"Use exactly one of --local or --github.",
		);
	});
});

// ---------------------------------------------------------------------------
// version flag
// ---------------------------------------------------------------------------

describe("--version flag", () => {
	test("outputs version string", async () => {
		const program = buildProgram();
		program.exitOverride();

		let output = "";
		program.configureOutput({ writeOut: (str) => (output = str) });

		try {
			await program.parseAsync(["node", "stonecut", "--version"]);
		} catch {
			// Commander throws on exit after --version
		}

		expect(output).toMatch(/^stonecut \d+\.\d+\.\d+/);
	});
});

// ---------------------------------------------------------------------------
// run command routing
// ---------------------------------------------------------------------------

describe("run command routing", () => {
	test("--local routes to runLocal", async () => {
		const localSpy = spyOn(await import("../src/cli"), "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();
		// Patch the run action to use the spy
		const runCmd = program.commands.find((c) => c.name() === "run")!;
		runCmd.action(async (opts) => {
			const source = validateRunSource(opts.local, opts.github);
			const iterations = parseIterations(opts.iterations);
			if (source.kind === "local") {
				await localSpy(source.name, iterations, opts.runner ?? "claude");
			}
		});

		await program.parseAsync(["node", "stonecut", "run", "--local", "my-spec", "-i", "3"]);

		expect(localSpy).toHaveBeenCalledWith("my-spec", 3, "claude");
		localSpy.mockRestore();
	});

	test("--github routes to runGitHub", async () => {
		const githubSpy = spyOn(await import("../src/cli"), "runGitHub").mockResolvedValue(undefined);

		const program = buildProgram();
		const runCmd = program.commands.find((c) => c.name() === "run")!;
		runCmd.action(async (opts) => {
			const source = validateRunSource(opts.local, opts.github);
			const iterations = parseIterations(opts.iterations);
			if (source.kind === "github") {
				await githubSpy(source.number, iterations, opts.runner ?? "claude");
			}
		});

		await program.parseAsync(["node", "stonecut", "run", "--github", "42", "-i", "all"]);

		expect(githubSpy).toHaveBeenCalledWith(42, "all", "claude");
		githubSpy.mockRestore();
	});

	test("runner defaults to claude when no flag and no config", async () => {
		const localSpy = spyOn(await import("../src/cli"), "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();
		const runCmd = program.commands.find((c) => c.name() === "run")!;
		runCmd.action(async (opts) => {
			const source = validateRunSource(opts.local, opts.github);
			const iterations = parseIterations(opts.iterations);
			if (source.kind === "local") {
				await localSpy(source.name, iterations, opts.runner ?? "claude");
			}
		});

		await program.parseAsync(["node", "stonecut", "run", "--local", "spec", "-i", "1"]);

		expect(localSpy).toHaveBeenCalledWith("spec", 1, "claude");
		localSpy.mockRestore();
	});

	test("custom runner flag is passed through", async () => {
		const localSpy = spyOn(await import("../src/cli"), "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();
		const runCmd = program.commands.find((c) => c.name() === "run")!;
		runCmd.action(async (opts) => {
			const source = validateRunSource(opts.local, opts.github);
			const iterations = parseIterations(opts.iterations);
			if (source.kind === "local") {
				await localSpy(source.name, iterations, opts.runner ?? "claude");
			}
		});

		await program.parseAsync([
			"node",
			"stonecut",
			"run",
			"--local",
			"spec",
			"-i",
			"2",
			"--runner",
			"codex",
		]);

		expect(localSpy).toHaveBeenCalledWith("spec", 2, "codex");
		localSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// run command validation
// ---------------------------------------------------------------------------

describe("run command validation", () => {
	test("both --local and --github throws", async () => {
		const program = buildProgram();
		program.exitOverride();
		program.configureOutput({ writeErr: () => {} });

		let caught: Error | undefined;
		try {
			await program.parseAsync([
				"node",
				"stonecut",
				"run",
				"--local",
				"spec",
				"--github",
				"42",
				"-i",
				"1",
			]);
		} catch (err) {
			caught = err as Error;
		}

		expect(caught).toBeDefined();
		expect(caught!.message).toContain("Use exactly one of --local or --github.");
	});
});

// ---------------------------------------------------------------------------
// promptForSource
// ---------------------------------------------------------------------------

describe("promptForSource", () => {
	test("choosing local prompts for spec name and returns local source", async () => {
		const clack = await import("@clack/prompts");

		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		const textMock = spyOn(clack, "text").mockResolvedValue("my-spec" as never);

		const result = await promptForSource();

		expect(selectMock).toHaveBeenCalled();
		expect(textMock).toHaveBeenCalled();
		expect(result).toEqual({ kind: "local", name: "my-spec" });

		selectMock.mockRestore();
		textMock.mockRestore();
	});

	test("choosing github prompts for issue number and returns github source", async () => {
		const clack = await import("@clack/prompts");

		const selectMock = spyOn(clack, "select").mockResolvedValue("github" as never);
		const textMock = spyOn(clack, "text").mockResolvedValue("42" as never);

		const result = await promptForSource();

		expect(selectMock).toHaveBeenCalled();
		expect(textMock).toHaveBeenCalled();
		expect(result).toEqual({ kind: "github", number: 42 });

		selectMock.mockRestore();
		textMock.mockRestore();
	});

	test("cancelling source type throws", async () => {
		const clack = await import("@clack/prompts");

		const cancelSymbol = Symbol("cancel");
		const selectMock = spyOn(clack, "select").mockResolvedValue(cancelSymbol as never);
		const isCancelMock = spyOn(clack, "isCancel").mockReturnValue(true);

		await expect(promptForSource()).rejects.toThrow("Cancelled.");

		selectMock.mockRestore();
		isCancelMock.mockRestore();
	});

	test("cancelling spec name throws", async () => {
		const clack = await import("@clack/prompts");

		const cancelSymbol = Symbol("cancel");
		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		const isCancelSpy = spyOn(clack, "isCancel");
		isCancelSpy.mockReturnValueOnce(false); // select not cancelled
		const textMock = spyOn(clack, "text").mockResolvedValue(cancelSymbol as never);
		isCancelSpy.mockReturnValueOnce(true); // text cancelled

		await expect(promptForSource()).rejects.toThrow("Cancelled.");

		selectMock.mockRestore();
		textMock.mockRestore();
		isCancelSpy.mockRestore();
	});

	test("cancelling issue number throws", async () => {
		const clack = await import("@clack/prompts");

		const cancelSymbol = Symbol("cancel");
		const selectMock = spyOn(clack, "select").mockResolvedValue("github" as never);
		const isCancelSpy = spyOn(clack, "isCancel");
		isCancelSpy.mockReturnValueOnce(false); // select not cancelled
		const textMock = spyOn(clack, "text").mockResolvedValue(cancelSymbol as never);
		isCancelSpy.mockReturnValueOnce(true); // text cancelled

		await expect(promptForSource()).rejects.toThrow("Cancelled.");

		selectMock.mockRestore();
		textMock.mockRestore();
		isCancelSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// run command source prompting integration
// ---------------------------------------------------------------------------

describe("run command source prompting", () => {
	test("no source flag prompts and routes to runLocal", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");

		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		const textMock = spyOn(clack, "text").mockResolvedValue("my-spec" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "-i", "3"]);

		expect(selectMock).toHaveBeenCalled();
		// Wizard mode: prefilled branch/base are passed as 4th arg
		expect(localSpy).toHaveBeenCalledWith("my-spec", 3, "claude", {
			branch: "my-spec",
			baseBranch: "my-spec",
		});

		selectMock.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("no source flag prompts and routes to runGitHub", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");

		const selectMock = spyOn(clack, "select").mockResolvedValue("github" as never);
		const textMock = spyOn(clack, "text").mockResolvedValue("42" as never);
		const githubSpy = spyOn(cliMod, "runGitHub").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "-i", "all"]);

		expect(selectMock).toHaveBeenCalled();
		// Wizard mode: prefilled branch/base are passed as 4th arg
		expect(githubSpy).toHaveBeenCalledWith(42, "all", "claude", {
			branch: "42",
			baseBranch: "42",
		});

		selectMock.mockRestore();
		textMock.mockRestore();
		githubSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("--local provided skips source prompt", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");

		const selectMock = spyOn(clack, "select");
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "foo", "-i", "5"]);

		expect(selectMock).not.toHaveBeenCalled();
		// All flags provided: no wizard, prefilled is undefined
		expect(localSpy).toHaveBeenCalledWith("foo", 5, "claude", undefined);

		selectMock.mockRestore();
		localSpy.mockRestore();
	});

	test("--github provided skips source prompt", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");

		const selectMock = spyOn(clack, "select");
		const githubSpy = spyOn(cliMod, "runGitHub").mockResolvedValue(undefined);

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--github", "42", "-i", "all"]);

		expect(selectMock).not.toHaveBeenCalled();
		// All flags provided: no wizard, prefilled is undefined
		expect(githubSpy).toHaveBeenCalledWith(42, "all", "claude", undefined);

		selectMock.mockRestore();
		githubSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// run command iterations prompting
// ---------------------------------------------------------------------------

describe("run command iterations prompting", () => {
	test("no -i flag prompts for iterations with default 'all'", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");

		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		// First text call: source name, second: iterations, third: branch, fourth: baseBranch
		const textMock = spyOn(clack, "text").mockResolvedValue("all" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run"]);

		// text should have been called for: source name + iterations + branch + baseBranch
		const iterationsCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Iterations:",
		);
		expect(iterationsCall).toBeDefined();
		expect((iterationsCall![0] as { defaultValue: string }).defaultValue).toBe("all");
		expect(localSpy).toHaveBeenCalled();

		selectMock.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("--local without -i prompts for iterations", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");

		// Wizard mode: iterations + branch + baseBranch prompts fire
		const textMock = spyOn(clack, "text").mockResolvedValue("5" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "foo"]);

		const iterationsCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Iterations:",
		);
		expect(iterationsCall).toBeDefined();
		// Wizard mode: prefilled is passed (text mock returns "5" for all calls)
		expect(localSpy).toHaveBeenCalledWith("foo", 5, "claude", {
			branch: "5",
			baseBranch: "5",
		});

		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("--local with -i 5 skips iterations prompt", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");

		const textMock = spyOn(clack, "text");
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "foo", "-i", "5"]);

		// All flags provided: no wizard, no prompts in action handler
		const iterationsCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Iterations:",
		);
		expect(iterationsCall).toBeUndefined();
		expect(localSpy).toHaveBeenCalledWith("foo", 5, "claude", undefined);

		textMock.mockRestore();
		localSpy.mockRestore();
	});

	test("--local with -i all skips iterations prompt", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");

		const textMock = spyOn(clack, "text");
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "foo", "-i", "all"]);

		// All flags provided: no wizard, no prompts in action handler
		const iterationsCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Iterations:",
		);
		expect(iterationsCall).toBeUndefined();
		expect(localSpy).toHaveBeenCalledWith("foo", "all", "claude", undefined);

		textMock.mockRestore();
		localSpy.mockRestore();
	});

	test("cancelling iterations prompt throws", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");

		const cancelSymbol = Symbol("cancel");
		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		const isCancelSpy = spyOn(clack, "isCancel");
		isCancelSpy.mockReturnValueOnce(false); // select not cancelled
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("my-spec" as never) // source name
			.mockResolvedValueOnce(cancelSymbol as never); // iterations cancelled
		isCancelSpy.mockReturnValueOnce(false); // source text not cancelled
		isCancelSpy.mockReturnValueOnce(true); // iterations cancelled

		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();

		let caught: Error | undefined;
		try {
			await program.parseAsync(["node", "stonecut", "run"]);
		} catch (err) {
			caught = err as Error;
		}

		expect(caught).toBeDefined();
		expect(caught!.message).toContain("Cancelled.");

		selectMock.mockRestore();
		textMock.mockRestore();
		isCancelSpy.mockRestore();
		localSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

describe("buildReport", () => {
	test("includes runner name", () => {
		const report = buildReport([], "claude");
		expect(report).toContain("**Runner:** claude");
	});

	test("success format", () => {
		const results: IterationResult[] = [
			{
				issueNumber: 1,
				issueFilename: "setup.md",
				success: true,
				elapsedSeconds: 30,
			},
		];
		const report = buildReport(results, "claude");
		expect(report).toContain("- #1 setup.md: completed");
	});

	test("failure format with error detail", () => {
		const results: IterationResult[] = [
			{
				issueNumber: 2,
				issueFilename: "api.md",
				success: false,
				elapsedSeconds: 10,
				error: "max turns exceeded",
			},
		];
		const report = buildReport(results, "codex");
		expect(report).toContain("- #2 api.md: failed — max turns exceeded");
	});

	test("failure with no error uses 'unknown error'", () => {
		const results: IterationResult[] = [
			{
				issueNumber: 3,
				issueFilename: "db.md",
				success: false,
				elapsedSeconds: 5,
			},
		];
		const report = buildReport(results, "claude");
		expect(report).toContain("- #3 db.md: failed — unknown error");
	});

	test("multiple results", () => {
		const results: IterationResult[] = [
			{
				issueNumber: 1,
				issueFilename: "setup.md",
				success: true,
				elapsedSeconds: 30,
			},
			{
				issueNumber: 2,
				issueFilename: "api.md",
				success: false,
				elapsedSeconds: 10,
				error: "timeout",
			},
		];
		const report = buildReport(results, "claude");
		expect(report).toContain("- #1 setup.md: completed");
		expect(report).toContain("- #2 api.md: failed — timeout");
	});

	test("includes 'Closes #N' for GitHub PRD number", () => {
		const results: IterationResult[] = [
			{
				issueNumber: 5,
				issueFilename: "feat.md",
				success: true,
				elapsedSeconds: 60,
			},
		];
		const report = buildReport(results, "claude", 42);
		expect(report).toContain("Closes #42");
	});

	test("omits 'Closes #N' when no PRD number", () => {
		const results: IterationResult[] = [
			{
				issueNumber: 5,
				issueFilename: "feat.md",
				success: true,
				elapsedSeconds: 60,
			},
		];
		const report = buildReport(results, "claude");
		expect(report).not.toContain("Closes");
	});

	test("starts with ## Stonecut Report header", () => {
		const report = buildReport([], "claude");
		expect(report).toMatch(/^## Stonecut Report/);
	});
});

// ---------------------------------------------------------------------------
// Branch slug and PR title naming
// ---------------------------------------------------------------------------

describe("branch and PR title naming", () => {
	test("local branch uses stonecut/<slug> pattern", async () => {
		// Test the slug generation used in runLocal
		const { slugifyBranchComponent } = await import("../src/naming");
		const slug = slugifyBranchComponent("My Cool Spec");
		expect(`stonecut/${slug}`).toBe("stonecut/my-cool-spec");
	});

	test("local branch fallback when slug is empty", async () => {
		const { slugifyBranchComponent } = await import("../src/naming");
		const slug = slugifyBranchComponent("---");
		const branch = slug ? `stonecut/${slug}` : "stonecut/spec";
		expect(branch).toBe("stonecut/spec");
	});

	test("github branch uses stonecut/<prd-slug> pattern", async () => {
		const { slugifyBranchComponent } = await import("../src/naming");
		const slug = slugifyBranchComponent("Rewrite CLI to TypeScript");
		expect(`stonecut/${slug}`).toBe("stonecut/rewrite-cli-to-typescript");
	});

	test("github branch fallback when slug is empty", async () => {
		const { slugifyBranchComponent } = await import("../src/naming");
		const slug = slugifyBranchComponent("");
		const branch = slug ? `stonecut/${slug}` : "stonecut/issue-99";
		expect(branch).toBe("stonecut/issue-99");
	});

	test("local PR title is 'Stonecut: <name>'", () => {
		const name = "my-spec";
		expect(`Stonecut: ${name}`).toBe("Stonecut: my-spec");
	});

	test("github PR title uses PRD title", () => {
		const prdTitle = "Rewrite CLI";
		const prTitle = prdTitle || "PRD #99";
		expect(prTitle).toBe("Rewrite CLI");
	});

	test("github PR title fallback when title is empty", () => {
		const prdTitle = "";
		const prTitle = prdTitle || "PRD #99";
		expect(prTitle).toBe("PRD #99");
	});
});

// ---------------------------------------------------------------------------
// pushAndMaybePr (Bug #104: PR gating)
// ---------------------------------------------------------------------------

describe("pushAndMaybePr", () => {
	class FakeLogger implements LogWriter {
		messages: string[] = [];
		log(message: string): void {
			this.messages.push(message);
		}
		close(): void {}
	}

	function fakeSource(remaining: number, total: number) {
		return {
			async getRemainingCount(): Promise<[number, number]> {
				return [remaining, total];
			},
		};
	}

	test("does nothing when no results succeeded", async () => {
		const gitMod = await import("../src/git");
		const pushSpy = spyOn(gitMod, "pushBranch").mockImplementation(() => {});
		const prSpy = spyOn(gitMod, "createPr").mockImplementation(() => {});
		const logger = new FakeLogger();

		const results: IterationResult[] = [
			{
				issueNumber: 1,
				issueFilename: "task.md",
				success: false,
				elapsedSeconds: 10,
				error: "crash",
			},
		];

		await pushAndMaybePr(
			results,
			fakeSource(1, 1),
			"stonecut/test",
			"main",
			"Test",
			"claude",
			logger,
		);

		expect(pushSpy).not.toHaveBeenCalled();
		expect(prSpy).not.toHaveBeenCalled();

		pushSpy.mockRestore();
		prSpy.mockRestore();
	});

	test("pushes branch but defers PR when issues remain", async () => {
		const gitMod = await import("../src/git");
		const pushSpy = spyOn(gitMod, "pushBranch").mockImplementation(() => {});
		const prSpy = spyOn(gitMod, "createPr").mockImplementation(() => {});
		const logger = new FakeLogger();

		const results: IterationResult[] = [
			{ issueNumber: 1, issueFilename: "task.md", success: true, elapsedSeconds: 30 },
		];

		await pushAndMaybePr(
			results,
			fakeSource(5, 10),
			"stonecut/test",
			"main",
			"Test",
			"claude",
			logger,
		);

		expect(pushSpy).toHaveBeenCalledWith("stonecut/test");
		expect(prSpy).not.toHaveBeenCalled();
		expect(logger.messages.join("\n")).toContain("5/10 issues remaining — PR deferred.");

		pushSpy.mockRestore();
		prSpy.mockRestore();
	});

	test("pushes and creates PR when all issues complete", async () => {
		const gitMod = await import("../src/git");
		const pushSpy = spyOn(gitMod, "pushBranch").mockImplementation(() => {});
		const prSpy = spyOn(gitMod, "createPr").mockImplementation(() => {});
		const logger = new FakeLogger();

		const results: IterationResult[] = [
			{ issueNumber: 1, issueFilename: "task.md", success: true, elapsedSeconds: 30 },
		];

		await pushAndMaybePr(
			results,
			fakeSource(0, 1),
			"stonecut/test",
			"main",
			"Test",
			"claude",
			logger,
		);

		expect(pushSpy).toHaveBeenCalledWith("stonecut/test");
		expect(prSpy).toHaveBeenCalled();
		expect(logger.messages.join("\n")).toContain("Created PR.");

		pushSpy.mockRestore();
		prSpy.mockRestore();
	});

	test("includes Closes #N in PR body for GitHub PRD", async () => {
		const gitMod = await import("../src/git");
		const pushSpy = spyOn(gitMod, "pushBranch").mockImplementation(() => {});
		let capturedBody = "";
		const prSpy = spyOn(gitMod, "createPr").mockImplementation((_title, body) => {
			capturedBody = body;
		});
		const logger = new FakeLogger();

		const results: IterationResult[] = [
			{ issueNumber: 5, issueFilename: "feat.md", success: true, elapsedSeconds: 60 },
		];

		await pushAndMaybePr(
			results,
			fakeSource(0, 1),
			"stonecut/test",
			"main",
			"Test",
			"claude",
			logger,
			42,
		);

		expect(capturedBody).toContain("Closes #42");

		pushSpy.mockRestore();
		prSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// preExecution prompt mocking
// ---------------------------------------------------------------------------

describe("preExecution", () => {
	test("returns branch and base branch from prompts", async () => {
		const clack = await import("@clack/prompts");
		const gitMod = await import("../src/git");

		const textMock = mock()
			.mockResolvedValueOnce("stonecut/my-branch")
			.mockResolvedValueOnce("main");

		spyOn(clack, "text").mockImplementation(textMock);
		spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});
		spyOn(gitMod, "defaultBranch").mockReturnValue("main");
		spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
		spyOn(console, "log").mockImplementation(() => {});

		const [branch, baseBranch] = await preExecution("stonecut/suggested");

		expect(branch).toBe("stonecut/my-branch");
		expect(baseBranch).toBe("main");

		(clack.text as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.defaultBranch as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
		(console.log as ReturnType<typeof mock>).mockRestore?.();
	});

	test("throws when branch prompt is cancelled", async () => {
		const clack = await import("@clack/prompts");
		const gitMod = await import("../src/git");

		const cancelSymbol = Symbol("cancel");
		spyOn(clack, "text").mockResolvedValue(cancelSymbol as never);
		spyOn(clack, "isCancel").mockReturnValue(true);
		spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});

		await expect(preExecution("stonecut/test")).rejects.toThrow("Cancelled.");

		(clack.text as unknown as ReturnType<typeof mock>).mockRestore?.();
		(clack.isCancel as unknown as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.ensureCleanTree as unknown as ReturnType<typeof mock>).mockRestore?.();
	});

	test("calls ensureCleanTree before prompts", async () => {
		const clack = await import("@clack/prompts");
		const gitMod = await import("../src/git");

		const callOrder: string[] = [];
		spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {
			callOrder.push("ensureCleanTree");
		});
		const textMock = mock().mockImplementation(async () => {
			callOrder.push("text");
			return "value";
		});
		spyOn(clack, "text").mockImplementation(textMock);
		spyOn(gitMod, "defaultBranch").mockReturnValue("main");
		spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
		spyOn(console, "log").mockImplementation(() => {});

		await preExecution("stonecut/test");

		expect(callOrder[0]).toBe("ensureCleanTree");
		expect(callOrder[1]).toBe("text");

		(gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
		(clack.text as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.defaultBranch as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
		(console.log as ReturnType<typeof mock>).mockRestore?.();
	});

	test("calls checkoutOrCreateBranch with selected branch", async () => {
		const clack = await import("@clack/prompts");
		const gitMod = await import("../src/git");

		const textMock = mock()
			.mockResolvedValueOnce("stonecut/custom")
			.mockResolvedValueOnce("develop");

		spyOn(clack, "text").mockImplementation(textMock);
		spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});
		spyOn(gitMod, "defaultBranch").mockReturnValue("main");
		const checkoutSpy = spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
		spyOn(console, "log").mockImplementation(() => {});

		await preExecution("stonecut/suggested");

		expect(checkoutSpy).toHaveBeenCalledWith("stonecut/custom");

		(clack.text as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.defaultBranch as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
		(console.log as ReturnType<typeof mock>).mockRestore?.();
	});

	test("skips branch prompt when prefilled branch is provided", async () => {
		const clack = await import("@clack/prompts");
		const gitMod = await import("../src/git");

		const textMock = mock().mockResolvedValueOnce("main");
		spyOn(clack, "text").mockImplementation(textMock);
		spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});
		spyOn(gitMod, "defaultBranch").mockReturnValue("main");
		const checkoutSpy = spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
		spyOn(console, "log").mockImplementation(() => {});

		const [branch, baseBranch] = await preExecution("stonecut/suggested", {
			branch: "stonecut/prefilled",
		});

		expect(branch).toBe("stonecut/prefilled");
		expect(baseBranch).toBe("main");
		// Only one text call (baseBranch), branch prompt was skipped
		expect(textMock).toHaveBeenCalledTimes(1);
		expect((textMock.mock.calls[0][0] as { message: string }).message).toBe(
			"Base branch / PR target:",
		);
		expect(checkoutSpy).toHaveBeenCalledWith("stonecut/prefilled");

		(clack.text as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.defaultBranch as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
		(console.log as ReturnType<typeof mock>).mockRestore?.();
	});

	test("skips baseBranch prompt when prefilled baseBranch is provided", async () => {
		const clack = await import("@clack/prompts");
		const gitMod = await import("../src/git");

		const textMock = mock().mockResolvedValueOnce("stonecut/my-branch");
		spyOn(clack, "text").mockImplementation(textMock);
		spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});
		const checkoutSpy = spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
		spyOn(console, "log").mockImplementation(() => {});

		const [branch, baseBranch] = await preExecution("stonecut/suggested", {
			baseBranch: "develop",
		});

		expect(branch).toBe("stonecut/my-branch");
		expect(baseBranch).toBe("develop");
		// Only one text call (branch), baseBranch prompt was skipped
		expect(textMock).toHaveBeenCalledTimes(1);
		expect((textMock.mock.calls[0][0] as { message: string }).message).toBe("Branch name:");
		expect(checkoutSpy).toHaveBeenCalledWith("stonecut/my-branch");

		(clack.text as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
		(console.log as ReturnType<typeof mock>).mockRestore?.();
	});

	test("skips both prompts when both prefilled values are provided", async () => {
		const clack = await import("@clack/prompts");
		const gitMod = await import("../src/git");

		const textMock = mock();
		spyOn(clack, "text").mockImplementation(textMock);
		spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});
		const checkoutSpy = spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
		spyOn(console, "log").mockImplementation(() => {});

		const [branch, baseBranch] = await preExecution("stonecut/suggested", {
			branch: "stonecut/prefilled",
			baseBranch: "develop",
		});

		expect(branch).toBe("stonecut/prefilled");
		expect(baseBranch).toBe("develop");
		// No text calls at all
		expect(textMock).not.toHaveBeenCalled();
		expect(checkoutSpy).toHaveBeenCalledWith("stonecut/prefilled");

		(clack.text as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
		(gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
		(console.log as ReturnType<typeof mock>).mockRestore?.();
	});
});

// ---------------------------------------------------------------------------
// Wizard flow: branch/base prompting
// ---------------------------------------------------------------------------

describe("wizard flow branch/base prompting", () => {
	test("wizard mode prompts for branch and baseBranch in action handler", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");

		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		// Calls: source name, iterations, branch, baseBranch
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("my-spec" as never)
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run"]);

		// Should have branch and baseBranch prompts
		const branchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Branch name:",
		);
		const baseBranchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Base branch / PR target:",
		);
		expect(branchCall).toBeDefined();
		expect(baseBranchCall).toBeDefined();

		// prefilled should be passed to runLocal
		expect(localSpy).toHaveBeenCalledWith("my-spec", "all", "claude", {
			branch: "stonecut/my-spec",
			baseBranch: "main",
		});

		selectMock.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("all flags provided skips branch/base prompts in action handler", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");

		const textMock = spyOn(clack, "text");
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "foo", "-i", "3"]);

		// No branch/base prompts in action handler
		const branchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Branch name:",
		);
		const baseBranchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Base branch / PR target:",
		);
		expect(branchCall).toBeUndefined();
		expect(baseBranchCall).toBeUndefined();

		// prefilled is undefined
		expect(localSpy).toHaveBeenCalledWith("foo", 3, "claude", undefined);

		textMock.mockRestore();
		localSpy.mockRestore();
	});

	test("wizard branch prompt uses correct default for local source", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");

		// Calls: iterations, branch, baseBranch (source is provided via --local)
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-cool-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "my-cool-spec"]);

		const branchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Branch name:",
		);
		expect(branchCall).toBeDefined();
		expect((branchCall![0] as { defaultValue: string }).defaultValue).toBe("stonecut/my-cool-spec");

		const baseBranchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Base branch / PR target:",
		);
		expect(baseBranchCall).toBeDefined();
		expect((baseBranchCall![0] as { defaultValue: string }).defaultValue).toBe("main");

		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("wizard branch prompt uses correct default for github source", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");

		const selectMock = spyOn(clack, "select").mockResolvedValue("github" as never);
		const textMock = spyOn(clack, "text").mockResolvedValue("42" as never);
		const githubSpy = spyOn(cliMod, "runGitHub").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "-i", "all"]);

		const branchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Branch name:",
		);
		expect(branchCall).toBeDefined();
		expect((branchCall![0] as { defaultValue: string }).defaultValue).toBe("stonecut/issue-42");

		selectMock.mockRestore();
		textMock.mockRestore();
		githubSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Bare stonecut (no subcommand) routes to run
// ---------------------------------------------------------------------------

describe("bare stonecut entry point", () => {
	test("no subcommand routes to run wizard", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");

		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		// Calls: source name, iterations, branch, baseBranch
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("my-spec" as never)
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		// No subcommand — bare "stonecut"
		await program.parseAsync(["node", "stonecut"]);

		expect(selectMock).toHaveBeenCalled();
		expect(localSpy).toHaveBeenCalled();

		selectMock.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("--help still shows all commands", async () => {
		const program = buildProgram();
		program.exitOverride();

		let output = "";
		program.configureOutput({ writeOut: (str) => (output = str) });

		try {
			await program.parseAsync(["node", "stonecut", "--help"]);
		} catch {
			// Commander throws on exit after --help
		}

		expect(output).toContain("run");
		expect(output).toContain("init");
		expect(output).toContain("setup-skills");
		expect(output).toContain("remove-skills");
	});
});

// ---------------------------------------------------------------------------
// Wizard config defaults integration
// ---------------------------------------------------------------------------

describe("wizard config defaults", () => {
	test("uses branchPrefix from config for local source", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");
		const configMod = await import("../src/config");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue({
			branchPrefix: "feat/stonecut/",
		});
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("feat/stonecut/my-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "my-spec"]);

		const branchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Branch name:",
		);
		expect(branchCall).toBeDefined();
		expect((branchCall![0] as { defaultValue: string }).defaultValue).toBe("feat/stonecut/my-spec");

		configSpy.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("uses branchPrefix from config for github source", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");
		const configMod = await import("../src/config");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue({
			branchPrefix: "feat/stonecut/",
		});
		const selectMock = spyOn(clack, "select").mockResolvedValue("github" as never);
		const textMock = spyOn(clack, "text").mockResolvedValue("42" as never);
		const githubSpy = spyOn(cliMod, "runGitHub").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "-i", "all"]);

		const branchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Branch name:",
		);
		expect(branchCall).toBeDefined();
		expect((branchCall![0] as { defaultValue: string }).defaultValue).toBe(
			"feat/stonecut/issue-42",
		);

		configSpy.mockRestore();
		selectMock.mockRestore();
		textMock.mockRestore();
		githubSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("uses baseBranch from config as default", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");
		const configMod = await import("../src/config");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue({
			baseBranch: "develop",
		});
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-spec" as never)
			.mockResolvedValueOnce("develop" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "my-spec"]);

		const baseBranchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Base branch / PR target:",
		);
		expect(baseBranchCall).toBeDefined();
		expect((baseBranchCall![0] as { defaultValue: string }).defaultValue).toBe("develop");
		// defaultBranch() should NOT have been called since config provides baseBranch
		expect(defaultBranchMock).not.toHaveBeenCalled();

		configSpy.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("uses runner from config when no --runner flag", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");
		const configMod = await import("../src/config");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue({
			runner: "codex",
		});
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "my-spec"]);

		// Runner should be "codex" from config
		expect(localSpy).toHaveBeenCalledWith("my-spec", "all", "codex", expect.anything());

		configSpy.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("--runner flag overrides config runner", async () => {
		const cliMod = await import("../src/cli");
		const configMod = await import("../src/config");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue({
			runner: "codex",
		});
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);

		const program = buildProgram();
		await program.parseAsync([
			"node",
			"stonecut",
			"run",
			"--local",
			"spec",
			"-i",
			"1",
			"--runner",
			"claude",
		]);

		// Explicit flag takes precedence over config
		expect(localSpy).toHaveBeenCalledWith("spec", 1, "claude", undefined);

		configSpy.mockRestore();
		localSpy.mockRestore();
	});

	test("falls back to hardcoded defaults when config is absent", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");
		const configMod = await import("../src/config");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue(null);
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run", "--local", "my-spec"]);

		// Branch uses default "stonecut/" prefix
		const branchCall = textMock.mock.calls.find(
			(call) => (call[0] as { message: string }).message === "Branch name:",
		);
		expect(branchCall).toBeDefined();
		expect((branchCall![0] as { defaultValue: string }).defaultValue).toBe("stonecut/my-spec");

		// Base branch falls back to defaultBranch()
		expect(defaultBranchMock).toHaveBeenCalled();

		// Runner falls back to "claude"
		expect(localSpy).toHaveBeenCalledWith("my-spec", "all", "claude", expect.anything());

		configSpy.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// First-run hint when .stonecut/ missing
// ---------------------------------------------------------------------------

describe("first-run hint", () => {
	test("shows hint when .stonecut/ does not exist", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");
		const configMod = await import("../src/config");
		const fs = await import("fs");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue(null);
		const existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
		const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		// Calls: source name, iterations, branch, baseBranch
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("my-spec" as never)
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run"]);

		const hintCall = consoleSpy.mock.calls.find(
			(call) => typeof call[0] === "string" && call[0].includes("stonecut init"),
		);
		expect(hintCall).toBeDefined();

		configSpy.mockRestore();
		existsSpy.mockRestore();
		consoleSpy.mockRestore();
		selectMock.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("does not show hint when .stonecut/ exists", async () => {
		const clack = await import("@clack/prompts");
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");
		const configMod = await import("../src/config");
		const fs = await import("fs");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue(null);
		const existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
		const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		// Calls: source name, iterations, branch, baseBranch
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("my-spec" as never)
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run"]);

		const hintCall = consoleSpy.mock.calls.find(
			(call) => typeof call[0] === "string" && call[0].includes("stonecut init"),
		);
		expect(hintCall).toBeUndefined();

		configSpy.mockRestore();
		existsSpy.mockRestore();
		consoleSpy.mockRestore();
		selectMock.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});

	test("hint does not block execution", async () => {
		const cliMod = await import("../src/cli");
		const gitMod = await import("../src/git");
		const configMod = await import("../src/config");
		const clack = await import("@clack/prompts");
		const fs = await import("fs");

		const configSpy = spyOn(configMod, "loadConfig").mockReturnValue(null);
		const existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
		spyOn(console, "log").mockImplementation(() => {});
		const selectMock = spyOn(clack, "select").mockResolvedValue("local" as never);
		// Calls: source name, iterations, branch, baseBranch
		const textMock = spyOn(clack, "text")
			.mockResolvedValueOnce("my-spec" as never)
			.mockResolvedValueOnce("all" as never)
			.mockResolvedValueOnce("stonecut/my-spec" as never)
			.mockResolvedValueOnce("main" as never);
		const localSpy = spyOn(cliMod, "runLocal").mockResolvedValue(undefined);
		const defaultBranchMock = spyOn(gitMod, "defaultBranch").mockReturnValue("main");

		const program = buildProgram();
		await program.parseAsync(["node", "stonecut", "run"]);

		// Even with hint shown, execution continues to runLocal
		expect(localSpy).toHaveBeenCalled();

		configSpy.mockRestore();
		existsSpy.mockRestore();
		(console.log as ReturnType<typeof mock>).mockRestore?.();
		selectMock.mockRestore();
		textMock.mockRestore();
		localSpy.mockRestore();
		defaultBranchMock.mockRestore();
	});
});
