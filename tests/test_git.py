"""Tests for git operations — snapshot, stage, commit, revert."""

from __future__ import annotations

import os
import subprocess

import pytest

from forge.git import (
    WorkingTreeSnapshot,
    commit_changes,
    revert_uncommitted,
    snapshot_working_tree,
    stage_changes,
)


@pytest.fixture()
def git_repo(tmp_path):
    """Create a minimal git repo with one initial commit."""
    os.chdir(tmp_path)
    subprocess.run(["git", "init"], check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        check=True,
        capture_output=True,
    )
    # Initial commit
    (tmp_path / "README.md").write_text("# test\n")
    subprocess.run(["git", "add", "."], check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "initial"],
        check=True,
        capture_output=True,
    )
    return tmp_path


class TestSnapshotWorkingTree:
    def test_captures_untracked_files(self, git_repo) -> None:
        (git_repo / "junk.txt").write_text("pre-existing junk")
        snapshot = snapshot_working_tree()
        assert "junk.txt" in snapshot.untracked

    def test_empty_when_clean(self, git_repo) -> None:
        snapshot = snapshot_working_tree()
        assert snapshot.untracked == set()

    def test_does_not_include_tracked_modified(self, git_repo) -> None:
        (git_repo / "README.md").write_text("modified\n")
        snapshot = snapshot_working_tree()
        assert "README.md" not in snapshot.untracked


class TestStageChanges:
    def test_stages_modified_tracked_files(self, git_repo) -> None:
        snapshot = WorkingTreeSnapshot(untracked=set())
        (git_repo / "README.md").write_text("modified\n")
        has_changes = stage_changes(snapshot)
        assert has_changes is True

    def test_stages_new_files_not_in_snapshot(self, git_repo) -> None:
        snapshot = WorkingTreeSnapshot(untracked=set())
        (git_repo / "new_file.py").write_text("print('hello')\n")
        has_changes = stage_changes(snapshot)
        assert has_changes is True

    def test_ignores_pre_existing_untracked(self, git_repo) -> None:
        (git_repo / "junk.txt").write_text("pre-existing junk")
        snapshot = snapshot_working_tree()
        # No actual changes during "session"
        has_changes = stage_changes(snapshot)
        assert has_changes is False

    def test_returns_false_when_no_changes(self, git_repo) -> None:
        snapshot = WorkingTreeSnapshot(untracked=set())
        has_changes = stage_changes(snapshot)
        assert has_changes is False

    def test_stages_mix_of_modified_and_new(self, git_repo) -> None:
        snapshot = WorkingTreeSnapshot(untracked=set())
        (git_repo / "README.md").write_text("modified\n")
        (git_repo / "new_file.py").write_text("print('hello')\n")
        has_changes = stage_changes(snapshot)
        assert has_changes is True
        # Verify both are staged
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            capture_output=True,
            text=True,
        )
        staged = set(result.stdout.strip().splitlines())
        assert "README.md" in staged
        assert "new_file.py" in staged


class TestCommitChanges:
    def test_successful_commit(self, git_repo) -> None:
        (git_repo / "README.md").write_text("modified\n")
        subprocess.run(["git", "add", "-u"], check=True, capture_output=True)
        ok, output = commit_changes("test commit")
        assert ok is True
        # Verify commit exists
        result = subprocess.run(
            ["git", "log", "--oneline", "-1"],
            capture_output=True,
            text=True,
        )
        assert "test commit" in result.stdout

    def test_failed_commit_nothing_staged(self, git_repo) -> None:
        ok, output = commit_changes("should fail")
        assert ok is False


class TestRevertUncommitted:
    def test_reverts_modified_tracked_files(self, git_repo) -> None:
        snapshot = WorkingTreeSnapshot(untracked=set())
        (git_repo / "README.md").write_text("modified\n")
        revert_uncommitted(snapshot)
        assert (git_repo / "README.md").read_text() == "# test\n"

    def test_removes_new_files_not_in_snapshot(self, git_repo) -> None:
        snapshot = WorkingTreeSnapshot(untracked=set())
        (git_repo / "new_file.py").write_text("print('hello')\n")
        revert_uncommitted(snapshot)
        assert not (git_repo / "new_file.py").exists()

    def test_preserves_pre_existing_untracked(self, git_repo) -> None:
        (git_repo / "junk.txt").write_text("pre-existing junk")
        snapshot = snapshot_working_tree()
        (git_repo / "new_file.py").write_text("should be removed\n")
        (git_repo / "README.md").write_text("modified\n")
        revert_uncommitted(snapshot)
        assert (git_repo / "junk.txt").exists()
        assert not (git_repo / "new_file.py").exists()
        assert (git_repo / "README.md").read_text() == "# test\n"
