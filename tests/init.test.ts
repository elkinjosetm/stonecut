/** Tests for init module — uses real temporary directories, no mocks. */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { init } from "../src/init";
import { loadConfig } from "../src/config";

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "stonecut-init-test-"));
	origCwd = process.cwd();
	process.chdir(tmpDir);
});

afterEach(() => {
	process.chdir(origCwd);
});

// --------------- Scaffolding ---------------

describe("init scaffolding", () => {
	test("creates config.json with default values", () => {
		init();
		const config = loadConfig();
		expect(config).toEqual({
			runner: "claude",
			baseBranch: "main",
			branchPrefix: "stonecut/",
		});
	});

	test("creates .gitignore with runtime artifact patterns", () => {
		init();
		const gitignore = readFileSync(join(tmpDir, ".stonecut", ".gitignore"), "utf-8");
		expect(gitignore).toContain("logs/");
		expect(gitignore).toContain("status.json");
		expect(gitignore).toContain("progress.txt");
	});

	test("creates .stonecut directory if it does not exist", () => {
		expect(existsSync(join(tmpDir, ".stonecut"))).toBe(false);
		init();
		expect(existsSync(join(tmpDir, ".stonecut"))).toBe(true);
	});

	test("works when .stonecut directory already exists but has no config", () => {
		mkdirSync(join(tmpDir, ".stonecut"), { recursive: true });
		init();
		expect(loadConfig()).not.toBeNull();
	});

	test("accepts explicit cwd parameter", () => {
		const otherDir = mkdtempSync(join(tmpdir(), "stonecut-init-cwd-"));
		init(otherDir);
		expect(loadConfig(otherDir)).toEqual({
			runner: "claude",
			baseBranch: "main",
			branchPrefix: "stonecut/",
		});
		expect(existsSync(join(otherDir, ".stonecut", ".gitignore"))).toBe(true);
	});
});

// --------------- Error cases ---------------

describe("init error handling", () => {
	test("errors if config.json already exists", () => {
		mkdirSync(join(tmpDir, ".stonecut"), { recursive: true });
		writeFileSync(join(tmpDir, ".stonecut", "config.json"), "{}");
		expect(() => init()).toThrow("already exists");
	});

	test("error message suggests removing the file", () => {
		mkdirSync(join(tmpDir, ".stonecut"), { recursive: true });
		writeFileSync(join(tmpDir, ".stonecut", "config.json"), "{}");
		expect(() => init()).toThrow("Remove it first");
	});
});
