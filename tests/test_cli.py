"""Tests for the primary Forge execution CLI."""

from __future__ import annotations

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

    def test_requires_exactly_one_source(self) -> None:
        result = runner.invoke(app=cli.app, args=["run", "-m", "once"])

        assert result.exit_code != 0
        assert "One of --local or --github is required." in result.output

    def test_rejects_multiple_sources(self) -> None:
        result = runner.invoke(
            app=cli.app,
            args=["run", "--local", "demo", "--github", "42", "-m", "once"],
        )

        assert result.exit_code != 0
        assert "Use exactly one of --local or --github." in result.output

    def test_help_shows_run_not_legacy_aliases(self) -> None:
        result = runner.invoke(app=cli.app, args=["--help"])

        assert result.exit_code == 0
        assert "│ run" in result.output
        assert "│ spec" not in result.output
        assert "│ prd" not in result.output


class TestLegacyAliases:
    def test_spec_alias_still_works(self, monkeypatch) -> None:
        called: dict[str, object] = {}

        def fake_run_local(name: str, mode: cli.Mode, iterations: str | None) -> None:
            called["name"] = name
            called["mode"] = mode
            called["iterations"] = iterations

        monkeypatch.setattr(cli, "_run_local", fake_run_local)

        result = runner.invoke(app=cli.app, args=["spec", "demo", "-m", "once"])

        assert result.exit_code == 0
        assert called == {"name": "demo", "mode": cli.Mode.once, "iterations": None}

    def test_prd_alias_still_works(self, monkeypatch) -> None:
        called: dict[str, object] = {}

        def fake_run_github(
            number: int, mode: cli.Mode, iterations: str | None
        ) -> None:
            called["number"] = number
            called["mode"] = mode
            called["iterations"] = iterations

        monkeypatch.setattr(cli, "_run_github", fake_run_github)

        result = runner.invoke(app=cli.app, args=["prd", "42", "-m", "once"])

        assert result.exit_code == 0
        assert called == {"number": 42, "mode": cli.Mode.once, "iterations": None}
