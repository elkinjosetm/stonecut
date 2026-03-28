"""Tests for the primary Forge execution CLI."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from typer.testing import CliRunner

import forge.cli as cli

runner = CliRunner()


@dataclass
class FakeGitHubIssue:
    number: int
    title: str
    body: str


@dataclass
class FakeGitHubPrd:
    number: int
    title: str
    body: str


class TestRunCommand:
    def test_routes_local_source(self, monkeypatch) -> None:
        called: dict[str, object] = {}

        def fake_run_local(name: str, mode: cli.Mode, iterations: str | None) -> None:
            called["name"] = name
            called["mode"] = mode
            called["iterations"] = iterations

        monkeypatch.setattr(cli, "_run_local", fake_run_local)

        result = runner.invoke(
            app=cli.app,
            args=["run", "--local", "demo", "-m", "once"],
        )

        assert result.exit_code == 0
        assert called == {"name": "demo", "mode": cli.Mode.once, "iterations": None}

    def test_routes_github_source(self, monkeypatch) -> None:
        called: dict[str, object] = {}

        def fake_run_github(
            number: int, mode: cli.Mode, iterations: str | None
        ) -> None:
            called["number"] = number
            called["mode"] = mode
            called["iterations"] = iterations

        monkeypatch.setattr(cli, "_run_github", fake_run_github)

        result = runner.invoke(
            app=cli.app,
            args=["run", "--github", "42", "-m", "afk", "-i", "all"],
        )

        assert result.exit_code == 0
        assert called == {
            "number": 42,
            "mode": cli.Mode.afk,
            "iterations": "all",
        }

    def test_help_shows_run(self) -> None:
        result = runner.invoke(app=cli.app, args=["--help"])

        assert result.exit_code == 0
        assert "run" in result.output


class TestRunSourceValidation:
    def test_requires_one_source(self) -> None:
        with pytest.raises(cli.typer.BadParameter, match="required"):
            cli._validate_run_source(None, None)

    def test_rejects_multiple_sources(self) -> None:
        with pytest.raises(cli.typer.BadParameter, match="exactly one"):
            cli._validate_run_source("demo", 42)

    def test_accepts_local_source(self) -> None:
        assert cli._validate_run_source("demo", None) == ("local", "demo")

    def test_accepts_github_source(self) -> None:
        assert cli._validate_run_source(None, 42) == ("github", 42)


class TestLegacyCommandRemoval:
    def test_spec_command_is_removed(self) -> None:
        result = runner.invoke(app=cli.app, args=["spec", "demo", "-m", "once"])

        assert result.exit_code != 0

    def test_prd_command_is_removed(self) -> None:
        result = runner.invoke(app=cli.app, args=["prd", "42", "-m", "once"])

        assert result.exit_code != 0


class TestGitHubNaming:
    def test_local_once_uses_slugged_branch_suggestion(self, monkeypatch) -> None:
        prompts: list[str] = []

        class FakeSource:
            def __init__(self, name: str) -> None:
                assert name == "Customer Onboarding"

            def get_next_issue(self):
                return type(
                    "FakeLocalIssue",
                    (),
                    {"number": 7, "filename": "issue.md", "content": "Issue body"},
                )()

            def get_remaining_count(self) -> tuple[int, int]:
                return (1, 3)

            def get_prd_content(self) -> str:
                return "PRD body"

            @property
            def spec_dir(self) -> str:
                return ".forge/Customer Onboarding"

        monkeypatch.setattr(cli, "LocalSource", FakeSource)
        monkeypatch.setattr(
            cli,
            "_pre_execution",
            lambda suggested_branch: (
                prompts.append(suggested_branch) or (suggested_branch, "main")
            ),
        )
        monkeypatch.setattr(cli, "run_interactive", lambda prompt: None)

        cli._run_local("Customer Onboarding", cli.Mode.once, None)

        assert prompts == ["forge/customer-onboarding"]

    def test_local_once_falls_back_when_slug_is_empty(self, monkeypatch) -> None:
        prompts: list[str] = []

        class FakeSource:
            def __init__(self, name: str) -> None:
                assert name == "!!!"

            def get_next_issue(self):
                return type(
                    "FakeLocalIssue",
                    (),
                    {"number": 7, "filename": "issue.md", "content": "Issue body"},
                )()

            def get_remaining_count(self) -> tuple[int, int]:
                return (1, 3)

            def get_prd_content(self) -> str:
                return "PRD body"

            @property
            def spec_dir(self) -> str:
                return ".forge/!!!"

        monkeypatch.setattr(cli, "LocalSource", FakeSource)
        monkeypatch.setattr(
            cli,
            "_pre_execution",
            lambda suggested_branch: (
                prompts.append(suggested_branch) or (suggested_branch, "main")
            ),
        )
        monkeypatch.setattr(cli, "run_interactive", lambda prompt: None)

        cli._run_local("!!!", cli.Mode.once, None)

        assert prompts == ["forge/spec"]

    def test_github_once_uses_slugged_branch_suggestion(self, monkeypatch) -> None:
        prompts: list[str] = []

        class FakeSource:
            def __init__(self, number: int) -> None:
                assert number == 42

            def get_prd(self) -> FakeGitHubPrd:
                return FakeGitHubPrd(
                    number=42,
                    title="OAuth / SSO polish",
                    body="PRD body",
                )

            def get_next_issue(self) -> FakeGitHubIssue:
                return FakeGitHubIssue(number=7, title="Task", body="Issue body")

            def get_remaining_count(self) -> tuple[int, int]:
                return (1, 3)

        monkeypatch.setattr(cli, "GitHubSource", FakeSource)
        monkeypatch.setattr(
            cli,
            "_pre_execution",
            lambda suggested_branch: (
                prompts.append(suggested_branch) or (suggested_branch, "main")
            ),
        )
        monkeypatch.setattr(
            cli,
            "run_interactive",
            lambda prompt: prompts.append(prompt),
        )

        cli._run_github(42, cli.Mode.once, None)

        assert prompts[0] == "forge/oauth-sso-polish"
        assert "PRD body" in prompts[1]

    def test_github_once_falls_back_to_issue_branch(self, monkeypatch) -> None:
        prompts: list[str] = []

        class FakeSource:
            def __init__(self, number: int) -> None:
                assert number == 42

            def get_prd(self) -> FakeGitHubPrd:
                return FakeGitHubPrd(number=42, title="!!!", body="PRD body")

            def get_next_issue(self) -> FakeGitHubIssue:
                return FakeGitHubIssue(number=7, title="Task", body="Issue body")

            def get_remaining_count(self) -> tuple[int, int]:
                return (1, 3)

        monkeypatch.setattr(cli, "GitHubSource", FakeSource)
        monkeypatch.setattr(
            cli,
            "_pre_execution",
            lambda suggested_branch: (
                prompts.append(suggested_branch) or (suggested_branch, "main")
            ),
        )
        monkeypatch.setattr(cli, "run_interactive", lambda prompt: None)

        cli._run_github(42, cli.Mode.once, None)

        assert prompts == ["forge/issue-42"]

    def test_github_afk_uses_prd_title_for_pr_title(self, monkeypatch) -> None:
        captured: dict[str, object] = {}

        class FakeSource:
            def __init__(self, number: int) -> None:
                assert number == 42

            def get_prd(self) -> FakeGitHubPrd:
                return FakeGitHubPrd(
                    number=42,
                    title="Improve onboarding flow",
                    body="PRD body",
                )

        monkeypatch.setattr(cli, "GitHubSource", FakeSource)
        monkeypatch.setattr(
            cli, "_pre_execution", lambda suggested_branch: (suggested_branch, "main")
        )
        monkeypatch.setattr(
            cli,
            "run_afk_loop",
            lambda **kwargs: [
                cli.IterationResult(
                    issue_number=7,
                    issue_filename="Task",
                    success=True,
                    elapsed_seconds=1.0,
                )
            ],
        )

        def fake_push_and_create_pr(**kwargs) -> None:
            captured.update(kwargs)

        monkeypatch.setattr(cli, "_push_and_create_pr", fake_push_and_create_pr)

        cli._run_github(42, cli.Mode.afk, "all")

        assert captured["branch"] == "forge/improve-onboarding-flow"
        assert captured["pr_title"] == "Improve onboarding flow"
        assert captured["prd_number"] == 42

    def test_github_afk_falls_back_to_prd_number_title(self, monkeypatch) -> None:
        captured: dict[str, object] = {}

        class FakeSource:
            def __init__(self, number: int) -> None:
                assert number == 42

            def get_prd(self) -> FakeGitHubPrd:
                return FakeGitHubPrd(number=42, title="", body="PRD body")

        monkeypatch.setattr(cli, "GitHubSource", FakeSource)
        monkeypatch.setattr(
            cli, "_pre_execution", lambda suggested_branch: (suggested_branch, "main")
        )
        monkeypatch.setattr(
            cli,
            "run_afk_loop",
            lambda **kwargs: [
                cli.IterationResult(
                    issue_number=7,
                    issue_filename="Task",
                    success=True,
                    elapsed_seconds=1.0,
                )
            ],
        )

        def fake_push_and_create_pr(**kwargs) -> None:
            captured.update(kwargs)

        monkeypatch.setattr(cli, "_push_and_create_pr", fake_push_and_create_pr)

        cli._run_github(42, cli.Mode.afk, "all")

        assert captured["branch"] == "forge/issue-42"
        assert captured["pr_title"] == "PRD #42"
