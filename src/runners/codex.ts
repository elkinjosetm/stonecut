/**
 * CodexRunner — adapter for OpenAI Codex CLI.
 *
 * Spawns a headless Codex session in full-auto mode, uses exit code as
 * the primary success signal, and extracts error details from JSONL
 * output on failure.
 */

import type { LogWriter, Runner, RunResult } from "../types.js";

function extractError(stdout: string): string {
	for (const raw of stdout.split("\n")) {
		const line = raw.trim();
		if (!line) continue;

		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}

		if (typeof event !== "object" || event === null || Array.isArray(event)) {
			continue;
		}

		const rec = event as Record<string, unknown>;
		const eventType = rec.type;

		if (eventType === "turn.failed") {
			const nested = rec.error;
			if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
				const msg = (nested as Record<string, unknown>).message;
				if (typeof msg === "string" && msg) return msg;
			}
		} else if (eventType === "error") {
			const msg = rec.message;
			if (typeof msg === "string" && msg) return msg;
		}
	}

	return "codex exited with non-zero status";
}

export class CodexRunner implements Runner {
	logEnvironment(_logger: LogWriter): void {
		// No environment-specific config to log for Codex.
	}

	async run(prompt: string): Promise<RunResult> {
		const start = performance.now();

		let proc: Awaited<ReturnType<typeof Bun.spawn>>;
		try {
			proc = Bun.spawn(["codex", "exec", "--full-auto", "--json", "--ephemeral", "-"], {
				stdin: new Response(prompt),
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch {
			return {
				success: false,
				exitCode: 1,
				durationSeconds: (performance.now() - start) / 1000,
				error: "codex binary not found in PATH",
			};
		}

		const exitCode = await proc.exited;
		const durationSeconds = (performance.now() - start) / 1000;

		if (exitCode === 0) {
			return { success: true, exitCode: 0, durationSeconds };
		}

		const stdout = await new Response(proc.stdout as ReadableStream).text();
		const error = extractError(stdout);

		return { success: false, exitCode, durationSeconds, error };
	}
}
