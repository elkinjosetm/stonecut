#!/usr/bin/env bun

/**
 * Stonecut CLI — PRD-driven development workflow orchestrator.
 *
 * Modules throw errors; only this file catches them, formats user-facing
 * messages, and calls process.exit().
 */

import * as clack from "@clack/prompts";
import { Command, InvalidArgumentError } from "commander";
import { createRequire } from "module";
import {
	checkoutOrCreateBranch,
	createPr,
	defaultBranch,
	ensureCleanTree,
	pushBranch,
} from "./git";
import { GitHubSource } from "./github";
import { LocalSource } from "./local";
import { slugifyBranchComponent } from "./naming";
import { renderGithub, renderLocal } from "./prompt";
import { Logger } from "./logger";
import { defaultGitOps, runAfkLoop } from "./runner";
import { getRunner } from "./runners/index";
import { setupSkills, removeSkills } from "./skills";
import type { GitHubIssue, Issue, IterationResult, Session } from "./types";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

// ---------------------------------------------------------------------------
// Validation helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse the --iterations value: positive integer or "all".
 * Throws InvalidArgumentError on bad input so Commander surfaces it.
 */
export function parseIterations(value: string): number | "all" {
	if (value === "all") return "all";
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) {
		throw new InvalidArgumentError(`Must be a positive integer or 'all', got '${value}'`);
	}
	return n;
}

/**
 * Parse the --github value: must be a positive integer.
 * Throws InvalidArgumentError on bad input so Commander surfaces it.
 */
export function parseGitHubIssueNumber(value: string): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) {
		throw new InvalidArgumentError(`Must be a positive integer, got '${value}'`);
	}
	return n;
}

/**
 * Ensure exactly one of --local or --github was provided.
 * Returns a tagged tuple so the caller can dispatch.
 */
export function validateRunSource(
	local: string | undefined,
	github: number | undefined,
): { kind: "local"; name: string } | { kind: "github"; number: number } | { kind: "prompt" } {
	if (local !== undefined && github !== undefined) {
		throw new Error("Use exactly one of --local or --github.");
	}
	if (local === undefined && github === undefined) {
		return { kind: "prompt" };
	}
	if (local !== undefined) return { kind: "local", name: local };
	return { kind: "github", number: github! };
}

/**
 * Prompt the user interactively for the source type and value.
 * Returns a tagged tuple matching the shape of validateRunSource().
 */
export async function promptForSource(): Promise<
	{ kind: "local"; name: string } | { kind: "github"; number: number }
> {
	const sourceType = await clack.select({
		message: "Source type:",
		options: [
			{ value: "local", label: "Local PRD (.stonecut/<name>/)" },
			{ value: "github", label: "GitHub PRD (issue number)" },
		],
	});

	if (clack.isCancel(sourceType)) {
		throw new Error("Cancelled.");
	}

	if (sourceType === "local") {
		const name = await clack.text({
			message: "Spec name:",
			placeholder: "my-spec",
			validate: (value) => {
				if (!value.trim()) return "Spec name is required.";
			},
		});
		if (clack.isCancel(name)) {
			throw new Error("Cancelled.");
		}
		return { kind: "local", name };
	}

	const issueStr = await clack.text({
		message: "GitHub issue number:",
		placeholder: "42",
		validate: (value) => {
			const n = Number(value);
			if (!Number.isInteger(n) || n <= 0) return "Must be a positive integer.";
		},
	});
	if (clack.isCancel(issueStr)) {
		throw new Error("Cancelled.");
	}
	return { kind: "github", number: Number(issueStr) };
}

// ---------------------------------------------------------------------------
// Stonecut report
// ---------------------------------------------------------------------------

/**
 * Build the Stonecut Report section for a PR body.
 */
export function buildReport(
	results: IterationResult[],
	runnerName: string,
	prdNumber?: number,
): string {
	const lines = ["## Stonecut Report", `**Runner:** ${runnerName}`, ""];
	for (const r of results) {
		if (r.success) {
			lines.push(`- #${r.issueNumber} ${r.issueFilename}: completed`);
		} else {
			const reason = r.error || "unknown error";
			lines.push(`- #${r.issueNumber} ${r.issueFilename}: failed — ${reason}`);
		}
	}

	if (prdNumber !== undefined && results.every((r) => r.success)) {
		lines.push("");
		lines.push(`Closes #${prdNumber}`);
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GitHub comment on no-changes
// ---------------------------------------------------------------------------

function commentOnIssue(issueNumber: number, runnerOutput: string | undefined): void {
	let body = "**Stonecut:** Runner completed but produced no file changes.\n";
	if (runnerOutput) {
		body +=
			"\n<details><summary>Runner output</summary>\n\n" +
			`\`\`\`\n${runnerOutput}\n\`\`\`\n\n</details>`;
	}
	Bun.spawnSync(["gh", "issue", "comment", String(issueNumber), "--body", body], {
		stdout: "pipe",
		stderr: "pipe",
	});
}

// ---------------------------------------------------------------------------
// Pre-execution flow
// ---------------------------------------------------------------------------

/**
 * Run pre-execution prompts and git checks.
 * Returns [branch, baseBranch].
 */
export async function preExecution(
	suggestedBranch: string,
	prefilled?: { branch?: string; baseBranch?: string },
): Promise<[string, string]> {
	ensureCleanTree();

	let branch: string;
	if (prefilled?.branch) {
		branch = prefilled.branch;
	} else {
		const branchInput = await clack.text({
			message: "Branch name:",
			defaultValue: suggestedBranch,
			placeholder: suggestedBranch,
		});

		if (clack.isCancel(branchInput)) {
			throw new Error("Cancelled.");
		}
		branch = branchInput;
	}

	let baseBranch: string;
	if (prefilled?.baseBranch) {
		baseBranch = prefilled.baseBranch;
	} else {
		const detectedDefault = defaultBranch();
		const baseBranchInput = await clack.text({
			message: "Base branch / PR target:",
			defaultValue: detectedDefault,
			placeholder: detectedDefault,
		});

		if (clack.isCancel(baseBranchInput)) {
			throw new Error("Cancelled.");
		}
		baseBranch = baseBranchInput;
	}

	checkoutOrCreateBranch(branch);
	console.log("");

	return [branch, baseBranch];
}

// ---------------------------------------------------------------------------
// Post-loop: push and conditionally create PR
// ---------------------------------------------------------------------------

export async function pushAndMaybePr(
	results: IterationResult[],
	source: { getRemainingCount(): Promise<[number, number]> },
	branch: string,
	baseBranch: string,
	prTitle: string,
	runnerName: string,
	logger: { log(message: string): void },
	prdNumber?: number,
): Promise<void> {
	if (!results.some((r) => r.success)) {
		return;
	}

	pushBranch(branch);
	logger.log(`Pushed branch '${branch}'.`);

	const [remaining, total] = await source.getRemainingCount();
	if (remaining === 0) {
		const body = buildReport(results, runnerName, prdNumber);
		createPr(prTitle, body, baseBranch);
		logger.log("Created PR.");
	} else {
		logger.log(`${remaining}/${total} issues remaining — PR deferred.`);
	}
}

// ---------------------------------------------------------------------------
// Execution paths
// ---------------------------------------------------------------------------

export async function runLocal(
	name: string,
	iterations: number | "all",
	runnerName: string,
	prefilled?: { branch?: string; baseBranch?: string },
): Promise<void> {
	const runner = getRunner(runnerName);
	const source = new LocalSource(name);
	const prdIdentifier = slugifyBranchComponent(name) || "spec";
	const logger = new Logger(prdIdentifier);

	const session: Session = { logger, git: defaultGitOps, runner, runnerName };

	try {
		const suggestedBranch = prdIdentifier ? `stonecut/${prdIdentifier}` : "stonecut/spec";
		const [branch, baseBranch] = await preExecution(suggestedBranch, prefilled);

		const prdContent = await source.getPrdContent();
		const results = await runAfkLoop<Issue>(
			source,
			iterations,
			(issue) =>
				renderLocal({
					prdContent,
					issueNumber: issue.number,
					issueFilename: issue.filename,
					issueContent: issue.content,
				}),
			(issue) => issue.filename,
			(issue) => `Issue ${issue.number}: ${issue.filename}`,
			session,
		);

		await pushAndMaybePr(
			results,
			source,
			branch,
			baseBranch,
			`Stonecut: ${name}`,
			runnerName,
			logger,
		);
	} finally {
		logger.close();
	}
}

export async function runGitHub(
	number: number,
	iterations: number | "all",
	runnerName: string,
	prefilled?: { branch?: string; baseBranch?: string },
): Promise<void> {
	const runner = getRunner(runnerName);
	const source = new GitHubSource(number);
	const logger = new Logger(`prd-${number}`);

	const session: Session = { logger, git: defaultGitOps, runner, runnerName };

	try {
		const prd = source.getPrd();
		const prdSlug = slugifyBranchComponent(prd.title);
		const suggestedBranch = prdSlug ? `stonecut/${prdSlug}` : `stonecut/issue-${number}`;
		const prTitle = prd.title || `PRD #${number}`;
		const [branch, baseBranch] = await preExecution(suggestedBranch, prefilled);

		const prdContent = prd.body;
		const results = await runAfkLoop<GitHubIssue>(
			source,
			iterations,
			(issue) =>
				renderGithub({
					prdContent,
					issueNumber: issue.number,
					issueTitle: issue.title,
					issueContent: issue.body,
				}),
			(issue) => issue.title,
			(issue) => `Issue #${issue.number}: ${issue.title}`,
			session,
			(issue, output) => commentOnIssue(issue.number, output),
		);

		await pushAndMaybePr(results, source, branch, baseBranch, prTitle, runnerName, logger, number);
	} finally {
		logger.close();
	}
}

// ---------------------------------------------------------------------------
// Program definition
// ---------------------------------------------------------------------------

export function buildProgram(): Command {
	const program = new Command();

	program
		.name("stonecut")
		.description("Stonecut — execute PRD-driven development workflows using agentic coding CLIs.")
		.version(`stonecut ${version}`, "-V, --version");

	program
		.command("run")
		.description("Execute issues from a local PRD or GitHub PRD.")
		.option("--local <name>", "Local PRD name (.stonecut/<name>/)")
		.option("--github <number>", "GitHub PRD issue number", parseGitHubIssueNumber)
		.option("-i, --iterations <value>", "Number of issues to process, or 'all'")
		.option("--runner <name>", "Agentic CLI runner (claude, codex)", "claude")
		.action(async (opts) => {
			const validated = validateRunSource(opts.local, opts.github);
			const source = validated.kind === "prompt" ? await promptForSource() : validated;

			let iterations: number | "all";
			const needsIterationPrompt = opts.iterations === undefined;
			if (!needsIterationPrompt) {
				iterations = parseIterations(opts.iterations);
			} else {
				const iterationsInput = await clack.text({
					message: "Iterations:",
					defaultValue: "all",
					placeholder: "all",
					validate: (value) => {
						try {
							parseIterations(value);
						} catch {
							return "Must be a positive integer or 'all'.";
						}
					},
				});
				if (clack.isCancel(iterationsInput)) {
					throw new Error("Cancelled.");
				}
				iterations = parseIterations(iterationsInput);
			}

			const isWizard = validated.kind === "prompt" || needsIterationPrompt;
			let prefilled: { branch?: string; baseBranch?: string } | undefined;

			if (isWizard) {
				const suggestedBranch =
					source.kind === "local"
						? `stonecut/${slugifyBranchComponent(source.name) || "spec"}`
						: `stonecut/issue-${source.number}`;

				const branch = await clack.text({
					message: "Branch name:",
					defaultValue: suggestedBranch,
					placeholder: suggestedBranch,
				});
				if (clack.isCancel(branch)) {
					throw new Error("Cancelled.");
				}

				const detectedDefault = defaultBranch();
				const baseBranch = await clack.text({
					message: "Base branch / PR target:",
					defaultValue: detectedDefault,
					placeholder: detectedDefault,
				});
				if (clack.isCancel(baseBranch)) {
					throw new Error("Cancelled.");
				}

				prefilled = { branch, baseBranch };
			}

			const runnerName: string = opts.runner;

			if (source.kind === "local") {
				await runLocal(source.name, iterations, runnerName, prefilled);
			} else {
				await runGitHub(source.number, iterations, runnerName, prefilled);
			}
		});

	program
		.command("setup-skills")
		.description("Install Stonecut skills as symlinks into ~/.claude/skills/.")
		.option(
			"--target <path>",
			"Claude root path (e.g. ~/.claude-acme). Skills are installed into <target>/skills/.",
		)
		.action((opts) => {
			const result = setupSkills(opts.target);
			for (const msg of result.messages) {
				console.log(msg);
			}
			for (const warn of result.warnings) {
				console.error(warn);
			}
		});

	program
		.command("remove-skills")
		.description("Remove Stonecut skill symlinks from ~/.claude/skills/.")
		.option(
			"--target <path>",
			"Claude root path (e.g. ~/.claude-acme). Skills are removed from <target>/skills/.",
		)
		.action((opts) => {
			const result = removeSkills(opts.target);
			for (const msg of result.messages) {
				console.log(msg);
			}
			for (const warn of result.warnings) {
				console.error(warn);
			}
		});

	return program;
}

// ---------------------------------------------------------------------------
// Entry point — top-level error catching
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const program = buildProgram();
	await program.parseAsync(process.argv);
}

if (import.meta.main) {
	main().catch((err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Error: ${message}`);
		process.exit(1);
	});
}
