/**
 * Tests for CLI command setup, flag parsing, and validation.
 */

import { describe, expect, spyOn, test } from "bun:test";
import {
  buildProgram,
  parseIterations,
  validateRunSource,
} from "../src/cli";

// ---------------------------------------------------------------------------
// parseIterations
// ---------------------------------------------------------------------------

describe("parseIterations", () => {
  test("valid positive integer", () => {
    expect(parseIterations("3")).toBe(3);
  });

  test("valid integer 1", () => {
    expect(parseIterations("1")).toBe(1);
  });

  test("'all' returns string", () => {
    expect(parseIterations("all")).toBe("all");
  });

  test("zero throws", () => {
    expect(() => parseIterations("0")).toThrow(
      "Must be a positive integer or 'all'",
    );
  });

  test("negative throws", () => {
    expect(() => parseIterations("-1")).toThrow(
      "Must be a positive integer or 'all'",
    );
  });

  test("non-numeric throws", () => {
    expect(() => parseIterations("abc")).toThrow(
      "Must be a positive integer or 'all'",
    );
  });

  test("float throws", () => {
    expect(() => parseIterations("2.5")).toThrow(
      "Must be a positive integer or 'all'",
    );
  });
});

// ---------------------------------------------------------------------------
// validateRunSource
// ---------------------------------------------------------------------------

describe("validateRunSource", () => {
  test("local only returns local kind", () => {
    const result = validateRunSource("my-prd", undefined);
    expect(result).toEqual({ kind: "local", name: "my-prd" });
  });

  test("github only returns github kind", () => {
    const result = validateRunSource(undefined, 42);
    expect(result).toEqual({ kind: "github", number: 42 });
  });

  test("neither throws", () => {
    expect(() => validateRunSource(undefined, undefined)).toThrow(
      "One of --local or --github is required.",
    );
  });

  test("both throws", () => {
    expect(() => validateRunSource("my-prd", 42)).toThrow(
      "Use exactly one of --local or --github.",
    );
  });
});

// ---------------------------------------------------------------------------
// version flag
// ---------------------------------------------------------------------------

describe("--version flag", () => {
  test("outputs version string", async () => {
    const program = buildProgram();
    program.exitOverride();

    let output = "";
    program.configureOutput({ writeOut: (str) => (output = str) });

    try {
      await program.parseAsync(["node", "forge", "--version"]);
    } catch {
      // Commander throws on exit after --version
    }

    expect(output).toMatch(/^forge \d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// run command routing
// ---------------------------------------------------------------------------

describe("run command routing", () => {
  test("--local routes to runLocal", async () => {
    const localSpy = spyOn(
      await import("../src/cli"),
      "runLocal",
    ).mockResolvedValue(undefined);

    const program = buildProgram();
    // Patch the run action to use the spy
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.action(async (opts) => {
      const source = validateRunSource(opts.local, opts.github);
      const iterations = parseIterations(opts.iterations);
      if (source.kind === "local") {
        await localSpy(source.name, iterations, opts.runner);
      }
    });

    await program.parseAsync([
      "node",
      "forge",
      "run",
      "--local",
      "my-spec",
      "-i",
      "3",
    ]);

    expect(localSpy).toHaveBeenCalledWith("my-spec", 3, "claude");
    localSpy.mockRestore();
  });

  test("--github routes to runGitHub", async () => {
    const githubSpy = spyOn(
      await import("../src/cli"),
      "runGitHub",
    ).mockResolvedValue(undefined);

    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.action(async (opts) => {
      const source = validateRunSource(opts.local, opts.github);
      const iterations = parseIterations(opts.iterations);
      if (source.kind === "github") {
        await githubSpy(source.number, iterations, opts.runner);
      }
    });

    await program.parseAsync([
      "node",
      "forge",
      "run",
      "--github",
      "42",
      "-i",
      "all",
    ]);

    expect(githubSpy).toHaveBeenCalledWith(42, "all", "claude");
    githubSpy.mockRestore();
  });

  test("runner flag defaults to claude", async () => {
    const localSpy = spyOn(
      await import("../src/cli"),
      "runLocal",
    ).mockResolvedValue(undefined);

    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.action(async (opts) => {
      const source = validateRunSource(opts.local, opts.github);
      const iterations = parseIterations(opts.iterations);
      if (source.kind === "local") {
        await localSpy(source.name, iterations, opts.runner);
      }
    });

    await program.parseAsync([
      "node",
      "forge",
      "run",
      "--local",
      "spec",
      "-i",
      "1",
    ]);

    expect(localSpy).toHaveBeenCalledWith("spec", 1, "claude");
    localSpy.mockRestore();
  });

  test("custom runner flag is passed through", async () => {
    const localSpy = spyOn(
      await import("../src/cli"),
      "runLocal",
    ).mockResolvedValue(undefined);

    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.action(async (opts) => {
      const source = validateRunSource(opts.local, opts.github);
      const iterations = parseIterations(opts.iterations);
      if (source.kind === "local") {
        await localSpy(source.name, iterations, opts.runner);
      }
    });

    await program.parseAsync([
      "node",
      "forge",
      "run",
      "--local",
      "spec",
      "-i",
      "2",
      "--runner",
      "codex",
    ]);

    expect(localSpy).toHaveBeenCalledWith("spec", 2, "codex");
    localSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// run command validation
// ---------------------------------------------------------------------------

describe("run command validation", () => {
  test("neither --local nor --github throws", async () => {
    const program = buildProgram();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {} });

    let caught: Error | undefined;
    try {
      await program.parseAsync(["node", "forge", "run", "-i", "1"]);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain(
      "One of --local or --github is required.",
    );
  });

  test("both --local and --github throws", async () => {
    const program = buildProgram();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {} });

    let caught: Error | undefined;
    try {
      await program.parseAsync([
        "node",
        "forge",
        "run",
        "--local",
        "spec",
        "--github",
        "42",
        "-i",
        "1",
      ]);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain(
      "Use exactly one of --local or --github.",
    );
  });
});
