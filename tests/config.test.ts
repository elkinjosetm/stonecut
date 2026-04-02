/** Tests for config module — uses real temporary directories, no mocks. */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { loadConfig, writeDefaultConfig } from "../src/config";

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "stonecut-config-test-"));
	origCwd = process.cwd();
	process.chdir(tmpDir);
});

afterEach(() => {
	process.chdir(origCwd);
});

// --------------- loadConfig ---------------

describe("loadConfig", () => {
	test("returns null when no config file exists", () => {
		expect(loadConfig()).toBeNull();
	});

	test("returns null when .stonecut dir exists but no config.json", () => {
		mkdirSync(join(tmpDir, ".stonecut"), { recursive: true });
		expect(loadConfig()).toBeNull();
	});

	test("parses valid config", () => {
		mkdirSync(join(tmpDir, ".stonecut"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".stonecut", "config.json"),
			JSON.stringify({ runner: "codex", baseBranch: "develop", branchPrefix: "feat/" }),
		);
		const config = loadConfig();
		expect(config).toEqual({
			runner: "codex",
			baseBranch: "develop",
			branchPrefix: "feat/",
		});
	});

	test("parses partial config", () => {
		mkdirSync(join(tmpDir, ".stonecut"), { recursive: true });
		writeFileSync(join(tmpDir, ".stonecut", "config.json"), JSON.stringify({ runner: "claude" }));
		const config = loadConfig();
		expect(config).toEqual({ runner: "claude" });
	});

	test("handles malformed JSON gracefully", () => {
		mkdirSync(join(tmpDir, ".stonecut"), { recursive: true });
		writeFileSync(join(tmpDir, ".stonecut", "config.json"), "not json {{{");
		const config = loadConfig();
		expect(config).toEqual({});
	});

	test("accepts explicit cwd parameter", () => {
		const otherDir = mkdtempSync(join(tmpdir(), "stonecut-config-cwd-"));
		mkdirSync(join(otherDir, ".stonecut"), { recursive: true });
		writeFileSync(join(otherDir, ".stonecut", "config.json"), JSON.stringify({ runner: "codex" }));
		expect(loadConfig(otherDir)).toEqual({ runner: "codex" });
	});
});

// --------------- writeDefaultConfig ---------------

describe("writeDefaultConfig", () => {
	test("creates config file with default values", () => {
		writeDefaultConfig();
		const config = loadConfig();
		expect(config).toEqual({
			runner: "claude",
			baseBranch: "main",
			branchPrefix: "stonecut/",
		});
	});

	test("creates .stonecut directory if missing", () => {
		writeDefaultConfig();
		const config = loadConfig();
		expect(config).not.toBeNull();
	});

	test("accepts explicit cwd parameter", () => {
		const otherDir = mkdtempSync(join(tmpdir(), "stonecut-config-write-"));
		writeDefaultConfig(otherDir);
		const config = loadConfig(otherDir);
		expect(config).toEqual({
			runner: "claude",
			baseBranch: "main",
			branchPrefix: "stonecut/",
		});
	});
});
