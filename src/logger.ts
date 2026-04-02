/**
 * Logger — dual-output session logger.
 *
 * Writes to both console and a project-scoped log file at
 * .stonecut/logs/<prdIdentifier>-<timestamp>.log.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import type { LogWriter } from "./types";

export class Logger implements LogWriter {
	readonly filePath: string;
	private warnedRecreated = false;
	private warnedUnavailable = false;

	constructor(prdIdentifier: string) {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const logDir = resolve(".stonecut", "logs");
		mkdirSync(logDir, { recursive: true });
		this.filePath = join(logDir, `${prdIdentifier}-${timestamp}.log`);
		appendFileSync(this.filePath, "");
	}

	log(message: string): void {
		console.log(message);
		const ts = new Date().toISOString();
		const fileWasMissing = !existsSync(this.filePath);
		try {
			mkdirSync(dirname(this.filePath), { recursive: true });
			appendFileSync(this.filePath, `[${ts}] ${message}\n`);
			if (fileWasMissing && !this.warnedRecreated) {
				console.error(
					`Warning: session log was deleted during execution and recreated at ${this.filePath}. Earlier log entries may be missing.`,
				);
				this.warnedRecreated = true;
			}
		} catch {
			if (!this.warnedUnavailable) {
				console.error("Warning: session log is unavailable; continuing without file logging.");
				this.warnedUnavailable = true;
			}
		}
	}

	close(): void {
		// No-op: appendFileSync doesn't hold a file handle.
		// Exists as a lifecycle hook for future buffered/async writers.
	}
}
