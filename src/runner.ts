/**
 * Runner — commit flow, orchestration loop, and session helpers.
 *
 * verifyAndFix: single check → fix cycle.
 * commitIssue: stage, commit, retry on failure up to maxRetries times.
 * runAfkLoop: main orchestration loop over issues from any source.
 * fmtTime / printSummary: session output formatting.
 *
 * Modules throw on failure. No process.exit, no console output.
 */

import {
	commitChanges as realCommitChanges,
	revertUncommitted as realRevertUncommitted,
	snapshotWorkingTree as realSnapshotWorkingTree,
	stageChanges as realStageChanges,
} from "./git";
import type {
	GitOps,
	IterationResult,
	LogWriter,
	Runner,
	Session,
	Source,
	WorkingTreeSnapshot,
} from "./types";

/** Default git operations that call the real git module. */
export const defaultGitOps: GitOps = {
	snapshotWorkingTree: realSnapshotWorkingTree,
	stageChanges: realStageChanges,
	commitChanges: realCommitChanges,
	revertUncommitted: realRevertUncommitted,
};

/** Console-only logger for backward compatibility. */
export const consoleLogger: LogWriter = {
	log: (message: string) => console.log(message),
	close: () => {},
};

/**
 * Single check → fix cycle.
 *
 * Runs `check`. If it passes, returns immediately. If it fails,
 * spawns the runner with a prompt built from the error output,
 * then runs the check once more.
 *
 * Returns [success, output] from the final check.
 */
export async function verifyAndFix(
	runner: Runner,
	check: () => [boolean, string],
	fixPrompt: (error: string) => string,
): Promise<[boolean, string]> {
	const [ok, output] = check();
	if (ok) {
		return [true, output];
	}
	await runner.run(fixPrompt(output));
	return check();
}

/**
 * Stage, commit, and retry on failure up to `maxRetries` times.
 *
 * Returns [success, output] where output is the commit or error
 * output from the last attempt.
 */
export async function commitIssue(
	runner: Runner,
	message: string,
	snapshot: WorkingTreeSnapshot,
	maxRetries: number = 3,
	git: GitOps = defaultGitOps,
): Promise<[boolean, string]> {
	git.stageChanges(snapshot);

	let output = "";
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const [ok, result] = await verifyAndFix(
			runner,
			() => git.commitChanges(message),
			(error) =>
				"The git commit failed with the following output. " +
				"Fix the issues and stop. Do not commit.\n\n" +
				error,
		);
		output = result;
		if (ok) {
			return [true, output];
		}
		// Re-stage after the fix attempt (runner may have changed files)
		git.stageChanges(snapshot);
	}

	return [false, output];
}

/**
 * Run the autonomous loop over issues from any source.
 *
 * Uses the provided Session to execute each issue's prompt.
 * After each successful run, Stonecut stages and commits the changes.
 * Works with both LocalSource and GitHubSource.
 *
 * A failing issue is retried once (2 total attempts). If it fails
 * a second time, the session stops — issues are sequential vertical
 * slices, so skipping is not viable.
 */
export async function runAfkLoop<T extends { number: number }>(
	source: Source<T>,
	iterations: number | "all",
	renderPrompt: (issue: T) => string | Promise<string>,
	displayName: (issue: T) => string,
	commitMessage: (issue: T) => string,
	session: Session,
	onNoChanges?: (issue: T, output: string | undefined) => void,
): Promise<IterationResult[]> {
	const { logger, git, runner, runnerName } = session;

	logger.log(`Session started — runner: ${runnerName}, iterations: ${iterations}`);
	logger.log("");
	const results: IterationResult[] = [];
	const sessionStart = performance.now();
	let iteration = 0;
	let lastFailedIssueNumber: number | null = null;

	while (true) {
		// Check iteration limit
		if (typeof iterations === "number" && iteration >= iterations) {
			break;
		}

		const issue = await source.getNextIssue();
		if (issue === null) {
			if (iteration === 0) {
				logger.log("All issues complete!");
			}
			break;
		}

		iteration++;
		const name = displayName(issue);
		const [remaining, total] = await source.getRemainingCount();

		// Detect retry
		if (lastFailedIssueNumber === issue.number) {
			logger.log(
				`--- Iteration ${iteration} --- [Issue ${issue.number}: ${name}] (${remaining}/${total} remaining)`,
			);
			logger.log(`Retrying issue ${issue.number} (attempt 2 of 2)`);
		} else {
			logger.log(
				`--- Iteration ${iteration} --- [Issue ${issue.number}: ${name}] (${remaining}/${total} remaining)`,
			);
		}

		// Snapshot working tree before runner
		const snapshot = git.snapshotWorkingTree();

		logger.log(`Running ${runnerName}...`);
		const prompt = await renderPrompt(issue);
		const runResult = await runner.run(prompt);

		if (!runResult.success) {
			logger.log(`Reverted working tree to pre-run snapshot.`);
			git.revertUncommitted(snapshot);
			const errorDetail = runResult.error || "unknown error";
			logger.log(
				`Issue ${issue.number}: runner failed — ${errorDetail} ` +
					`(${fmtTime(runResult.durationSeconds)})`,
			);
			results.push({
				issueNumber: issue.number,
				issueFilename: name,
				success: false,
				elapsedSeconds: runResult.durationSeconds,
				error: runResult.error,
			});

			if (lastFailedIssueNumber === issue.number) {
				logger.log(`Issue ${issue.number}: failed twice consecutively — stopping session.`);
				logger.log("");
				break;
			}
			lastFailedIssueNumber = issue.number;
			logger.log("");
			continue;
		}

		// Runner succeeded — check for changes
		logger.log(`Staging changes...`);
		const hasChanges = git.stageChanges(snapshot);
		if (!hasChanges) {
			const errorMsg = "runner produced no changes";
			logger.log(`Issue ${issue.number}: ${errorMsg} ` + `(${fmtTime(runResult.durationSeconds)})`);
			if (onNoChanges) {
				onNoChanges(issue, runResult.output);
			}
			results.push({
				issueNumber: issue.number,
				issueFilename: name,
				success: false,
				elapsedSeconds: runResult.durationSeconds,
				error: errorMsg,
			});

			if (lastFailedIssueNumber === issue.number) {
				logger.log(`Issue ${issue.number}: failed twice consecutively — stopping session.`);
				logger.log("");
				break;
			}
			lastFailedIssueNumber = issue.number;
			logger.log("");
			continue;
		}

		// Commit the changes
		logger.log(`Committing...`);
		const msg = commitMessage(issue);
		const [committed] = await commitIssue(runner, msg, snapshot, 3, git);

		if (!committed) {
			logger.log(
				`Issue ${issue.number}: commit failed after retries ` +
					`(${fmtTime(runResult.durationSeconds)})`,
			);
			git.revertUncommitted(snapshot);
			results.push({
				issueNumber: issue.number,
				issueFilename: name,
				success: false,
				elapsedSeconds: runResult.durationSeconds,
				error: "commit failed after retries",
			});
			// Commit failures always stop the session immediately
			logger.log("Stopping session: unable to commit.");
			logger.log("");
			break;
		}

		// Commit succeeded — mark issue complete
		await source.completeIssue(issue);
		logger.log(
			`Issue ${issue.number}: committed and completed ` + `(${fmtTime(runResult.durationSeconds)})`,
		);
		results.push({
			issueNumber: issue.number,
			issueFilename: name,
			success: true,
			elapsedSeconds: runResult.durationSeconds,
		});

		lastFailedIssueNumber = null;
		logger.log("");
	}

	// Session summary
	const totalElapsed = (performance.now() - sessionStart) / 1000;
	printSummary(results, totalElapsed, logger);
	return results;
}

/** Format seconds as a human-readable duration. */
export function fmtTime(seconds: number): string {
	if (seconds < 60) {
		return `${Math.round(seconds)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${minutes}m ${secs}s`;
}

/** Print a summary of the afk session. */
export function printSummary(
	results: IterationResult[],
	totalSeconds: number,
	logger: LogWriter = consoleLogger,
): void {
	if (results.length === 0) {
		return;
	}

	logger.log("=== Session Summary ===");
	const succeeded = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	for (const r of results) {
		const status = r.success ? "completed" : "failed";
		const elapsed = fmtTime(r.elapsedSeconds);
		logger.log(`  Issue ${r.issueNumber} (${r.issueFilename}): ${status} (${elapsed})`);
	}

	logger.log("");
	logger.log(`Total: ${results.length} issues — ${succeeded} completed, ${failed} failed`);
	logger.log(`Total time: ${fmtTime(totalSeconds)}`);
}
