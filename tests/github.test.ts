/** Tests for GitHubSource — mocks Bun.spawnSync for gh CLI calls. */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GitHubSource } from "../src/github";

/** Build a GraphQL sub-issues response JSON string. */
function graphqlResponse(
	nodes: Array<{
		number: number;
		title: string;
		state: string;
		body: string;
	}>,
): string {
	return JSON.stringify({
		data: {
			repository: {
				issue: {
					subIssues: { nodes },
				},
			},
		},
	});
}

type SpawnSyncResult = {
	exitCode: number;
	stdout: Buffer;
	stderr: Buffer;
};

function buf(s: string): Buffer {
	return Buffer.from(s);
}

function ok(stdout = ""): SpawnSyncResult {
	return { exitCode: 0, stdout: buf(stdout), stderr: buf("") };
}

function fail(stderr = "", stdout = ""): SpawnSyncResult {
	return { exitCode: 1, stdout: buf(stdout), stderr: buf(stderr) };
}

let origSpawnSync: typeof Bun.spawnSync;

beforeEach(() => {
	origSpawnSync = Bun.spawnSync;
});

afterEach(() => {
	Bun.spawnSync = origSpawnSync;
});

function withMockSpawnSync(handler: (cmd: string[]) => SpawnSyncResult): void {
	// @ts-expect-error — replacing global for test
	Bun.spawnSync = mock((cmd: string[]) => handler(cmd));
}

/** Create a GitHubSource with constructor side effects bypassed. */
function makeSource(): GitHubSource {
	withMockSpawnSync((cmd) => {
		const bin = cmd[0];
		if (bin === "gh" && cmd[1] === "--version") return ok("gh version 2.0.0");
		if (bin === "gh" && cmd[1] === "auth") return ok();
		if (bin === "git" && cmd[1] === "remote") return ok("git@github.com:owner/repo.git\n");
		if (bin === "gh" && cmd[1] === "issue" && cmd[2] === "view") return ok("prd\n");
		return fail("unexpected call");
	});
	const source = new GitHubSource(42);
	Bun.spawnSync = origSpawnSync;
	return source;
}

// --------------- gh CLI validation ---------------

describe("gh CLI validation", () => {
	test("error when gh not installed", () => {
		(Bun as any).spawnSync = () => {
			throw new Error("spawn failed");
		};
		expect(() => GitHubSource.validateGhCli()).toThrow("gh CLI is not installed");
	});

	test("error when gh not authenticated", () => {
		let callCount = 0;
		withMockSpawnSync(() => {
			callCount++;
			if (callCount === 1) return ok(); // gh --version
			return fail(); // gh auth status
		});
		expect(() => GitHubSource.validateGhCli()).toThrow("not authenticated");
	});
});

// --------------- PRD validation ---------------

describe("PRD validation", () => {
	test("error when issue not found", () => {
		const source = makeSource();
		withMockSpawnSync(() => fail("not found"));
		expect(() => source.validatePrd()).toThrow("not found");
	});

	test("error when issue lacks prd label", () => {
		const source = makeSource();
		withMockSpawnSync(() => ok("bug\nenhancement\n"));
		expect(() => source.validatePrd()).toThrow("does not have the 'prd' label");
	});

	test("success when issue has prd label", () => {
		const source = makeSource();
		const spawner = mock((_cmd: string[]) => ok("prd\nbug\n"));
		// @ts-expect-error — replacing global for test
		Bun.spawnSync = spawner;
		source.validatePrd();
		expect(spawner).toHaveBeenCalledTimes(1);
		const args = spawner.mock.calls[0][0] as string[];
		expect(args).toEqual(["gh", "issue", "view", "42", "--json", "labels", "-q", ".labels[].name"]);
	});
});

// --------------- Repo extraction ---------------

describe("Repo extraction", () => {
	test("parses HTTPS remote URL", () => {
		withMockSpawnSync(() => ok("https://github.com/myowner/myrepo.git\n"));
		const [owner, repo] = GitHubSource.getOwnerRepo();
		expect(owner).toBe("myowner");
		expect(repo).toBe("myrepo");
	});

	test("parses SSH remote URL", () => {
		withMockSpawnSync(() => ok("git@github.com:myowner/myrepo.git\n"));
		const [owner, repo] = GitHubSource.getOwnerRepo();
		expect(owner).toBe("myowner");
		expect(repo).toBe("myrepo");
	});
});

// --------------- Sub-issue fetching ---------------

describe("Sub-issue fetching", () => {
	test("parses graphql response", async () => {
		const source = makeSource();
		const nodes = [
			{ number: 5, title: "Task A", state: "OPEN", body: "Body A" },
			{ number: 3, title: "Task B", state: "CLOSED", body: "Body B" },
		];
		withMockSpawnSync(() => ok(graphqlResponse(nodes)));
		// Use getRemainingCount to indirectly verify fetchSubIssues
		const [remaining, total] = await source.getRemainingCount();
		expect(total).toBe(2);
		expect(remaining).toBe(1);
	});

	test("finds next open issue sorted by number", async () => {
		const source = makeSource();
		const nodes = [
			{ number: 10, title: "Task C", state: "OPEN", body: "Body C" },
			{ number: 3, title: "Task A", state: "OPEN", body: "Body A" },
			{ number: 7, title: "Task B", state: "CLOSED", body: "Body B" },
		];
		withMockSpawnSync(() => ok(graphqlResponse(nodes)));
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		expect(issue!.number).toBe(3);
		expect(issue!.title).toBe("Task A");
		expect(issue!.body).toBe("Body A");
	});

	test("returns null when all complete", async () => {
		const source = makeSource();
		const nodes = [
			{ number: 1, title: "Done", state: "CLOSED", body: "" },
			{ number: 2, title: "Also done", state: "CLOSED", body: "" },
		];
		withMockSpawnSync(() => ok(graphqlResponse(nodes)));
		expect(await source.getNextIssue()).toBeNull();
	});

	test("handles empty sub-issues list", async () => {
		const source = makeSource();
		withMockSpawnSync(() => ok(graphqlResponse([])));
		expect(await source.getNextIssue()).toBeNull();
	});
});

// --------------- Issue closing ---------------

describe("Issue closing", () => {
	test("calls gh issue close", async () => {
		const source = makeSource();
		const spawner = mock((_cmd: string[]) => ok());
		// @ts-expect-error — replacing global for test
		Bun.spawnSync = spawner;
		await source.completeIssue({ number: 7, title: "Task", body: "Body" });
		expect(spawner).toHaveBeenCalledTimes(1);
		const args = spawner.mock.calls[0][0] as string[];
		expect(args).toEqual(["gh", "issue", "close", "7"]);
	});
});

// --------------- Content fetching ---------------

describe("Content fetching", () => {
	test("fetches PRD metadata", () => {
		const source = makeSource();
		const spawner = mock((_cmd: string[]) =>
			ok(JSON.stringify({ title: "Improve onboarding flow", body: "PRD" })),
		);
		// @ts-expect-error — replacing global for test
		Bun.spawnSync = spawner;
		const prd = source.getPrd();
		expect(prd).toEqual({
			number: 42,
			title: "Improve onboarding flow",
			body: "PRD",
		});
		const args = spawner.mock.calls[0][0] as string[];
		expect(args).toEqual(["gh", "issue", "view", "42", "--json", "title,body"]);
	});

	test("fetches PRD body", async () => {
		const source = makeSource();
		const spawner = mock((_cmd: string[]) =>
			ok(
				JSON.stringify({
					title: "Improve onboarding flow",
					body: "PRD body content\n",
				}),
			),
		);
		// @ts-expect-error — replacing global for test
		Bun.spawnSync = spawner;
		const content = await source.getPrdContent();
		expect(content).toBe("PRD body content");
		const args = spawner.mock.calls[0][0] as string[];
		expect(args).toEqual(["gh", "issue", "view", "42", "--json", "title,body"]);
	});

	test("fetches issue body from sub-issues", async () => {
		const source = makeSource();
		const nodes = [
			{
				number: 5,
				title: "Feature",
				state: "OPEN",
				body: "Issue body text",
			},
		];
		withMockSpawnSync(() => ok(graphqlResponse(nodes)));
		const issue = await source.getNextIssue();
		expect(issue).not.toBeNull();
		expect(issue!.body).toBe("Issue body text");
	});
});

// --------------- Remaining count ---------------

describe("Remaining count", () => {
	test("returns correct counts", async () => {
		const source = makeSource();
		const nodes = [
			{ number: 1, title: "A", state: "OPEN", body: "" },
			{ number: 2, title: "B", state: "CLOSED", body: "" },
			{ number: 3, title: "C", state: "OPEN", body: "" },
		];
		withMockSpawnSync(() => ok(graphqlResponse(nodes)));
		const [remaining, total] = await source.getRemainingCount();
		expect(remaining).toBe(2);
		expect(total).toBe(3);
	});
});
