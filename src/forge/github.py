"""GitHub source — wraps the gh CLI to interact with GitHub issues."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass


@dataclass
class GitHubIssue:
    """A single sub-issue from a GitHub PRD."""

    number: int
    title: str
    body: str


class GitHubSource:
    """Reads and manages issues from a GitHub PRD."""

    def __init__(self, prd_number: int) -> None:
        self.prd_number = prd_number
        self._validate_gh_cli()
        self.owner, self.repo = self._get_owner_repo()
        self._validate_prd()

    @staticmethod
    def _validate_gh_cli() -> None:
        """Check that gh CLI is installed and authenticated."""
        try:
            subprocess.run(["gh", "--version"], capture_output=True, check=True)
        except FileNotFoundError:
            raise SystemExit(
                "Error: gh CLI is not installed. See https://cli.github.com"
            )
        result = subprocess.run(
            ["gh", "auth", "status"], capture_output=True, text=True
        )
        if result.returncode != 0:
            raise SystemExit(
                "Error: gh CLI is not authenticated. Run 'gh auth login'."
            )

    @staticmethod
    def _get_owner_repo() -> tuple[str, str]:
        """Extract owner/repo from the git remote origin URL."""
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise SystemExit("Error: could not determine git remote origin.")
        url = result.stdout.strip()

        # SSH: git@github.com:owner/repo.git
        match = re.match(r"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", url)
        if match:
            return match.group(1), match.group(2)

        # HTTPS or SSH protocol: https://github.com/owner/repo.git
        match = re.match(
            r"(?:https?|ssh)://[^/]*github\.com/([^/]+)/([^/]+?)(?:\.git)?$", url
        )
        if match:
            return match.group(1), match.group(2)

        raise SystemExit(
            f"Error: could not parse owner/repo from remote URL: {url}"
        )

    def _validate_prd(self) -> None:
        """Validate that the PRD issue exists and has the 'prd' label."""
        result = subprocess.run(
            [
                "gh", "issue", "view", str(self.prd_number),
                "--json", "labels", "-q", ".labels[].name",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise SystemExit(
                f"Error: GitHub issue #{self.prd_number} not found."
            )
        labels = [label for label in result.stdout.strip().split("\n") if label]
        if "prd" not in labels:
            raise SystemExit(
                f"Error: Issue #{self.prd_number} does not have the 'prd' label."
            )

    def get_prd_content(self) -> str:
        """Fetch and return the PRD issue body."""
        result = subprocess.run(
            [
                "gh", "issue", "view", str(self.prd_number),
                "--json", "body", "-q", ".body",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    def _fetch_sub_issues(self) -> list[dict]:
        """Fetch sub-issues of the PRD via the GraphQL API."""
        query = """
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
}"""
        result = subprocess.run(
            [
                "gh", "api", "graphql",
                "-F", f"owner={self.owner}",
                "-F", f"repo={self.repo}",
                "-F", f"number={self.prd_number}",
                "-f", f"query={query}",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise SystemExit(
                f"Error fetching sub-issues: {result.stderr.strip()}"
            )
        data = json.loads(result.stdout)
        return data["data"]["repository"]["issue"]["subIssues"]["nodes"]

    def get_next_issue(self) -> GitHubIssue | None:
        """Find the next open sub-issue sorted by number, or None if all complete."""
        sub_issues = self._fetch_sub_issues()
        open_issues = [i for i in sub_issues if i["state"] == "OPEN"]
        if not open_issues:
            return None
        open_issues.sort(key=lambda i: i["number"])
        first = open_issues[0]
        return GitHubIssue(
            number=first["number"],
            title=first["title"],
            body=first.get("body") or "",
        )

    def get_remaining_count(self) -> tuple[int, int]:
        """Return (remaining, total) sub-issue counts."""
        sub_issues = self._fetch_sub_issues()
        total = len(sub_issues)
        remaining = sum(1 for i in sub_issues if i["state"] == "OPEN")
        return remaining, total

    def complete_issue(self, issue: GitHubIssue) -> None:
        """Close the GitHub issue."""
        subprocess.run(
            ["gh", "issue", "close", str(issue.number)],
            capture_output=True,
            text=True,
            check=True,
        )
