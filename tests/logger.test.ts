/**
 * Tests for the Logger module.
 */

import { describe, expect, spyOn, test, afterEach, beforeEach } from "bun:test";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Logger } from "../src/logger";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(tmpdir(), `stonecut-logger-test-${Date.now()}`);
	mkdirSync(tmpDir, { recursive: true });
	process.chdir(tmpDir);
});

afterEach(() => {
	process.chdir(join(import.meta.dir, ".."));
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("Logger", () => {
	test("creates .stonecut/logs/ directory", () => {
		const logger = new Logger("test-spec");
		expect(existsSync(join(tmpDir, ".stonecut", "logs"))).toBe(true);
		logger.close();
	});

	test("log file name matches <identifier>-<timestamp>.log pattern", () => {
		const logger = new Logger("test-spec");
		expect(logger.filePath).toMatch(/\.stonecut\/logs\/test-spec-\d{4}-\d{2}-\d{2}T.*\.log$/);
		logger.close();
	});

	test("log file contains timestamped lines", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const logger = new Logger("test-spec");
			logger.log("hello");
			logger.log("world");
			logger.close();

			const content = readFileSync(logger.filePath, "utf-8");
			const lines = content.trim().split("\n");
			expect(lines).toHaveLength(2);
			expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] hello$/);
			expect(lines[1]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] world$/);
		} finally {
			logSpy.mockRestore();
		}
	});

	test("writes to console.log with plain message", () => {
		const output: string[] = [];
		const logSpy = spyOn(console, "log").mockImplementation((...args) => {
			output.push(args.join(" "));
		});
		try {
			const logger = new Logger("test-spec");
			logger.log("hello");
			logger.close();

			expect(output).toContain("hello");
		} finally {
			logSpy.mockRestore();
		}
	});

	test("handles GitHub PRD identifier", () => {
		const logger = new Logger("prd-87");
		expect(logger.filePath).toMatch(/\.stonecut\/logs\/prd-87-\d{4}-\d{2}-\d{2}T.*\.log$/);
		logger.close();
	});

	test("close is safe to call multiple times", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const logger = new Logger("test-spec");
			logger.log("test");
			logger.close();
			logger.close();
		} finally {
			logSpy.mockRestore();
		}
	});

	test("recreates log directory if deleted mid-session", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const logger = new Logger("test-spec");
			logger.log("before");

			// Simulate runner deleting the logs directory
			rmSync(join(tmpDir, ".stonecut", "logs"), { recursive: true, force: true });

			logger.log("after");
			logger.close();

			// "before" is lost (old file deleted with directory), but session continues
			const content = readFileSync(logger.filePath, "utf-8");
			expect(content).toContain("after");
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy.mock.calls[0]?.[0]).toContain("session log was deleted during execution");
		} finally {
			errorSpy.mockRestore();
			logSpy.mockRestore();
		}
	});

	test("does not crash when log file is unwritable", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const logger = new Logger("test-spec");

			// Nuke the entire .stonecut directory and block recreation
			rmSync(join(tmpDir, ".stonecut"), { recursive: true, force: true });
			// Place a file where the directory needs to be, so mkdirSync fails
			writeFileSync(join(tmpDir, ".stonecut"), "");

			// Should not throw — log is best-effort
			expect(() => logger.log("still works")).not.toThrow();
			expect(() => logger.log("still broken")).not.toThrow();
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy.mock.calls[0]?.[0]).toContain("session log is unavailable");
		} finally {
			// Clean up the blocker file so afterEach can remove tmpDir
			rmSync(join(tmpDir, ".stonecut"), { force: true });
			errorSpy.mockRestore();
			logSpy.mockRestore();
		}
	});
});
