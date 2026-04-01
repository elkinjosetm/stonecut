/** GitHub source — wraps the gh CLI to interact with GitHub issues. */

import type { GitHubIssue, GitHubPrd, Source } from "./types";

function runSync(cmd: string[]): { exitCode: number; stdout: string; stderr: string } {
	const proc = Bun.spawnSync(cmd, {
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: proc.exitCode,
		stdout: proc.stdout.toString(),
		stderr: proc.stderr.toString(),
	};
}

export class GitHubSource implements Source<GitHubIssue> {
	readonly prdNumber: number;
	readonly owner: string;
	readonly repo: string;

	constructor(prdNumber: number) {
		this.prdNumber = prdNumber;
		GitHubSource.validateGhCli();
		const [owner, repo] = GitHubSource.getOwnerRepo();
		this.owner = owner;
		this.repo = repo;
		this.validatePrd();
	}

	static validateGhCli(): void {
		try {
			runSync(["gh", "--version"]);
		} catch {
			throw new Error("Error: gh CLI is not installed. See https://cli.github.com");
		}
		const result = runSync(["gh", "auth", "status"]);
		if (result.exitCode !== 0) {
			throw new Error("Error: gh CLI is not authenticated. Run 'gh auth login'.");
		}
	}

	static getOwnerRepo(): [string, string] {
		const result = runSync(["git", "remote", "get-url", "origin"]);
		if (result.exitCode !== 0) {
			throw new Error("Error: could not determine git remote origin.");
		}
		const url = result.stdout.trim();

		// SSH: git@github.com:owner/repo.git
		const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
		if (sshMatch) {
			return [sshMatch[1], sshMatch[2]];
		}

		// HTTPS or SSH protocol: https://github.com/owner/repo.git
		const httpsMatch = url.match(
			/^(?:https?|ssh):\/\/[^/]*github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
		);
		if (httpsMatch) {
			return [httpsMatch[1], httpsMatch[2]];
		}

		throw new Error(`Error: could not parse owner/repo from remote URL: ${url}`);
	}

	validatePrd(): void {
		const result = runSync([
			"gh",
			"issue",
			"view",
			String(this.prdNumber),
			"--json",
			"labels",
			"-q",
			".labels[].name",
		]);
		if (result.exitCode !== 0) {
			throw new Error(`Error: GitHub issue #${this.prdNumber} not found.`);
		}
		const labels = result.stdout
			.trim()
			.split("\n")
			.filter((l) => l);
		if (!labels.includes("prd")) {
			throw new Error(`Error: Issue #${this.prdNumber} does not have the 'prd' label.`);
		}
	}

	async getPrdContent(): Promise<string> {
		const prd = this.getPrd();
		return prd.body;
	}

	getPrd(): GitHubPrd {
		const result = runSync(["gh", "issue", "view", String(this.prdNumber), "--json", "title,body"]);
		if (result.exitCode !== 0) {
			throw new Error(`Error: failed to fetch PRD issue #${this.prdNumber}.`);
		}
		const data = JSON.parse(result.stdout);
		return {
			number: this.prdNumber,
			title: (data.title ?? "").trim(),
			body: (data.body ?? "").trim(),
		};
	}

	private fetchSubIssues(): Array<{
		number: number;
		title: string;
		state: string;
		body: string;
	}> {
		const query = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      subIssues(first: 100) {
        nodes {
          number
          title
          state
          body
        }
      }
    }
  }
}`;
		const result = runSync([
			"gh",
			"api",
			"graphql",
			"-F",
			`owner=${this.owner}`,
			"-F",
			`repo=${this.repo}`,
			"-F",
			`number=${this.prdNumber}`,
			"-f",
			`query=${query}`,
		]);
		if (result.exitCode !== 0) {
			throw new Error(`Error fetching sub-issues: ${result.stderr.trim()}`);
		}
		const data = JSON.parse(result.stdout);
		return data.data.repository.issue.subIssues.nodes;
	}

	async getNextIssue(): Promise<GitHubIssue | null> {
		const subIssues = this.fetchSubIssues();
		const openIssues = subIssues
			.filter((i) => i.state === "OPEN")
			.sort((a, b) => a.number - b.number);
		if (openIssues.length === 0) {
			return null;
		}
		const first = openIssues[0];
		return {
			number: first.number,
			title: first.title,
			body: first.body ?? "",
		};
	}

	async getRemainingCount(): Promise<[number, number]> {
		const subIssues = this.fetchSubIssues();
		const total = subIssues.length;
		const remaining = subIssues.filter((i) => i.state === "OPEN").length;
		return [remaining, total];
	}

	async completeIssue(issue: GitHubIssue): Promise<void> {
		const result = runSync(["gh", "issue", "close", String(issue.number)]);
		if (result.exitCode !== 0) {
			throw new Error(`Error: failed to close issue #${issue.number}: ${result.stderr.trim()}`);
		}
	}
}
