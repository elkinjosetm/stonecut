/** Local spec source — reads issues from .forge/<name>/. */

import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "fs";
import { join } from "path";
import type { Issue, Source } from "./types";

export class LocalSource implements Source<Issue> {
	readonly name: string;
	private readonly specDir: string;

	constructor(name: string) {
		this.name = name;
		this.specDir = join(".forge", name);
		this.validate();
	}

	private validate(): void {
		if (!existsSync(this.specDir) || !statSync(this.specDir).isDirectory()) {
			throw new Error(`Error: spec directory not found: ${this.specDir}/`);
		}
		if (
			!existsSync(join(this.specDir, "prd.md")) ||
			!statSync(join(this.specDir, "prd.md")).isFile()
		) {
			throw new Error(`Error: ${this.specDir}/prd.md not found`);
		}
		if (
			!existsSync(join(this.specDir, "issues")) ||
			!statSync(join(this.specDir, "issues")).isDirectory()
		) {
			throw new Error(`Error: ${this.specDir}/issues/ not found`);
		}
	}

	private statusPath(): string {
		return join(this.specDir, "status.json");
	}

	private readStatus(): Set<number> {
		const path = this.statusPath();
		if (!existsSync(path)) {
			writeFileSync(path, '{ "completed": [] }\n');
			return new Set();
		}
		const data = JSON.parse(readFileSync(path, "utf-8"));
		return new Set<number>(data.completed ?? []);
	}

	private allIssues(): Array<{ number: number; filename: string; path: string }> {
		const issuesDir = join(this.specDir, "issues");
		const entries = readdirSync(issuesDir).sort();
		const results: Array<{ number: number; filename: string; path: string }> = [];
		for (const name of entries) {
			if (!name.endsWith(".md")) continue;
			const match = name.match(/^(\d+)/);
			if (match) {
				results.push({
					number: parseInt(match[1], 10),
					filename: name,
					path: join(issuesDir, name),
				});
			}
		}
		return results;
	}

	async getPrdContent(): Promise<string> {
		return readFileSync(join(this.specDir, "prd.md"), "utf-8");
	}

	async getNextIssue(): Promise<Issue | null> {
		const completed = this.readStatus();
		for (const issue of this.allIssues()) {
			if (!completed.has(issue.number)) {
				return {
					number: issue.number,
					filename: issue.filename,
					path: issue.path,
					content: readFileSync(issue.path, "utf-8"),
				};
			}
		}
		return null;
	}

	async getRemainingCount(): Promise<[number, number]> {
		const completed = this.readStatus();
		const all = this.allIssues();
		const total = all.length;
		const remaining = all.filter((i) => !completed.has(i.number)).length;
		return [remaining, total];
	}

	async completeIssue(issue: Issue): Promise<void> {
		// Update status.json
		const path = this.statusPath();
		let data: { completed: number[] };
		if (existsSync(path)) {
			data = JSON.parse(readFileSync(path, "utf-8"));
		} else {
			data = { completed: [] };
		}
		const completed = new Set<number>(data.completed ?? []);
		completed.add(issue.number);
		data.completed = [...completed].sort((a, b) => a - b);
		writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

		// Append to progress.txt
		const now = new Date();
		const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
		appendFileSync(
			join(this.specDir, "progress.txt"),
			`${timestamp} — Issue ${issue.number} complete: ${issue.filename}\n`,
		);
	}
}
