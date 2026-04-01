#!/usr/bin/env bun

/**
 * Forge CLI — PRD-driven development workflow orchestrator.
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
import { runAfkLoop } from "./runner";
import { getRunner } from "./runners/index";
import { setupSkills, removeSkills } from "./skills";
import type { GitHubIssue, Issue, IterationResult } from "./types";

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
): { kind: "local"; name: string } | { kind: "github"; number: number } {
	if (local !== undefined && github !== undefined) {
		throw new Error("Use exactly one of --local or --github.");
	}
	if (local === undefined && github === undefined) {
		throw new Error("One of --local or --github is required.");
	}
	if (local !== undefined) return { kind: "local", name: local };
	return { kind: "github", number: github! };
}

// ---------------------------------------------------------------------------
// Forge report
// ---------------------------------------------------------------------------

/**
 * Build the Forge Report section for a PR body.
 */
export function buildForgeReport(
	results: IterationResult[],
	runnerName: string,
	prdNumber?: number,
): string {
	const lines = ["## Forge Report", `**Runner:** ${runnerName}`, ""];
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
	let body = "**Forge:** Runner completed but produced no file changes.\n";
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
export async function preExecution(suggestedBranch: string): Promise<[string, string]> {
	ensureCleanTree();

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

	checkoutOrCreateBranch(branch);
	console.log("");

	return [branch, baseBranch];
}

// ---------------------------------------------------------------------------
// Push and create PR
// ---------------------------------------------------------------------------

function pushAndCreatePr(
	results: IterationResult[],
	branch: string,
	baseBranch: string,
	prTitle: string,
	runnerName: string,
	prdNumber?: number,
): void {
	pushBranch(branch);
	const body = buildForgeReport(results, runnerName, prdNumber);
	createPr(prTitle, body, baseBranch);
}

// ---------------------------------------------------------------------------
// Execution paths
// ---------------------------------------------------------------------------

export async function runLocal(
	name: string,
	iterations: number | "all",
	runnerName: string,
): Promise<void> {
	const runner = getRunner(runnerName);
	const source = new LocalSource(name);

	const localSlug = slugifyBranchComponent(name);
	const suggestedBranch = localSlug ? `forge/${localSlug}` : "forge/spec";
	const [branch, baseBranch] = await preExecution(suggestedBranch);

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
		runner,
		runnerName,
	);

	if (results.some((r) => r.success)) {
		pushAndCreatePr(results, branch, baseBranch, `Forge: ${name}`, runnerName);
	}
}

export async function runGitHub(
	number: number,
	iterations: number | "all",
	runnerName: string,
): Promise<void> {
	const runner = getRunner(runnerName);
	const source = new GitHubSource(number);

	const prd = source.getPrd();
	const prdSlug = slugifyBranchComponent(prd.title);
	const suggestedBranch = prdSlug ? `forge/${prdSlug}` : `forge/issue-${number}`;
	const prTitle = prd.title || `PRD #${number}`;
	const [branch, baseBranch] = await preExecution(suggestedBranch);

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
		runner,
		runnerName,
		(issue, output) => commentOnIssue(issue.number, output),
	);

	if (results.some((r) => r.success)) {
		pushAndCreatePr(results, branch, baseBranch, prTitle, runnerName, number);
	}
}

// ---------------------------------------------------------------------------
// Program definition
// ---------------------------------------------------------------------------

export function buildProgram(): Command {
	const program = new Command();

	program
		.name("forge")
		.description("Forge — execute PRD-driven development workflows using agentic coding CLIs.")
		.version(`forge ${version}`, "-V, --version");

	program
		.command("run")
		.description("Execute issues from a local PRD or GitHub PRD.")
		.option("--local <name>", "Local PRD name (.forge/<name>/)")
		.option("--github <number>", "GitHub PRD issue number", parseGitHubIssueNumber)
		.requiredOption("-i, --iterations <value>", "Number of issues to process, or 'all'")
		.option("--runner <name>", "Agentic CLI runner (claude, codex)", "claude")
		.action(async (opts) => {
			const source = validateRunSource(opts.local, opts.github);
			const iterations = parseIterations(opts.iterations);
			const runnerName: string = opts.runner;

			if (source.kind === "local") {
				await runLocal(source.name, iterations, runnerName);
			} else {
				await runGitHub(source.number, iterations, runnerName);
			}
		});

	program
		.command("setup-skills")
		.description("Install Forge skills as symlinks into ~/.claude/skills/.")
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
		.description("Remove Forge skill symlinks from ~/.claude/skills/.")
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
