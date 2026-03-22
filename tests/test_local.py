"""Tests for forge.local — uses real temporary directories, no mocks."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from forge.local import Issue, LocalSource


@pytest.fixture()
def spec_dir(tmp_path: Path) -> Path:
    """Create a valid spec directory structure and chdir into tmp_path."""
    name = "myspec"
    base = tmp_path / ".forge" / name
    issues = base / "issues"
    issues.mkdir(parents=True)
    (base / "prd.md").write_text("# My PRD\nSome requirements.\n")
    (issues / "01-first.md").write_text("First issue content")
    (issues / "02-second.md").write_text("Second issue content")
    (issues / "03-third.md").write_text("Third issue content")
    orig = os.getcwd()
    os.chdir(tmp_path)
    yield base
    os.chdir(orig)


# --------------- Spec validation ---------------


class TestValidation:
    def test_error_when_spec_dir_missing(self, tmp_path: Path) -> None:
        orig = os.getcwd()
        os.chdir(tmp_path)
        try:
            with pytest.raises(SystemExit, match="spec directory not found"):
                LocalSource("nonexistent")
        finally:
            os.chdir(orig)

    def test_error_when_prd_md_missing(self, tmp_path: Path) -> None:
        base = tmp_path / ".forge" / "bad"
        (base / "issues").mkdir(parents=True)
        orig = os.getcwd()
        os.chdir(tmp_path)
        try:
            with pytest.raises(SystemExit, match="prd.md not found"):
                LocalSource("bad")
        finally:
            os.chdir(orig)

    def test_error_when_issues_dir_missing(self, tmp_path: Path) -> None:
        base = tmp_path / ".forge" / "bad"
        base.mkdir(parents=True)
        (base / "prd.md").write_text("# PRD\n")
        orig = os.getcwd()
        os.chdir(tmp_path)
        try:
            with pytest.raises(SystemExit, match="issues/ not found"):
                LocalSource("bad")
        finally:
            os.chdir(orig)


# --------------- Issue discovery ---------------


class TestIssueDiscovery:
    def test_finds_issues_in_numerical_order(self, spec_dir: Path) -> None:
        source = LocalSource("myspec")
        issue = source.get_next_issue()
        assert issue is not None
        assert issue.number == 1
        assert issue.filename == "01-first.md"

    def test_skips_completed_issues(self, spec_dir: Path) -> None:
        (spec_dir / "status.json").write_text('{ "completed": [1] }\n')
        source = LocalSource("myspec")
        issue = source.get_next_issue()
        assert issue is not None
        assert issue.number == 2

    def test_returns_none_when_all_complete(self, spec_dir: Path) -> None:
        (spec_dir / "status.json").write_text('{ "completed": [1, 2, 3] }\n')
        source = LocalSource("myspec")
        assert source.get_next_issue() is None

    def test_handles_empty_issues_directory(self, tmp_path: Path) -> None:
        base = tmp_path / ".forge" / "empty"
        (base / "issues").mkdir(parents=True)
        (base / "prd.md").write_text("# PRD\n")
        orig = os.getcwd()
        os.chdir(tmp_path)
        try:
            source = LocalSource("empty")
            assert source.get_next_issue() is None
        finally:
            os.chdir(orig)


# --------------- Status initialization ---------------


class TestStatusInit:
    def test_creates_status_json_if_missing(self, spec_dir: Path) -> None:
        assert not (spec_dir / "status.json").exists()
        source = LocalSource("myspec")
        source.get_next_issue()
        status_path = spec_dir / "status.json"
        assert status_path.exists()
        data = json.loads(status_path.read_text())
        assert data == {"completed": []}


# --------------- Issue completion ---------------


class TestIssueCompletion:
    def test_updates_status_json(self, spec_dir: Path) -> None:
        source = LocalSource("myspec")
        issue = source.get_next_issue()
        assert issue is not None
        source.complete_issue(issue)
        data = json.loads((spec_dir / "status.json").read_text())
        assert 1 in data["completed"]

    def test_appends_to_progress_txt(self, spec_dir: Path) -> None:
        source = LocalSource("myspec")
        issue = source.get_next_issue()
        assert issue is not None
        source.complete_issue(issue)
        progress = (spec_dir / "progress.txt").read_text()
        assert "Issue 1 complete" in progress
        assert "01-first.md" in progress


# --------------- Content reading ---------------


class TestContentReading:
    def test_reads_prd_content(self, spec_dir: Path) -> None:
        source = LocalSource("myspec")
        content = source.get_prd_content()
        assert "# My PRD" in content
        assert "Some requirements." in content

    def test_reads_issue_content(self, spec_dir: Path) -> None:
        source = LocalSource("myspec")
        issue = source.get_next_issue()
        assert issue is not None
        assert issue.content == "First issue content"


# --------------- Remaining count ---------------


class TestRemainingCount:
    def test_returns_correct_counts(self, spec_dir: Path) -> None:
        source = LocalSource("myspec")
        remaining, total = source.get_remaining_count()
        assert remaining == 3
        assert total == 3

    def test_counts_after_completing_one(self, spec_dir: Path) -> None:
        (spec_dir / "status.json").write_text('{ "completed": [1] }\n')
        source = LocalSource("myspec")
        remaining, total = source.get_remaining_count()
        assert remaining == 2
        assert total == 3

    def test_counts_when_all_complete(self, spec_dir: Path) -> None:
        (spec_dir / "status.json").write_text('{ "completed": [1, 2, 3] }\n')
        source = LocalSource("myspec")
        remaining, total = source.get_remaining_count()
        assert remaining == 0
        assert total == 3
