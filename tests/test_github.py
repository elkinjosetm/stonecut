"""Tests for forge.github — mocks gh CLI subprocess calls."""

from __future__ import annotations

import json
from subprocess import CompletedProcess
from unittest.mock import patch

import pytest

from forge.github import GitHubIssue, GitHubPrd, GitHubSource


def _graphql_response(nodes: list[dict]) -> str:
    """Build a GraphQL sub-issues response JSON string."""
    return json.dumps(
        {
            "data": {
                "repository": {
                    "issue": {
                        "subIssues": {
                            "nodes": nodes,
                        }
                    }
                }
            }
        }
    )


@pytest.fixture()
def source():
    """Create a GitHubSource with __init__ side effects bypassed."""
    with (
        patch.object(GitHubSource, "_validate_gh_cli"),
        patch.object(GitHubSource, "_get_owner_repo", return_value=("owner", "repo")),
        patch.object(GitHubSource, "_validate_prd"),
    ):
        src = GitHubSource(42)
    return src


# --------------- gh CLI validation ---------------


class TestGhCliValidation:
    def test_error_when_gh_not_installed(self):
        with patch("forge.github.subprocess.run", side_effect=FileNotFoundError):
            with pytest.raises(SystemExit, match="gh CLI is not installed"):
                GitHubSource._validate_gh_cli()

    def test_error_when_gh_not_authenticated(self):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.side_effect = [
                CompletedProcess(args=[], returncode=0),
                CompletedProcess(args=[], returncode=1, stdout="", stderr=""),
            ]
            with pytest.raises(SystemExit, match="not authenticated"):
                GitHubSource._validate_gh_cli()


# --------------- PRD validation ---------------


class TestPrdValidation:
    def test_error_when_issue_not_found(self, source):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[], returncode=1, stdout="", stderr="not found"
            )
            with pytest.raises(SystemExit, match="not found"):
                source._validate_prd()

    def test_error_when_issue_lacks_prd_label(self, source):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[], returncode=0, stdout="bug\nenhancement\n", stderr=""
            )
            with pytest.raises(SystemExit, match="does not have the 'prd' label"):
                source._validate_prd()

    def test_success_when_issue_has_prd_label(self, source):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[], returncode=0, stdout="prd\nbug\n", stderr=""
            )
            source._validate_prd()
            mock_run.assert_called_once_with(
                [
                    "gh",
                    "issue",
                    "view",
                    "42",
                    "--json",
                    "labels",
                    "-q",
                    ".labels[].name",
                ],
                capture_output=True,
                text=True,
            )


# --------------- Repo extraction ---------------


class TestRepoExtraction:
    def test_parses_https_remote_url(self):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout="https://github.com/myowner/myrepo.git\n",
                stderr="",
            )
            owner, repo = GitHubSource._get_owner_repo()
            assert owner == "myowner"
            assert repo == "myrepo"

    def test_parses_ssh_remote_url(self):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout="git@github.com:myowner/myrepo.git\n",
                stderr="",
            )
            owner, repo = GitHubSource._get_owner_repo()
            assert owner == "myowner"
            assert repo == "myrepo"


# --------------- Sub-issue fetching ---------------


class TestSubIssueFetching:
    def test_parses_graphql_response(self, source):
        nodes = [
            {"number": 5, "title": "Task A", "state": "OPEN", "body": "Body A"},
            {"number": 3, "title": "Task B", "state": "CLOSED", "body": "Body B"},
        ]
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout=_graphql_response(nodes),
                stderr="",
            )
            result = source._fetch_sub_issues()
            assert len(result) == 2
            assert result[0]["number"] == 5
            assert result[1]["number"] == 3

    def test_finds_next_open_issue_sorted_by_number(self, source):
        nodes = [
            {"number": 10, "title": "Task C", "state": "OPEN", "body": "Body C"},
            {"number": 3, "title": "Task A", "state": "OPEN", "body": "Body A"},
            {"number": 7, "title": "Task B", "state": "CLOSED", "body": "Body B"},
        ]
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout=_graphql_response(nodes),
                stderr="",
            )
            issue = source.get_next_issue()
            assert issue is not None
            assert issue.number == 3
            assert issue.title == "Task A"
            assert issue.body == "Body A"

    def test_returns_none_when_all_complete(self, source):
        nodes = [
            {"number": 1, "title": "Done", "state": "CLOSED", "body": ""},
            {"number": 2, "title": "Also done", "state": "CLOSED", "body": ""},
        ]
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout=_graphql_response(nodes),
                stderr="",
            )
            assert source.get_next_issue() is None

    def test_handles_empty_sub_issues_list(self, source):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout=_graphql_response([]),
                stderr="",
            )
            assert source.get_next_issue() is None


# --------------- Issue closing ---------------


class TestIssueClosing:
    def test_calls_gh_issue_close(self, source):
        issue = GitHubIssue(number=7, title="Task", body="Body")
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[], returncode=0, stdout="", stderr=""
            )
            source.complete_issue(issue)
            mock_run.assert_called_once_with(
                ["gh", "issue", "close", "7"],
                capture_output=True,
                text=True,
                check=True,
            )


# --------------- Content fetching ---------------


class TestContentFetching:
    def test_fetches_prd_metadata(self, source):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps({"title": "Improve onboarding flow", "body": "PRD"}),
                stderr="",
            )
            prd = source.get_prd()
            assert prd == GitHubPrd(
                number=42,
                title="Improve onboarding flow",
                body="PRD",
            )
            mock_run.assert_called_once_with(
                [
                    "gh",
                    "issue",
                    "view",
                    "42",
                    "--json",
                    "title,body",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

    def test_fetches_prd_body(self, source):
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(
                    {"title": "Improve onboarding flow", "body": "PRD body content\n"}
                ),
                stderr="",
            )
            content = source.get_prd_content()
            assert content == "PRD body content"
            mock_run.assert_called_once_with(
                [
                    "gh",
                    "issue",
                    "view",
                    "42",
                    "--json",
                    "title,body",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

    def test_fetches_issue_body_from_sub_issues(self, source):
        nodes = [
            {
                "number": 5,
                "title": "Feature",
                "state": "OPEN",
                "body": "Issue body text",
            },
        ]
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout=_graphql_response(nodes),
                stderr="",
            )
            issue = source.get_next_issue()
            assert issue is not None
            assert issue.body == "Issue body text"


# --------------- Remaining count ---------------


class TestRemainingCount:
    def test_returns_correct_counts(self, source):
        nodes = [
            {"number": 1, "title": "A", "state": "OPEN", "body": ""},
            {"number": 2, "title": "B", "state": "CLOSED", "body": ""},
            {"number": 3, "title": "C", "state": "OPEN", "body": ""},
        ]
        with patch("forge.github.subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(
                args=[],
                returncode=0,
                stdout=_graphql_response(nodes),
                stderr="",
            )
            remaining, total = source.get_remaining_count()
            assert remaining == 2
            assert total == 3
