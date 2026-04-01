/**
 * Tests for the Logger module.
 */

import { describe, expect, spyOn, test, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { Logger } from "../src/logger";

const TEST_LOG_DIR = join(".stonecut", "logs");

afterEach(() => {
	// Clean up test log files
	if (existsSync(TEST_LOG_DIR)) {
		rmSync(TEST_LOG_DIR, { recursive: true, force: true });
	}
});

describe("Logger", () => {
	test("creates .stonecut/logs/ directory", () => {
		const logger = new Logger("test-spec");
		expect(existsSync(TEST_LOG_DIR)).toBe(true);
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
});
