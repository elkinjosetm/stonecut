#!/usr/bin/env bun

/**
 * Forge CLI — PRD-driven development workflow orchestrator.
 *
 * Modules throw errors; only this file catches them, formats user-facing
 * messages, and calls process.exit().
 */

import { Command, InvalidArgumentError } from "commander";
import { createRequire } from "module";

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
    throw new InvalidArgumentError(
      `Must be a positive integer or 'all', got '${value}'`,
    );
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
// Placeholder execution stubs (wired in the next issue)
// ---------------------------------------------------------------------------

export async function runLocal(
  ...[]: [name: string, iterations: number | "all", runnerName: string]
): Promise<void> {
  // Will be implemented in the orchestration issue.
}

export async function runGitHub(
  ...[]: [number: number, iterations: number | "all", runnerName: string]
): Promise<void> {
  // Will be implemented in the orchestration issue.
}

// ---------------------------------------------------------------------------
// Program definition
// ---------------------------------------------------------------------------

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("forge")
    .description(
      "Forge — execute PRD-driven development workflows using agentic coding CLIs.",
    )
    .version(`forge ${version}`, "-V, --version");

  program
    .command("run")
    .description("Execute issues from a local PRD or GitHub PRD.")
    .option("--local <name>", "Local PRD name (.forge/<name>/)")
    .option("--github <number>", "GitHub PRD issue number", parseInt)
    .requiredOption(
      "-i, --iterations <value>",
      "Number of issues to process, or 'all'",
    )
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
