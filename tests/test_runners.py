"""Tests for the runner abstraction layer and registry."""

from __future__ import annotations

import pytest

from forge.runner import RunResult, Runner
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
