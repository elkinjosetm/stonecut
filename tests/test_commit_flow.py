"""Tests for verify_and_fix and the commit flow in run_afk_loop."""

from __future__ import annotations

from dataclasses import dataclass

import forge.runner as runner_mod
from forge.git import WorkingTreeSnapshot
from forge.runner import RunResult, run_afk_loop, verify_and_fix

# -- verify_and_fix -----------------------------------------------------------


class _FakeRunner:
    """Runner that records calls and returns a fixed result."""

    def __init__(self, success: bool = True) -> None:
        self.calls: list[str] = []
        self._success = success

    def run(self, prompt: str) -> RunResult:
        self.calls.append(prompt)
        return RunResult(
            success=self._success, exit_code=0, duration_seconds=0.1
        )


class TestVerifyAndFix:
    def test_passes_on_first_check(self) -> None:
        runner = _FakeRunner()
        ok, output = verify_and_fix(
            runner=runner,
            check=lambda: (True, "all good"),
            fix_prompt=lambda err: f"fix: {err}",
        )
        assert ok is True
        assert output == "all good"
        assert runner.calls == []

    def test_fix_then_pass(self) -> None:
        call_count = 0

        def check():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return False, "lint error"
            return True, "fixed"

        runner = _FakeRunner()
        ok, output = verify_and_fix(
            runner=runner,
            check=check,
            fix_prompt=lambda err: f"fix: {err}",
        )
        assert ok is True
        assert output == "fixed"
        assert len(runner.calls) == 1
        assert "lint error" in runner.calls[0]

    def test_fix_then_still_fails(self) -> None:
        runner = _FakeRunner()
        ok, output = verify_and_fix(
            runner=runner,
            check=lambda: (False, "persistent error"),
            fix_prompt=lambda err: f"fix: {err}",
        )
        assert ok is False
        assert output == "persistent error"
        assert len(runner.calls) == 1


# -- run_afk_loop commit flow ------------------------------------------------


@dataclass
class _FakeIssue:
    number: int
    title: str
    body: str = ""
    filename: str = ""


class _FakeSource:
    """Source with controllable issues and completion tracking."""

    def __init__(self, issues: list[_FakeIssue]) -> None:
        self._issues = list(issues)
        self.completed: list[int] = []

    def get_next_issue(self):
        for issue in self._issues:
            if issue.number not in self.completed:
                return issue
        return None

    def get_remaining_count(self):
        remaining = sum(
            1 for i in self._issues if i.number not in self.completed
        )
        return remaining, len(self._issues)

    def complete_issue(self, issue):
        self.completed.append(issue.number)


def _patch_git(monkeypatch, *, has_changes=True, commit_ok=True):
    """Patch git operations in the runner module."""
    monkeypatch.setattr(
        runner_mod,
        "snapshot_working_tree",
        lambda: WorkingTreeSnapshot(),
    )
    monkeypatch.setattr(
        runner_mod,
        "stage_changes",
        lambda snapshot: has_changes,
    )
    monkeypatch.setattr(
        runner_mod,
        "commit_changes",
        lambda msg: (commit_ok, "ok" if commit_ok else "hook failed"),
    )
    monkeypatch.setattr(
        runner_mod,
        "revert_uncommitted",
        lambda snapshot: None,
    )


class TestRunAfkLoopCommitFlow:
    def test_runner_failure_does_not_complete(
        self, monkeypatch
    ) -> None:
        """Runner fails -> issue NOT completed."""
        source = _FakeSource(
            [_FakeIssue(number=1, title="Task 1")]
        )
        fail_result = RunResult(
            success=False,
            exit_code=1,
            duration_seconds=1.0,
            error="crash",
        )
        runner = _FakeRunner(success=False)
        runner.run = lambda prompt: fail_result

        _patch_git(monkeypatch)

        results = run_afk_loop(
            source=source,
            iterations=1,
            render_prompt=lambda i: "prompt",
            display_name=lambda i: i.title,
            commit_message=lambda i: f"#{i.number}: {i.title}",
            runner=runner,
        )

        assert len(results) == 1
        assert results[0].success is False
        assert source.completed == []

    def test_no_changes_marks_failure(self, monkeypatch) -> None:
        """Runner succeeds but no changes -> failure."""
        source = _FakeSource(
            [_FakeIssue(number=1, title="Task 1")]
        )
        runner = _FakeRunner(success=True)

        no_changes_called: list[int] = []

        def fake_on_no_changes(issue, output):
            no_changes_called.append(issue.number)

        _patch_git(monkeypatch, has_changes=False)

        results = run_afk_loop(
            source=source,
            iterations=1,
            render_prompt=lambda i: "prompt",
            display_name=lambda i: i.title,
            commit_message=lambda i: f"#{i.number}: {i.title}",
            runner=runner,
            on_no_changes=fake_on_no_changes,
        )

        assert len(results) == 1
        assert results[0].success is False
        assert results[0].error == "runner produced no changes"
        assert source.completed == []
        assert no_changes_called == [1]

    def test_successful_commit_completes_issue(
        self, monkeypatch
    ) -> None:
        """Runner succeeds + commit succeeds -> completed."""
        source = _FakeSource(
            [_FakeIssue(number=1, title="Task 1")]
        )
        runner = _FakeRunner(success=True)
        _patch_git(monkeypatch)

        results = run_afk_loop(
            source=source,
            iterations=1,
            render_prompt=lambda i: "prompt",
            display_name=lambda i: i.title,
            commit_message=lambda i: f"#{i.number}: {i.title}",
            runner=runner,
        )

        assert len(results) == 1
        assert results[0].success is True
        assert source.completed == [1]

    def test_commit_failure_stops_session(
        self, monkeypatch
    ) -> None:
        """Commit fails after retries -> session stops."""
        source = _FakeSource([
            _FakeIssue(number=1, title="Task 1"),
            _FakeIssue(number=2, title="Task 2"),
        ])
        runner = _FakeRunner(success=True)
        _patch_git(monkeypatch, commit_ok=False)

        results = run_afk_loop(
            source=source,
            iterations="all",
            render_prompt=lambda i: "prompt",
            display_name=lambda i: i.title,
            commit_message=lambda i: f"#{i.number}: {i.title}",
            runner=runner,
        )

        # Only one result — session stopped
        assert len(results) == 1
        assert results[0].success is False
        assert results[0].error == "commit failed after retries"
        assert source.completed == []

    def test_commit_retry_succeeds(self, monkeypatch) -> None:
        """Commit fails first, runner fixes, second succeeds."""
        source = _FakeSource(
            [_FakeIssue(number=1, title="Task 1")]
        )
        runner = _FakeRunner(success=True)

        commit_attempts: list[str] = []

        def fake_commit(msg):
            commit_attempts.append(msg)
            if len(commit_attempts) <= 1:
                return False, "pre-commit hook failed"
            return True, "committed"

        monkeypatch.setattr(
            runner_mod,
            "snapshot_working_tree",
            lambda: WorkingTreeSnapshot(),
        )
        monkeypatch.setattr(
            runner_mod, "stage_changes", lambda snapshot: True
        )
        monkeypatch.setattr(
            runner_mod, "commit_changes", fake_commit
        )
        monkeypatch.setattr(
            runner_mod, "revert_uncommitted", lambda snapshot: None
        )

        results = run_afk_loop(
            source=source,
            iterations=1,
            render_prompt=lambda i: "prompt",
            display_name=lambda i: i.title,
            commit_message=lambda i: f"#{i.number}: {i.title}",
            runner=runner,
        )

        assert len(results) == 1
        assert results[0].success is True
        assert source.completed == [1]
