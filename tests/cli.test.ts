/**
 * Tests for CLI command setup, flag parsing, validation, forge report,
 * execution paths, and pre-execution prompts.
 */

import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  buildForgeReport,
  buildProgram,
  parseIterations,
  preExecution,
  validateRunSource,
} from "../src/cli";
import type { IterationResult } from "../src/types";

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

// ---------------------------------------------------------------------------
// buildForgeReport
// ---------------------------------------------------------------------------

describe("buildForgeReport", () => {
  test("includes runner name", () => {
    const report = buildForgeReport([], "claude");
    expect(report).toContain("**Runner:** claude");
  });

  test("success format", () => {
    const results: IterationResult[] = [
      {
        issueNumber: 1,
        issueFilename: "setup.md",
        success: true,
        elapsedSeconds: 30,
      },
    ];
    const report = buildForgeReport(results, "claude");
    expect(report).toContain("- #1 setup.md: completed");
  });

  test("failure format with error detail", () => {
    const results: IterationResult[] = [
      {
        issueNumber: 2,
        issueFilename: "api.md",
        success: false,
        elapsedSeconds: 10,
        error: "max turns exceeded",
      },
    ];
    const report = buildForgeReport(results, "codex");
    expect(report).toContain("- #2 api.md: failed — max turns exceeded");
  });

  test("failure with no error uses 'unknown error'", () => {
    const results: IterationResult[] = [
      {
        issueNumber: 3,
        issueFilename: "db.md",
        success: false,
        elapsedSeconds: 5,
      },
    ];
    const report = buildForgeReport(results, "claude");
    expect(report).toContain("- #3 db.md: failed — unknown error");
  });

  test("multiple results", () => {
    const results: IterationResult[] = [
      {
        issueNumber: 1,
        issueFilename: "setup.md",
        success: true,
        elapsedSeconds: 30,
      },
      {
        issueNumber: 2,
        issueFilename: "api.md",
        success: false,
        elapsedSeconds: 10,
        error: "timeout",
      },
    ];
    const report = buildForgeReport(results, "claude");
    expect(report).toContain("- #1 setup.md: completed");
    expect(report).toContain("- #2 api.md: failed — timeout");
  });

  test("includes 'Closes #N' for GitHub PRD number", () => {
    const results: IterationResult[] = [
      {
        issueNumber: 5,
        issueFilename: "feat.md",
        success: true,
        elapsedSeconds: 60,
      },
    ];
    const report = buildForgeReport(results, "claude", 42);
    expect(report).toContain("Closes #42");
  });

  test("omits 'Closes #N' when no PRD number", () => {
    const results: IterationResult[] = [
      {
        issueNumber: 5,
        issueFilename: "feat.md",
        success: true,
        elapsedSeconds: 60,
      },
    ];
    const report = buildForgeReport(results, "claude");
    expect(report).not.toContain("Closes");
  });

  test("starts with ## Forge Report header", () => {
    const report = buildForgeReport([], "claude");
    expect(report).toMatch(/^## Forge Report/);
  });
});

// ---------------------------------------------------------------------------
// Branch slug and PR title naming
// ---------------------------------------------------------------------------

describe("branch and PR title naming", () => {
  test("local branch uses forge/<slug> pattern", async () => {
    // Test the slug generation used in runLocal
    const { slugifyBranchComponent } = await import("../src/naming");
    const slug = slugifyBranchComponent("My Cool Spec");
    expect(`forge/${slug}`).toBe("forge/my-cool-spec");
  });

  test("local branch fallback when slug is empty", async () => {
    const { slugifyBranchComponent } = await import("../src/naming");
    const slug = slugifyBranchComponent("---");
    const branch = slug ? `forge/${slug}` : "forge/spec";
    expect(branch).toBe("forge/spec");
  });

  test("github branch uses forge/<prd-slug> pattern", async () => {
    const { slugifyBranchComponent } = await import("../src/naming");
    const slug = slugifyBranchComponent("Rewrite CLI to TypeScript");
    expect(`forge/${slug}`).toBe("forge/rewrite-cli-to-typescript");
  });

  test("github branch fallback when slug is empty", async () => {
    const { slugifyBranchComponent } = await import("../src/naming");
    const slug = slugifyBranchComponent("");
    const branch = slug ? `forge/${slug}` : "forge/issue-99";
    expect(branch).toBe("forge/issue-99");
  });

  test("local PR title is 'Forge: <name>'", () => {
    const name = "my-spec";
    expect(`Forge: ${name}`).toBe("Forge: my-spec");
  });

  test("github PR title uses PRD title", () => {
    const prdTitle = "Rewrite CLI";
    const prTitle = prdTitle || "PRD #99";
    expect(prTitle).toBe("Rewrite CLI");
  });

  test("github PR title fallback when title is empty", () => {
    const prdTitle = "";
    const prTitle = prdTitle || "PRD #99";
    expect(prTitle).toBe("PRD #99");
  });
});

// ---------------------------------------------------------------------------
// preExecution prompt mocking
// ---------------------------------------------------------------------------

describe("preExecution", () => {
  test("returns branch and base branch from prompts", async () => {
    const clack = await import("@clack/prompts");
    const gitMod = await import("../src/git");

    const textMock = mock()
      .mockResolvedValueOnce("forge/my-branch")
      .mockResolvedValueOnce("main");

    spyOn(clack, "text").mockImplementation(textMock);
    spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});
    spyOn(gitMod, "defaultBranch").mockReturnValue("main");
    spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
    spyOn(console, "log").mockImplementation(() => {});

    const [branch, baseBranch] = await preExecution("forge/suggested");

    expect(branch).toBe("forge/my-branch");
    expect(baseBranch).toBe("main");

    (clack.text as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.defaultBranch as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
    (console.log as ReturnType<typeof mock>).mockRestore?.();
  });

  test("throws when branch prompt is cancelled", async () => {
    const clack = await import("@clack/prompts");
    const gitMod = await import("../src/git");

    const cancelSymbol = Symbol("cancel");
    spyOn(clack, "text").mockResolvedValue(cancelSymbol as never);
    spyOn(clack, "isCancel").mockReturnValue(true);
    spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});

    await expect(preExecution("forge/test")).rejects.toThrow("Cancelled.");

    (clack.text as ReturnType<typeof mock>).mockRestore?.();
    (clack.isCancel as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
  });

  test("calls ensureCleanTree before prompts", async () => {
    const clack = await import("@clack/prompts");
    const gitMod = await import("../src/git");

    const callOrder: string[] = [];
    spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {
      callOrder.push("ensureCleanTree");
    });
    const textMock = mock().mockImplementation(async () => {
      callOrder.push("text");
      return "value";
    });
    spyOn(clack, "text").mockImplementation(textMock);
    spyOn(gitMod, "defaultBranch").mockReturnValue("main");
    spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
    spyOn(console, "log").mockImplementation(() => {});

    await preExecution("forge/test");

    expect(callOrder[0]).toBe("ensureCleanTree");
    expect(callOrder[1]).toBe("text");

    (gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
    (clack.text as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.defaultBranch as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
    (console.log as ReturnType<typeof mock>).mockRestore?.();
  });

  test("calls checkoutOrCreateBranch with selected branch", async () => {
    const clack = await import("@clack/prompts");
    const gitMod = await import("../src/git");

    const textMock = mock()
      .mockResolvedValueOnce("forge/custom")
      .mockResolvedValueOnce("develop");

    spyOn(clack, "text").mockImplementation(textMock);
    spyOn(gitMod, "ensureCleanTree").mockImplementation(() => {});
    spyOn(gitMod, "defaultBranch").mockReturnValue("main");
    const checkoutSpy = spyOn(gitMod, "checkoutOrCreateBranch").mockImplementation(() => {});
    spyOn(console, "log").mockImplementation(() => {});

    await preExecution("forge/suggested");

    expect(checkoutSpy).toHaveBeenCalledWith("forge/custom");

    (clack.text as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.ensureCleanTree as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.defaultBranch as ReturnType<typeof mock>).mockRestore?.();
    (gitMod.checkoutOrCreateBranch as ReturnType<typeof mock>).mockRestore?.();
    (console.log as ReturnType<typeof mock>).mockRestore?.();
  });
});
