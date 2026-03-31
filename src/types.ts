/**
 * Core types and interfaces shared across the Forge CLI.
 */

/** Structured result from a single runner execution. */
export interface RunResult {
	success: boolean;
	exitCode: number;
	durationSeconds: number;
	output?: string;
	error?: string;
}

/** Result of a single afk iteration. */
export interface IterationResult {
	issueNumber: number;
	issueFilename: string;
	success: boolean;
	elapsedSeconds: number;
	error?: string;
}

/** Protocol that all runner adapters must satisfy. */
export interface Runner {
	run(prompt: string): Promise<RunResult>;
}

/** Snapshot of the working tree state before a runner session. */
export interface WorkingTreeSnapshot {
	untracked: Set<string>;
}

/** A single issue from a local spec. */
export interface Issue {
	number: number;
	filename: string;
	path: string;
	content: string;
}

/** Structured metadata for a GitHub-backed PRD issue. */
export interface GitHubPrd {
	number: number;
	title: string;
	body: string;
}

/** A single sub-issue from a GitHub PRD. */
export interface GitHubIssue {
	number: number;
	title: string;
	body: string;
}

/** Source interface for reading issues from any backend (local or GitHub). */
export interface Source<T> {
	getNextIssue(): Promise<T | null>;
	completeIssue(issue: T): Promise<void>;
	getRemainingCount(): Promise<[number, number]>;
	getPrdContent(): Promise<string>;
}
// test
