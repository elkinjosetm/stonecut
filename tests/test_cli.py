"""Tests for the primary Forge execution CLI."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

import forge.cli as cli

runner = CliRunner()


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
