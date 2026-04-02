/** Tests for frontmatter utilities. */

import { describe, test, expect } from "bun:test";
import { parseFrontmatter, serializeFrontmatter } from "../src/frontmatter";

// --------------- parseFrontmatter ---------------

describe("parseFrontmatter", () => {
	test("parses frontmatter-delimited markdown", () => {
		const content = "---\ntitle: My Issue\nsource: github\n---\n# Body\nSome content.\n";
		const result = parseFrontmatter(content);
		expect(result.meta).toEqual({ title: "My Issue", source: "github" });
		expect(result.body).toBe("# Body\nSome content.\n");
	});

	test("returns empty meta for plain markdown (no frontmatter)", () => {
		const content = "# Just Markdown\nNo frontmatter here.\n";
		const result = parseFrontmatter(content);
		expect(result.meta).toEqual({});
		expect(result.body).toBe(content);
	});

	test("handles empty frontmatter block", () => {
		const content = "---\n---\nBody after empty frontmatter.\n";
		const result = parseFrontmatter(content);
		expect(result.meta).toEqual({});
		expect(result.body).toBe("Body after empty frontmatter.\n");
	});

	test("handles empty body", () => {
		const content = "---\nkey: value\n---\n";
		const result = parseFrontmatter(content);
		expect(result.meta).toEqual({ key: "value" });
		expect(result.body).toBe("");
	});

	test("handles special characters in values", () => {
		const content =
			'---\ntitle: Issue #42: Fix the "bug" (ASAP)\nurl: https://example.com/path?q=1&r=2\n---\nBody\n';
		const result = parseFrontmatter(content);
		expect(result.meta.title).toBe('Issue #42: Fix the "bug" (ASAP)');
		expect(result.meta.url).toBe("https://example.com/path?q=1&r=2");
		expect(result.body).toBe("Body\n");
	});

	test("handles colons in values", () => {
		const content = "---\ntitle: Step 1: Do the thing\n---\nBody\n";
		const result = parseFrontmatter(content);
		expect(result.meta.title).toBe("Step 1: Do the thing");
	});

	test("returns full body when --- appears but not at start", () => {
		const content = "Some text\n---\ntitle: not frontmatter\n---\nMore text\n";
		const result = parseFrontmatter(content);
		expect(result.meta).toEqual({});
		expect(result.body).toBe(content);
	});

	test("does not match --- embedded in a longer line as closing fence", () => {
		const content = "---\ntitle: test\n---notafence\n---\nBody\n";
		const result = parseFrontmatter(content);
		expect(result.meta).toEqual({ title: "test" });
		expect(result.body).toBe("Body\n");
	});

	test("returns full body when closing --- is missing", () => {
		const content = "---\ntitle: unclosed\nBody without closing delimiter.\n";
		const result = parseFrontmatter(content);
		expect(result.meta).toEqual({});
		expect(result.body).toBe(content);
	});

	test("handles completely empty string", () => {
		const result = parseFrontmatter("");
		expect(result.meta).toEqual({});
		expect(result.body).toBe("");
	});

	test("handles Windows-style line endings", () => {
		const content = "---\r\ntitle: Win\r\n---\r\nBody\r\n";
		const result = parseFrontmatter(content);
		expect(result.meta).toEqual({ title: "Win" });
		expect(result.body).toBe("Body\r\n");
	});
});

// --------------- serializeFrontmatter ---------------

describe("serializeFrontmatter", () => {
	test("produces frontmatter-delimited markdown", () => {
		const result = serializeFrontmatter({ title: "My Issue" }, "# Body\n");
		expect(result).toBe("---\ntitle: My Issue\n---\n# Body\n");
	});

	test("returns body as-is when meta is empty", () => {
		const body = "# Just body\nNo frontmatter.\n";
		expect(serializeFrontmatter({}, body)).toBe(body);
	});

	test("serializes multiple keys", () => {
		const result = serializeFrontmatter({ title: "T", source: "github" }, "Body\n");
		expect(result).toBe("---\ntitle: T\nsource: github\n---\nBody\n");
	});
});

// --------------- Round-trip ---------------

describe("Round-trip", () => {
	test("parse(serialize(meta, body)) returns original data", () => {
		const meta = { title: "My Issue", source: "github", number: "42" };
		const body = "# Issue\nSome detailed content.\n\n## Section\nMore content.\n";
		const serialized = serializeFrontmatter(meta, body);
		const result = parseFrontmatter(serialized);
		expect(result.meta).toEqual(meta);
		expect(result.body).toBe(body);
	});

	test("round-trip with empty meta returns body unchanged", () => {
		const body = "Plain markdown content.\n";
		const serialized = serializeFrontmatter({}, body);
		const result = parseFrontmatter(serialized);
		expect(result.meta).toEqual({});
		expect(result.body).toBe(body);
	});

	test("round-trip with special characters", () => {
		const meta = { title: "Fix: handle edge case #99" };
		const body = "Content with `code` and **bold**.\n";
		const serialized = serializeFrontmatter(meta, body);
		const result = parseFrontmatter(serialized);
		expect(result.meta).toEqual(meta);
		expect(result.body).toBe(body);
	});
});
