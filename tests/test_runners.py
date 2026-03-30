"""Tests for the runner abstraction layer and registry."""

from __future__ import annotations

import json
import subprocess

import pytest

from forge.runner import Runner, RunResult
from forge.runners import get_runner
from forge.runners.claude import ClaudeRunner


class TestRunResult:
    def test_defaults(self) -> None:
        result = RunResult(success=True, exit_code=0, duration_seconds=1.5)
        assert result.output is None
        assert result.error is None

    def test_all_fields(self) -> None:
        result = RunResult(
            success=False,
            exit_code=1,
            duration_seconds=42.0,
            output="some output",
            error="something went wrong",
        )
        assert result.success is False
        assert result.exit_code == 1
        assert result.duration_seconds == 42.0
        assert result.output == "some output"
        assert result.error == "something went wrong"


class TestRunnerProtocol:
    def test_claude_runner_satisfies_protocol(self) -> None:
        assert isinstance(ClaudeRunner(), Runner)


class TestRegistry:
    def test_get_claude_runner(self) -> None:
        runner = get_runner("claude")
        assert isinstance(runner, ClaudeRunner)

    def test_unknown_runner_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown runner 'nope'"):
            get_runner("nope")

    def test_unknown_runner_lists_available(self) -> None:
        with pytest.raises(ValueError, match="claude"):
            get_runner("nope")


def _make_completed_process(
    stdout: str = "", returncode: int = 0
) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["claude"], returncode=returncode, stdout=stdout, stderr=""
    )


class TestClaudeRunner:
    def test_success_subtype(self, monkeypatch) -> None:
        output = json.dumps({"subtype": "success", "result": "done"})
        monkeypatch.setattr(
            subprocess, "run", lambda *a, **kw: _make_completed_process(stdout=output)
        )
        result = ClaudeRunner().run("test prompt")
        assert result.success is True
        assert result.exit_code == 0
        assert result.error is None
        assert result.output == output
        assert result.duration_seconds >= 0

    def test_error_max_turns(self, monkeypatch) -> None:
        output = json.dumps({"subtype": "error_max_turns"})
        monkeypatch.setattr(
            subprocess, "run", lambda *a, **kw: _make_completed_process(stdout=output)
        )
        result = ClaudeRunner().run("test prompt")
        assert result.success is False
        assert result.error == "max turns exceeded"

    def test_error_max_budget(self, monkeypatch) -> None:
        output = json.dumps({"subtype": "error_max_budget_usd"})
        monkeypatch.setattr(
            subprocess, "run", lambda *a, **kw: _make_completed_process(stdout=output)
        )
        result = ClaudeRunner().run("test prompt")
        assert result.success is False
        assert result.error == "max budget exceeded"

    def test_unknown_error_subtype(self, monkeypatch) -> None:
        output = json.dumps({"subtype": "error_something_else"})
        monkeypatch.setattr(
            subprocess, "run", lambda *a, **kw: _make_completed_process(stdout=output)
        )
        result = ClaudeRunner().run("test prompt")
        assert result.success is False
        assert "error_something_else" in result.error

    def test_malformed_json(self, monkeypatch) -> None:
        monkeypatch.setattr(
            subprocess,
            "run",
            lambda *a, **kw: _make_completed_process(stdout="not json", returncode=1),
        )
        result = ClaudeRunner().run("test prompt")
        assert result.success is False
        assert result.error == "malformed JSON output"
        assert result.output == "not json"

    def test_no_output(self, monkeypatch) -> None:
        monkeypatch.setattr(
            subprocess,
            "run",
            lambda *a, **kw: _make_completed_process(stdout="", returncode=1),
        )
        result = ClaudeRunner().run("test prompt")
        assert result.success is False
        assert "no output" in result.error
        assert result.output is None

    def test_measures_duration(self, monkeypatch) -> None:
        output = json.dumps({"subtype": "success"})
        monkeypatch.setattr(
            subprocess, "run", lambda *a, **kw: _make_completed_process(stdout=output)
        )
        result = ClaudeRunner().run("test prompt")
        assert isinstance(result.duration_seconds, float)
        assert result.duration_seconds >= 0

    def test_spawns_correct_command(self, monkeypatch) -> None:
        captured_args: list = []

        def fake_run(*args, **kwargs):
            captured_args.append(args[0])
            return _make_completed_process(stdout=json.dumps({"subtype": "success"}))

        monkeypatch.setattr(subprocess, "run", fake_run)
        ClaudeRunner().run("hello")
        cmd = captured_args[0]
        assert cmd[0] == "claude"
        assert "-p" in cmd
        assert "--output-format" in cmd
        assert "json" in cmd
        assert "--allowedTools" in cmd
