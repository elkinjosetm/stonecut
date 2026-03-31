/**
 * ClaudeRunner — adapter for Claude Code CLI.
 *
 * Spawns a headless Claude Code session, parses the JSON output to
 * determine success/failure, and translates error subtypes into
 * human-readable messages.
 */

import type { Runner, RunResult } from "../types.js";

const ERROR_MESSAGES: Record<string, string> = {
  error_max_turns: "max turns exceeded",
  error_max_budget_usd: "max budget exceeded",
};

export class ClaudeRunner implements Runner {
  async run(prompt: string): Promise<RunResult> {
    const start = performance.now();

    let proc: Awaited<ReturnType<typeof Bun.spawn>>;
    try {
      proc = Bun.spawn(
        [
          "claude",
          "-p",
          "--output-format",
          "json",
          "--allowedTools",
          "Bash,Edit,Read,Write,Glob,Grep",
        ],
        { stdin: new Response(prompt), stdout: "pipe", stderr: "pipe" },
      );
    } catch {
      return {
        success: false,
        exitCode: 1,
        durationSeconds: (performance.now() - start) / 1000,
        error: "claude binary not found in PATH",
      };
    }

    const exitCode = await proc.exited;
    const durationSeconds = (performance.now() - start) / 1000;

    const stdout = await new Response(proc.stdout as ReadableStream).text();
    const output = stdout || undefined;

    if (output === undefined) {
      return {
        success: false,
        exitCode,
        durationSeconds,
        error: `no output (exit code ${exitCode})`,
      };
    }

    let data: unknown;
    try {
      data = JSON.parse(output);
    } catch {
      return {
        success: false,
        exitCode,
        durationSeconds,
        output,
        error: "malformed JSON output",
      };
    }

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return {
        success: false,
        exitCode,
        durationSeconds,
        output,
        error: "unexpected JSON output (not an object)",
      };
    }

    const subtype = (data as Record<string, unknown>).subtype ?? "";
    if (subtype === "success") {
      return { success: true, exitCode, durationSeconds, output };
    }

    const error =
      ERROR_MESSAGES[subtype as string] ??
      `failed (${(subtype as string) || "unknown"})`;
    return { success: false, exitCode, durationSeconds, output, error };
  }
}
