/** Tests for local source — uses real temporary directories, no mocks. */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { LocalSource } from "../src/local";

let tmpDir: string;
let origCwd: string;

function createSpecDir(base: string, name: string): string {
	const specDir = join(base, ".stonecut", name);
	const issuesDir = join(specDir, "issues");
	mkdirSync(issuesDir, { recursive: true });
	writeFileSync(join(specDir, "prd.md"), "# My PRD\nSome requirements.\n");
	writeFileSync(join(issuesDir, "01-first.md"), "First issue content");
	writeFileSync(join(issuesDir, "02-second.md"), "Second issue content");
	writeFileSync(join(issuesDir, "03-third.md"), "Third issue content");
	return specDir;
}

// --------------- Spec validation ---------------

describe("Validation", () => {
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "stonecut-test-"));
		origCwd = process.cwd();
		process.chdir(tmpDir);
	});

	afterEach(() => {
		process.chdir(origCwd);
	});

	test("error when spec dir missing", () => {
		expect(() => new LocalSource("nonexistent")).toThrow("spec directory not found");
	});

	test("error when prd.md missing", () => {
		const base = join(tmpDir, ".stonecut", "bad");
		mkdirSync(join(base, "issues"), { recursive: true });
		expect(() => new LocalSource("bad")).toThrow("prd.md not found");
	});

	test("error when issues dir missing", () => {
		const base = join(tmpDir, ".stonecut", "bad");
		mkdirSync(base, { recursive: true });
		writeFileSync(join(base, "prd.md"), "# PRD\n");
		expect(() => new LocalSource("bad")).toThrow("issues/ not found");
	});
});

// --------------- Issue discovery ---------------

describe("Issue discovery", () => {
	let specDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "stonecut-test-"));
		origCwd = process.cwd();
		process.chdir(tmpDir);
		specDir = createSpecDir(tmpDir, "myspec");
	});

	afterEach(() => {
		process.chdir(origCwd);
	});

	test("finds issues in numerical order", async () => {
		const source = new LocalSource("myspec");
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		expect(issue!.number).toBe(1);
		expect(issue!.filename).toBe("01-first.md");
	});

	test("skips completed issues", async () => {
		writeFileSync(join(specDir, "status.json"), '{ "completed": [1] }\n');
		const source = new LocalSource("myspec");
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		expect(issue!.number).toBe(2);
	});

	test("returns null when all complete", async () => {
		writeFileSync(join(specDir, "status.json"), '{ "completed": [1, 2, 3] }\n');
		const source = new LocalSource("myspec");
		expect(await source.getNextIssue()).toBeNull();
	});

	test("handles empty issues directory", () => {
		const emptyTmp = mkdtempSync(join(tmpdir(), "stonecut-test-"));
		const prevCwd = process.cwd();
		process.chdir(emptyTmp);
		try {
			const base = join(emptyTmp, ".stonecut", "empty");
			mkdirSync(join(base, "issues"), { recursive: true });
			writeFileSync(join(base, "prd.md"), "# PRD\n");
			const source = new LocalSource("empty");
			expect(source.getNextIssue()).resolves.toBeNull();
		} finally {
			process.chdir(prevCwd);
		}
	});
});

// --------------- Status initialization ---------------

describe("Status initialization", () => {
	let specDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "stonecut-test-"));
		origCwd = process.cwd();
		process.chdir(tmpDir);
		specDir = createSpecDir(tmpDir, "myspec");
	});

	afterEach(() => {
		process.chdir(origCwd);
	});

	test("creates status.json if missing", async () => {
		expect(existsSync(join(specDir, "status.json"))).toBe(false);
		const source = new LocalSource("myspec");
		await source.getNextIssue();
		const statusPath = join(specDir, "status.json");
		expect(existsSync(statusPath)).toBe(true);
		const data = JSON.parse(readFileSync(statusPath, "utf-8"));
		expect(data).toEqual({ completed: [] });
	});
});

// --------------- Issue completion ---------------

describe("Issue completion", () => {
	let specDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "stonecut-test-"));
		origCwd = process.cwd();
		process.chdir(tmpDir);
		specDir = createSpecDir(tmpDir, "myspec");
	});

	afterEach(() => {
		process.chdir(origCwd);
	});

	test("updates status.json", async () => {
		const source = new LocalSource("myspec");
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		await source.completeIssue(issue!);
		const data = JSON.parse(readFileSync(join(specDir, "status.json"), "utf-8"));
		expect(data.completed).toContain(1);
	});

	test("appends to progress.txt", async () => {
		const source = new LocalSource("myspec");
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		await source.completeIssue(issue!);
		const progress = readFileSync(join(specDir, "progress.txt"), "utf-8");
		expect(progress).toContain("Issue 1 complete");
		expect(progress).toContain("01-first.md");
	});
});

// --------------- Content reading ---------------

describe("Content reading", () => {
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "stonecut-test-"));
		origCwd = process.cwd();
		process.chdir(tmpDir);
		createSpecDir(tmpDir, "myspec");
	});

	afterEach(() => {
		process.chdir(origCwd);
	});

	test("reads prd content", async () => {
		const source = new LocalSource("myspec");
		const content = await source.getPrdContent();
		expect(content).toContain("# My PRD");
		expect(content).toContain("Some requirements.");
	});

	test("reads issue content", async () => {
		const source = new LocalSource("myspec");
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		expect(issue!.content).toBe("First issue content");
	});
});

// --------------- Frontmatter integration ---------------

describe("Frontmatter integration", () => {
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "stonecut-test-"));
		origCwd = process.cwd();
		process.chdir(tmpDir);
	});

	afterEach(() => {
		process.chdir(origCwd);
	});

	test("strips frontmatter from issue content", async () => {
		const specDir = join(tmpDir, ".stonecut", "fm");
		const issuesDir = join(specDir, "issues");
		mkdirSync(issuesDir, { recursive: true });
		writeFileSync(join(specDir, "prd.md"), "# PRD\n");
		writeFileSync(
			join(issuesDir, "01-first.md"),
			"---\nsource: github\nissue: 42\n---\n# Issue Body\nActual content.\n",
		);

		const source = new LocalSource("fm");
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		expect(issue!.content).toBe("# Issue Body\nActual content.\n");
	});

	test("plain markdown issues still work (no frontmatter)", async () => {
		const specDir = join(tmpDir, ".stonecut", "plain");
		const issuesDir = join(specDir, "issues");
		mkdirSync(issuesDir, { recursive: true });
		writeFileSync(join(specDir, "prd.md"), "# PRD\n");
		writeFileSync(join(issuesDir, "01-plain.md"), "Just plain markdown.");

		const source = new LocalSource("plain");
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		expect(issue!.content).toBe("Just plain markdown.");
	});

	test("strips frontmatter from PRD content", async () => {
		const specDir = join(tmpDir, ".stonecut", "fmprd");
		const issuesDir = join(specDir, "issues");
		mkdirSync(issuesDir, { recursive: true });
		writeFileSync(join(specDir, "prd.md"), "---\ntitle: My PRD\n---\n# PRD Body\nRequirements.\n");
		writeFileSync(join(issuesDir, "01-first.md"), "Issue content");

		const source = new LocalSource("fmprd");
		const content = await source.getPrdContent();
		expect(content).toBe("# PRD Body\nRequirements.\n");
	});
});

// --------------- Remaining count ---------------

describe("Remaining count", () => {
	let specDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "stonecut-test-"));
		origCwd = process.cwd();
		process.chdir(tmpDir);
		specDir = createSpecDir(tmpDir, "myspec");
	});

	afterEach(() => {
		process.chdir(origCwd);
	});

	test("returns correct counts", async () => {
		const source = new LocalSource("myspec");
		const [remaining, total] = await source.getRemainingCount();
		expect(remaining).toBe(3);
		expect(total).toBe(3);
	});

	test("counts after completing one", async () => {
		writeFileSync(join(specDir, "status.json"), '{ "completed": [1] }\n');
		const source = new LocalSource("myspec");
		const [remaining, total] = await source.getRemainingCount();
		expect(remaining).toBe(2);
		expect(total).toBe(3);
	});

	test("counts when all complete", async () => {
		writeFileSync(join(specDir, "status.json"), '{ "completed": [1, 2, 3] }\n');
		const source = new LocalSource("myspec");
		const [remaining, total] = await source.getRemainingCount();
		expect(remaining).toBe(0);
		expect(total).toBe(3);
	});
});
