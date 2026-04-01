/**
 * Core types and interfaces shared across the Stonecut CLI.
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
	logEnvironment(logger: LogWriter): void;
}

/** Snapshot of the working tree state before a runner session. */
export interface WorkingTreeSnapshot {
	untracked: Set<string>;
}

/** Git operations used by the runner loop, injectable for testing. */
export interface GitOps {
	snapshotWorkingTree(): WorkingTreeSnapshot;
	stageChanges(snapshot: WorkingTreeSnapshot): boolean;
	commitChanges(message: string): [boolean, string];
	revertUncommitted(snapshot: WorkingTreeSnapshot): void;
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

/** Logger interface for session-scoped logging. */
export interface LogWriter {
	log(message: string): void;
	close(): void;
}

/** Session context threaded through a stonecut run. */
export interface Session {
	logger: LogWriter;
	git: GitOps;
	runner: Runner;
	runnerName: string;
}
