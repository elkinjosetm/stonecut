"""Local spec source — reads issues from .forge/<name>/."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass


@dataclass
class Issue:
    """A single issue from a local spec."""

    number: int
    filename: str
    path: Path
    content: str


class LocalSource:
    """Reads and manages issues from a local .forge/<name>/ spec directory."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.spec_dir = Path(".forge") / name
        self._validate()

    def _validate(self) -> None:
        """Validate that the spec directory exists with prd.md and issues/."""
        if not self.spec_dir.is_dir():
            raise SystemExit(f"Error: spec directory not found: {self.spec_dir}/")
        if not (self.spec_dir / "prd.md").is_file():
            raise SystemExit(f"Error: {self.spec_dir}/prd.md not found")
        if not (self.spec_dir / "issues").is_dir():
            raise SystemExit(f"Error: {self.spec_dir}/issues/ not found")

    def _status_path(self) -> Path:
        return self.spec_dir / "status.json"

    def _read_status(self) -> set[int]:
        """Read completed issue numbers from status.json, initializing if needed."""
        path = self._status_path()
        if not path.exists():
            path.write_text('{ "completed": [] }\n')
            return set()
        data = json.loads(path.read_text())
        return set(data.get("completed", []))

    def _all_issues(self) -> list[tuple[int, str, Path]]:
        """Return all issue files as (number, filename, path) sorted by number."""
        issues_dir = self.spec_dir / "issues"
        results = []
        for f in sorted(issues_dir.iterdir()):
            if f.suffix == ".md":
                match = re.match(r"^(\d+)", f.name)
                if match:
                    results.append((int(match.group(1)), f.name, f))
        return results

    def get_prd_content(self) -> str:
        """Read and return the PRD content."""
        return (self.spec_dir / "prd.md").read_text()

    def get_next_issue(self) -> Issue | None:
        """Find the next incomplete issue, or None if all are complete."""
        completed = self._read_status()
        for number, filename, path in self._all_issues():
            if number not in completed:
                return Issue(
                    number=number,
                    filename=filename,
                    path=path,
                    content=path.read_text(),
                )
        return None

    def get_remaining_count(self) -> tuple[int, int]:
        """Return (remaining, total) issue counts."""
        completed = self._read_status()
        all_issues = self._all_issues()
        total = len(all_issues)
        remaining = sum(1 for num, _, _ in all_issues if num not in completed)
        return remaining, total

    def complete_issue(self, issue: Issue) -> None:
        """Mark an issue as complete: update status.json and append to progress.txt."""
        # Update status.json
        path = self._status_path()
        if path.exists():
            data = json.loads(path.read_text())
        else:
            data = {"completed": []}
        completed = set(data.get("completed", []))
        completed.add(issue.number)
        data["completed"] = sorted(completed)
        path.write_text(json.dumps(data, indent=2) + "\n")

        # Append to progress.txt
        progress_path = self.spec_dir / "progress.txt"
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        with open(progress_path, "a") as f:
            f.write(f"{timestamp} — Issue {issue.number} complete: {issue.filename}\n")
