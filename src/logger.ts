/**
 * Logger — dual-output session logger.
 *
 * Writes to both console and a project-scoped log file at
 * .forge/logs/<prdIdentifier>-<timestamp>.log.
 */

import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { LogWriter } from "./types";

export class Logger implements LogWriter {
	readonly filePath: string;

	constructor(prdIdentifier: string) {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const logDir = join(".forge", "logs");
		mkdirSync(logDir, { recursive: true });
		this.filePath = join(logDir, `${prdIdentifier}-${timestamp}.log`);
	}

	log(message: string): void {
		console.log(message);
		const ts = new Date().toISOString();
		appendFileSync(this.filePath, `[${ts}] ${message}\n`);
	}

	close(): void {
		// No-op: appendFileSync doesn't hold a file handle.
		// Exists as a lifecycle hook for future buffered/async writers.
	}
}
