import { describe, expect, mock, test } from "bun:test";
import { ClaudeRunner } from "../src/runners/claude.js";
import { CodexRunner } from "../src/runners/codex.js";
import { getRunner } from "../src/runners/index.js";

function makeStream(content: string): ReadableStream {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(content));
			controller.close();
		},
	});
}

function emptyStream(): ReadableStream {
	return new ReadableStream({
		start(c) {
			c.close();
		},
	});
}

/**
 * Run a test with Bun.spawn replaced by a mock. Restores the original after.
 */
async function withMockSpawn(spawner: (...args: unknown[]) => unknown, fn: () => Promise<void>) {
	const origSpawn = Bun.spawn;
	// @ts-expect-error — replacing global Bun.spawn for test
	Bun.spawn = spawner;
	try {
		await fn();
	} finally {
		Bun.spawn = origSpawn as typeof Bun.spawn;
	}
}

function mockSpawn(stdout: string, exitCode: number = 0) {
	return mock(() => ({
		exited: Promise.resolve(exitCode),
		stdout: makeStream(stdout),
		stderr: emptyStream(),
	}));
}

function mockSpawnThrows() {
	return mock(() => {
		throw new Error("spawn failed");
	});
}

describe("ClaudeRunner", () => {
	test("success subtype", async () => {
		const stdout = JSON.stringify({ subtype: "success", result: "done" });
		await withMockSpawn(mockSpawn(stdout), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(result.success).toBe(true);
			expect(result.exitCode).toBe(0);
			expect(result.error).toBeUndefined();
			expect(result.output).toBe(stdout);
			expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
		});
	});

	test("error_max_turns subtype", async () => {
		const stdout = JSON.stringify({ subtype: "error_max_turns" });
		await withMockSpawn(mockSpawn(stdout), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toBe("max turns exceeded");
		});
	});

	test("error_max_budget_usd subtype", async () => {
		const stdout = JSON.stringify({ subtype: "error_max_budget_usd" });
		await withMockSpawn(mockSpawn(stdout), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toBe("max budget exceeded");
		});
	});

	test("unknown error subtype", async () => {
		const stdout = JSON.stringify({ subtype: "error_something_else" });
		await withMockSpawn(mockSpawn(stdout), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toContain("error_something_else");
		});
	});

	test("binary not found", async () => {
		await withMockSpawn(mockSpawnThrows(), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});
	});

	test("non-object JSON (array)", async () => {
		await withMockSpawn(mockSpawn("[1,2,3]"), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toContain("not an object");
		});
	});

	test("malformed JSON", async () => {
		await withMockSpawn(mockSpawn("not json", 1), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toBe("malformed JSON output");
			expect(result.output).toBe("not json");
		});
	});

	test("no output", async () => {
		await withMockSpawn(mockSpawn("", 1), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toContain("no output");
			expect(result.output).toBeUndefined();
		});
	});

	test("measures duration", async () => {
		const stdout = JSON.stringify({ subtype: "success" });
		await withMockSpawn(mockSpawn(stdout), async () => {
			const result = await new ClaudeRunner().run("test prompt");
			expect(typeof result.durationSeconds).toBe("number");
			expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
		});
	});

	test("spawns correct command", async () => {
		const stdout = JSON.stringify({ subtype: "success" });
		let capturedCmd: string[] = [];
		const spawner = mock((cmd: unknown) => {
			capturedCmd = cmd as string[];
			return {
				exited: Promise.resolve(0),
				stdout: makeStream(stdout),
				stderr: emptyStream(),
			};
		});
		await withMockSpawn(spawner, async () => {
			await new ClaudeRunner().run("hello");
			expect(capturedCmd[0]).toBe("claude");
			expect(capturedCmd).toContain("-p");
			expect(capturedCmd).toContain("--output-format");
			expect(capturedCmd).toContain("json");
			expect(capturedCmd).toContain("--allowedTools");
		});
	});
});

describe("CodexRunner", () => {
	test("success", async () => {
		await withMockSpawn(mockSpawn("", 0), async () => {
			const result = await new CodexRunner().run("test prompt");
			expect(result.success).toBe(true);
			expect(result.exitCode).toBe(0);
			expect(result.error).toBeUndefined();
			expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
		});
	});

	test("turn.failed event", async () => {
		const jsonl = JSON.stringify({
			type: "turn.failed",
			error: { message: "context window exceeded" },
		});
		await withMockSpawn(mockSpawn(jsonl, 1), async () => {
			const result = await new CodexRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toBe("context window exceeded");
		});
	});

	test("error event", async () => {
		const jsonl = JSON.stringify({ type: "error", message: "rate limit hit" });
		await withMockSpawn(mockSpawn(jsonl, 1), async () => {
			const result = await new CodexRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toBe("rate limit hit");
		});
	});

	test("no recognizable JSONL", async () => {
		const stdout = JSON.stringify({ type: "turn.completed" }) + "\n";
		await withMockSpawn(mockSpawn(stdout, 1), async () => {
			const result = await new CodexRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toBe("codex exited with non-zero status");
		});
	});

	test("binary not found", async () => {
		await withMockSpawn(mockSpawnThrows(), async () => {
			const result = await new CodexRunner().run("test prompt");
			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});
	});

	test("measures duration", async () => {
		await withMockSpawn(mockSpawn("", 0), async () => {
			const result = await new CodexRunner().run("test prompt");
			expect(typeof result.durationSeconds).toBe("number");
			expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
		});
	});

	test("spawns correct command", async () => {
		let capturedCmd: string[] = [];
		const spawner = mock((cmd: unknown) => {
			capturedCmd = cmd as string[];
			return {
				exited: Promise.resolve(0),
				stdout: emptyStream(),
				stderr: emptyStream(),
			};
		});
		await withMockSpawn(spawner, async () => {
			await new CodexRunner().run("hello");
			expect(capturedCmd).toEqual(["codex", "exec", "--full-auto", "--json", "--ephemeral", "-"]);
		});
	});
});

describe("Runner registry", () => {
	test("get claude runner", () => {
		const runner = getRunner("claude");
		expect(runner).toBeInstanceOf(ClaudeRunner);
	});

	test("get codex runner", () => {
		const runner = getRunner("codex");
		expect(runner).toBeInstanceOf(CodexRunner);
	});

	test("unknown runner throws", () => {
		expect(() => getRunner("nope")).toThrow("Unknown runner 'nope'");
	});

	test("unknown runner lists available", () => {
		expect(() => getRunner("nope")).toThrow("claude");
	});
});
