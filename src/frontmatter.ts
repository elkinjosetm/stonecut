/** Frontmatter utilities — parse and serialize YAML frontmatter in markdown files. */

export interface Frontmatter {
	meta: Record<string, string>;
	body: string;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns empty meta and full body if no frontmatter is present.
 */
export function parseFrontmatter(content: string): Frontmatter {
	if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
		return { meta: {}, body: content };
	}

	const lineBreak = content.startsWith("---\r\n") ? "\r\n" : "\n";
	const fence = `${lineBreak}---`;
	let searchFrom = 3;
	let closingIndex = -1;
	while (true) {
		const idx = content.indexOf(fence, searchFrom);
		if (idx === -1) break;
		const afterFence = idx + fence.length;
		// Valid closing fence: followed by a newline or at end of string
		if (
			afterFence === content.length ||
			content[afterFence] === "\n" ||
			content[afterFence] === "\r"
		) {
			closingIndex = idx;
			break;
		}
		searchFrom = afterFence;
	}
	if (closingIndex === -1) {
		return { meta: {}, body: content };
	}

	const yamlBlock = content.slice(3 + lineBreak.length, closingIndex);
	const body = content.slice(closingIndex + lineBreak.length + 3);
	// Strip leading newline from body (the one right after closing ---)
	const trimmedBody = body.startsWith("\r\n")
		? body.slice(2)
		: body.startsWith("\n")
			? body.slice(1)
			: body;

	const meta: Record<string, string> = {};
	for (const line of yamlBlock.split(lineBreak)) {
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;
		const key = line.slice(0, colonIndex).trim();
		if (!key) continue;
		const value = line.slice(colonIndex + 1).trim();
		meta[key] = value;
	}

	return { meta, body: trimmedBody };
}

/**
 * Serialize metadata and body into a frontmatter-delimited markdown string.
 * If meta is empty, returns body as-is (no frontmatter block).
 */
export function serializeFrontmatter(meta: Record<string, string>, body: string): string {
	if (Object.keys(meta).length === 0) {
		return body;
	}

	const lines = Object.entries(meta).map(([key, value]) => `${key}: ${value}`);
	return `---\n${lines.join("\n")}\n---\n${body}`;
}
