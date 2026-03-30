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

        def fake_run_local(name: str, iterations: str, runner_name: str) -> None:
            called["name"] = name
            called["iterations"] = iterations
            called["runner_name"] = runner_name

        monkeypatch.setattr(cli, "_run_local", fake_run_local)

        result = runner.invoke(
            app=cli.app,
            args=["run", "--local", "demo", "-i", "all"],
        )

        assert result.exit_code == 0
        assert called == {"name": "demo", "iterations": "all", "runner_name": "claude"}

    def test_routes_github_source(self, monkeypatch) -> None:
        called: dict[str, object] = {}

        def fake_run_github(number: int, iterations: str, runner_name: str) -> None:
            called["number"] = number
            called["iterations"] = iterations
            called["runner_name"] = runner_name

        monkeypatch.setattr(cli, "_run_github", fake_run_github)

        result = runner.invoke(
            app=cli.app,
            args=["run", "--github", "42", "-i", "all"],
        )

        assert result.exit_code == 0
        assert called == {
            "number": 42,
            "iterations": "all",
            "runner_name": "claude",
        }

    def test_custom_runner_flag(self, monkeypatch) -> None:
        called: dict[str, object] = {}

        def fake_run_local(name: str, iterations: str, runner_name: str) -> None:
            called["runner_name"] = runner_name

        monkeypatch.setattr(cli, "_run_local", fake_run_local)

        result = runner.invoke(
            app=cli.app,
            args=["run", "--local", "demo", "-i", "1", "--runner", "codex"],
        )

        assert result.exit_code == 0
        assert called["runner_name"] == "codex"

    def test_iterations_required(self) -> None:
        result = runner.invoke(
            app=cli.app,
            args=["run", "--local", "demo"],
        )
        assert result.exit_code != 0

    def test_help_shows_run(self) -> None:
        result = runner.invoke(app=cli.app, args=["--help"])

        assert result.exit_code == 0
        assert "run" in result.output

    def test_no_mode_flag(self) -> None:
        result = runner.invoke(
            app=cli.app,
            args=["run", "--local", "demo", "-m", "afk", "-i", "1"],
        )
        assert result.exit_code != 0


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
        result = runner.invoke(app=cli.app, args=["spec", "demo", "-i", "1"])

        assert result.exit_code != 0

    def test_prd_command_is_removed(self) -> None:
        result = runner.invoke(app=cli.app, args=["prd", "42", "-i", "1"])

        assert result.exit_code != 0


class TestForgeReport:
    def test_includes_runner_name(self) -> None:
        results = [
            cli.IterationResult(
                issue_number=1,
                issue_filename="Setup",
                success=True,
                elapsed_seconds=10.0,
            )
        ]
        report = cli._build_forge_report(results, runner_name="claude")
        assert "**Runner:** claude" in report

    def test_completed_issue_format(self) -> None:
        results = [
            cli.IterationResult(
                issue_number=1,
                issue_filename="Setup",
                success=True,
                elapsed_seconds=10.0,
            )
        ]
        report = cli._build_forge_report(results, runner_name="claude")
        assert "- #1 Setup: completed" in report

    def test_failed_issue_includes_error(self) -> None:
        results = [
            cli.IterationResult(
                issue_number=2,
                issue_filename="API endpoints",
                success=False,
                elapsed_seconds=30.0,
                error="max turns exceeded",
            )
        ]
        report = cli._build_forge_report(results, runner_name="claude")
        assert "- #2 API endpoints: failed — max turns exceeded" in report

    def test_failed_issue_unknown_error(self) -> None:
        results = [
            cli.IterationResult(
                issue_number=2,
                issue_filename="API endpoints",
                success=False,
                elapsed_seconds=30.0,
            )
        ]
        report = cli._build_forge_report(results, runner_name="claude")
        assert "failed — unknown error" in report

    def test_closes_prd(self) -> None:
        results = [
            cli.IterationResult(
                issue_number=1,
                issue_filename="Task",
                success=True,
                elapsed_seconds=1.0,
            )
        ]
        report = cli._build_forge_report(results, runner_name="claude", prd_number=42)
        assert "Closes #42" in report


class TestNaming:
    def test_local_uses_slugged_branch_suggestion(self, monkeypatch) -> None:
        prompts: list[str] = []

        class FakeSource:
            def __init__(self, name: str) -> None:
                assert name == "Customer Onboarding"

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
        monkeypatch.setattr(
            cli,
            "run_afk_loop",
            lambda **kwargs: [],
        )

        cli._run_local("Customer Onboarding", "1", "claude")

        assert prompts == ["forge/customer-onboarding"]

    def test_local_falls_back_when_slug_is_empty(self, monkeypatch) -> None:
        prompts: list[str] = []

        class FakeSource:
            def __init__(self, name: str) -> None:
                assert name == "!!!"

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
        monkeypatch.setattr(
            cli,
            "run_afk_loop",
            lambda **kwargs: [],
        )

        cli._run_local("!!!", "1", "claude")

        assert prompts == ["forge/spec"]

    def test_github_uses_slugged_branch_suggestion(self, monkeypatch) -> None:
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
            "run_afk_loop",
            lambda **kwargs: [],
        )

        cli._run_github(42, "1", "claude")

        assert prompts == ["forge/oauth-sso-polish"]

    def test_github_falls_back_to_issue_branch(self, monkeypatch) -> None:
        prompts: list[str] = []

        class FakeSource:
            def __init__(self, number: int) -> None:
                assert number == 42

            def get_prd(self) -> FakeGitHubPrd:
                return FakeGitHubPrd(number=42, title="!!!", body="PRD body")

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
            "run_afk_loop",
            lambda **kwargs: [],
        )

        cli._run_github(42, "1", "claude")

        assert prompts == ["forge/issue-42"]

    def test_github_uses_prd_title_for_pr_title(self, monkeypatch) -> None:
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

        cli._run_github(42, "all", "claude")

        assert captured["branch"] == "forge/improve-onboarding-flow"
        assert captured["pr_title"] == "Improve onboarding flow"
        assert captured["prd_number"] == 42
        assert captured["runner_name"] == "claude"

    def test_github_falls_back_to_prd_number_title(self, monkeypatch) -> None:
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

        cli._run_github(42, "all", "claude")

        assert captured["branch"] == "forge/issue-42"
        assert captured["pr_title"] == "PRD #42"
