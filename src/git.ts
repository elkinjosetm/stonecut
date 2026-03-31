/**
 * Git branch-level operations — branch management, working tree checks,
 * working tree lifecycle (snapshot/stage/commit/revert), and PR creation.
 *
 * All functions throw on failure. No process.exit, no console output.
 */

import type { WorkingTreeSnapshot } from "./types";

/**
 * Run a command synchronously, optionally in a specific working directory.
 * When cwd is omitted, uses the current process working directory.
 */
function runSync(
	cmd: string[],
	cwd?: string,
): { exitCode: number; stdout: string; stderr: string } {
	const proc = Bun.spawnSync(cmd, {
		stdout: "pipe",
		stderr: "pipe",
		...(cwd && { cwd }),
	});
	return {
		exitCode: proc.exitCode,
		stdout: proc.stdout.toString(),
		stderr: proc.stderr.toString(),
	};
}

/** Detect the remote's default branch, falling back to "main". */
export function defaultBranch(cwd?: string): string {
	const result = runSync(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
	if (result.exitCode === 0) {
		const ref = result.stdout.trim();
		const prefix = "refs/remotes/origin/";
		if (ref.startsWith(prefix)) {
			const branch = ref.slice(prefix.length);
			if (branch) {
				return branch;
			}
		}
	}
	return "main";
}

/** Throw if the working tree has uncommitted changes. */
export function ensureCleanTree(cwd?: string): void {
	const result = runSync(["git", "status", "--porcelain"], cwd);
	if (result.stdout.trim()) {
		throw new Error("Working tree has uncommitted changes. Commit or stash them first.");
	}
}

/** Check out the branch if it exists locally, otherwise create it. */
export function checkoutOrCreateBranch(branch: string, cwd?: string): void {
	const verify = runSync(["git", "rev-parse", "--verify", branch], cwd);
	if (verify.exitCode === 0) {
		const checkout = runSync(["git", "checkout", branch], cwd);
		if (checkout.exitCode !== 0) {
			throw new Error(`Failed to checkout branch ${branch}: ${checkout.stderr.trim()}`);
		}
	} else {
		const create = runSync(["git", "checkout", "-b", branch], cwd);
		if (create.exitCode !== 0) {
			throw new Error(`Failed to create branch ${branch}: ${create.stderr.trim()}`);
		}
	}
}

/** Push the branch to the remote with upstream tracking. */
export function pushBranch(branch: string, cwd?: string): void {
	const result = runSync(["git", "push", "-u", "origin", branch], cwd);
	if (result.exitCode !== 0) {
		throw new Error(`Failed to push branch ${branch}: ${result.stderr.trim()}`);
	}
}

/** Create a pull request via the gh CLI. */
export function createPr(title: string, body: string, baseBranch: string): void {
	const result = runSync([
		"gh",
		"pr",
		"create",
		"--title",
		title,
		"--body",
		body,
		"--base",
		baseBranch,
	]);
	if (result.exitCode !== 0) {
		throw new Error(`Failed to create PR: ${result.stderr.trim()}`);
	}
}

// ---------------------------------------------------------------------------
// Working tree lifecycle — snapshot / stage / commit / revert
// ---------------------------------------------------------------------------

/** Capture the current set of untracked files before a runner session. */
export function snapshotWorkingTree(cwd?: string): WorkingTreeSnapshot {
	const result = runSync(["git", "status", "--porcelain"], cwd);
	const untracked = new Set<string>();
	for (const line of result.stdout.split("\n")) {
		if (line.startsWith("??")) {
			untracked.add(line.slice(3).trim());
		}
	}
	return { untracked };
}

/**
 * Stage files changed during a runner session.
 *
 * Stages modified tracked files and new untracked files that were not
 * present in the snapshot. Returns true if anything was staged.
 */
export function stageChanges(snapshot: WorkingTreeSnapshot, cwd?: string): boolean {
	// Stage all modified tracked files
	const addU = runSync(["git", "add", "-u"], cwd);
	if (addU.exitCode !== 0) {
		throw new Error(`Failed to stage tracked changes: ${addU.stderr.trim()}`);
	}

	// Find new untracked files (not in pre-run snapshot)
	const status = runSync(["git", "status", "--porcelain"], cwd);
	const newFiles: string[] = [];
	for (const line of status.stdout.split("\n")) {
		if (line.startsWith("??")) {
			const path = line.slice(3).trim();
			if (!snapshot.untracked.has(path)) {
				newFiles.push(path);
			}
		}
	}

	if (newFiles.length > 0) {
		const addNew = runSync(["git", "add", "--", ...newFiles], cwd);
		if (addNew.exitCode !== 0) {
			throw new Error(`Failed to stage new files: ${addNew.stderr.trim()}`);
		}
	}

	// Check if anything is staged
	const diff = runSync(["git", "diff", "--cached", "--quiet"], cwd);
	return diff.exitCode !== 0;
}

/**
 * Create a git commit with the given message.
 *
 * Returns [success, output]. On failure the output contains the
 * error details (e.g. pre-commit hook output).
 */
export function commitChanges(message: string, cwd?: string): [boolean, string] {
	const result = runSync(["git", "commit", "-m", message], cwd);
	const output = `${result.stdout}\n${result.stderr}`.trim();
	return [result.exitCode === 0, output];
}

/**
 * Revert uncommitted changes, restoring the tree to the last commit.
 *
 * Removes new untracked files created during the runner session (those
 * not in the snapshot) and restores modified tracked files.
 */
export function revertUncommitted(snapshot: WorkingTreeSnapshot, cwd?: string): void {
	// Unstage everything (clear the index back to HEAD)
	runSync(["git", "reset", "HEAD"], cwd);

	// Restore modified tracked files
	runSync(["git", "checkout", "."], cwd);

	// Remove new untracked files (only those created during the session)
	const status = runSync(["git", "status", "--porcelain"], cwd);
	const newFiles: string[] = [];
	for (const line of status.stdout.split("\n")) {
		if (line.startsWith("??")) {
			const path = line.slice(3).trim();
			if (!snapshot.untracked.has(path)) {
				newFiles.push(path);
			}
		}
	}

	if (newFiles.length > 0) {
		runSync(["git", "clean", "-fd", "--", ...newFiles], cwd);
	}
}
