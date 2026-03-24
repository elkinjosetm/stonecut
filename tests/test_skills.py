"""Tests for forge setup-skills — uses real temporary directories, no mocks."""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from forge.cli import SKILL_NAMES, _get_skills_source_dir, app

runner = CliRunner()


@pytest.fixture()
def skills_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Patch the target directory to a temp location and return it."""
    target = tmp_path / ".claude" / "skills"
    target.mkdir(parents=True)
    monkeypatch.setattr(
        "forge.cli._get_skills_target_dir",
        lambda *, create=True, claude_root=None: target,
    )
    return target


# --------------- Symlink creation ---------------


class TestSetupSkills:
    def test_creates_symlinks(self, skills_env: Path) -> None:
        result = runner.invoke(app, ["setup-skills"])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            link = skills_env / name
            assert link.is_symlink()
            assert link.resolve() == (_get_skills_source_dir() / name).resolve()

    def test_prints_linked_skills(self, skills_env: Path) -> None:
        result = runner.invoke(app, ["setup-skills"])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            assert f"Linked {name}" in result.output

    def test_idempotent(self, skills_env: Path) -> None:
        result1 = runner.invoke(app, ["setup-skills"])
        assert result1.exit_code == 0
        result2 = runner.invoke(app, ["setup-skills"])
        assert result2.exit_code == 0
        # Second run should produce no output (all skipped silently)
        for name in SKILL_NAMES:
            assert f"Linked {name}" not in result2.output
        # Symlinks still valid
        for name in SKILL_NAMES:
            link = skills_env / name
            assert link.is_symlink()
            assert link.resolve() == (_get_skills_source_dir() / name).resolve()


# --------------- Conflict detection ---------------


class TestSetupSkillsConflicts:
    def test_warns_symlink_pointing_elsewhere(
        self, skills_env: Path, tmp_path: Path
    ) -> None:
        other_dir = tmp_path / "other-skill"
        other_dir.mkdir()
        name = SKILL_NAMES[0]
        (skills_env / name).symlink_to(other_dir)

        result = runner.invoke(app, ["setup-skills"])
        assert result.exit_code == 0
        assert "already exists as symlink" in result.output
        # Original symlink untouched
        assert (skills_env / name).readlink() == other_dir

    def test_warns_regular_directory(self, skills_env: Path) -> None:
        name = SKILL_NAMES[0]
        (skills_env / name).mkdir()

        result = runner.invoke(app, ["setup-skills"])
        assert result.exit_code == 0
        assert "not a symlink" in result.output
        # Directory untouched — still a regular dir
        assert (skills_env / name).is_dir()
        assert not (skills_env / name).is_symlink()

    def test_warns_regular_file(self, skills_env: Path) -> None:
        name = SKILL_NAMES[0]
        (skills_env / name).write_text("not a skill")

        result = runner.invoke(app, ["setup-skills"])
        assert result.exit_code == 0
        assert "not a symlink" in result.output


# --------------- Remove skills ---------------


class TestRemoveSkills:
    def test_removes_forge_symlinks(self, skills_env: Path) -> None:
        # First create the symlinks
        runner.invoke(app, ["setup-skills"])
        for name in SKILL_NAMES:
            assert (skills_env / name).is_symlink()

        result = runner.invoke(app, ["remove-skills"])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            assert not (skills_env / name).exists()
            assert f"Removed {name}" in result.output

    def test_leaves_non_forge_symlinks(self, skills_env: Path, tmp_path: Path) -> None:
        other_dir = tmp_path / "other-skill"
        other_dir.mkdir()
        for name in SKILL_NAMES:
            (skills_env / name).symlink_to(other_dir)

        result = runner.invoke(app, ["remove-skills"])
        assert result.exit_code == 0
        # All symlinks should still be there — they don't point to Forge
        for name in SKILL_NAMES:
            assert (skills_env / name).is_symlink()
            assert (skills_env / name).readlink() == other_dir

    def test_missing_paths_no_error(self, skills_env: Path) -> None:
        # Nothing exists at the target paths
        result = runner.invoke(app, ["remove-skills"])
        assert result.exit_code == 0
        assert result.output.strip() == ""

    def test_regular_files_not_removed(self, skills_env: Path) -> None:
        for name in SKILL_NAMES:
            (skills_env / name).write_text("not a skill")

        result = runner.invoke(app, ["remove-skills"])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            assert (skills_env / name).exists()
            assert (skills_env / name).read_text() == "not a skill"

    def test_noop_when_target_dir_missing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        nonexistent = tmp_path / "does-not-exist"
        monkeypatch.setattr(
            "forge.cli._get_skills_target_dir",
            lambda *, create=True, claude_root=None: nonexistent,
        )

        result = runner.invoke(app, ["remove-skills"])
        assert result.exit_code == 0
        assert result.output.strip() == ""
        assert not nonexistent.exists()

    def test_regular_directories_not_removed(self, skills_env: Path) -> None:
        for name in SKILL_NAMES:
            (skills_env / name).mkdir()

        result = runner.invoke(app, ["remove-skills"])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            assert (skills_env / name).is_dir()
            assert not (skills_env / name).is_symlink()


# --------------- --target flag ---------------


class TestSetupSkillsTarget:
    """Tests for setup-skills --target using real temp directories (no monkeypatch)."""

    def test_creates_symlinks_at_target(self, tmp_path: Path) -> None:
        claude_root = tmp_path / ".claude-acme"
        claude_root.mkdir()

        result = runner.invoke(app, ["setup-skills", "--target", str(claude_root)])
        assert result.exit_code == 0

        skills_dir = claude_root / "skills"
        assert skills_dir.is_dir()
        for name in SKILL_NAMES:
            link = skills_dir / name
            assert link.is_symlink()
            assert link.resolve() == (_get_skills_source_dir() / name).resolve()

    def test_creates_skills_subdir_if_missing(self, tmp_path: Path) -> None:
        claude_root = tmp_path / ".claude-fresh"
        claude_root.mkdir()
        skills_dir = claude_root / "skills"
        assert not skills_dir.exists()

        result = runner.invoke(app, ["setup-skills", "--target", str(claude_root)])
        assert result.exit_code == 0
        assert skills_dir.is_dir()
        for name in SKILL_NAMES:
            assert (skills_dir / name).is_symlink()

    def test_conflict_detection_with_target(self, tmp_path: Path) -> None:
        claude_root = tmp_path / ".claude-conflict"
        skills_dir = claude_root / "skills"
        skills_dir.mkdir(parents=True)

        name = SKILL_NAMES[0]
        (skills_dir / name).write_text("not a skill")

        result = runner.invoke(app, ["setup-skills", "--target", str(claude_root)])
        assert result.exit_code == 0
        assert "not a symlink" in result.output
        assert (skills_dir / name).read_text() == "not a skill"

    def test_idempotent_with_target(self, tmp_path: Path) -> None:
        claude_root = tmp_path / ".claude-idem"
        claude_root.mkdir()

        runner.invoke(app, ["setup-skills", "--target", str(claude_root)])
        result = runner.invoke(app, ["setup-skills", "--target", str(claude_root)])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            assert f"Linked {name}" not in result.output

    def test_default_unchanged_without_target(self, skills_env: Path) -> None:
        """Without --target the existing monkeypatched default is used."""
        result = runner.invoke(app, ["setup-skills"])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            assert (skills_env / name).is_symlink()


class TestRemoveSkillsTarget:
    """Tests for remove-skills --target using real temp directories."""

    def test_removes_forge_symlinks_at_target(self, tmp_path: Path) -> None:
        claude_root = tmp_path / ".claude-acme"
        claude_root.mkdir()

        runner.invoke(app, ["setup-skills", "--target", str(claude_root)])
        skills_dir = claude_root / "skills"
        for name in SKILL_NAMES:
            assert (skills_dir / name).is_symlink()

        result = runner.invoke(app, ["remove-skills", "--target", str(claude_root)])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            assert not (skills_dir / name).exists()
            assert f"Removed {name}" in result.output

    def test_noop_when_target_does_not_exist(self, tmp_path: Path) -> None:
        nonexistent = tmp_path / "no-such-root"

        result = runner.invoke(app, ["remove-skills", "--target", str(nonexistent)])
        assert result.exit_code == 0
        assert result.output.strip() == ""
        assert not nonexistent.exists()

    def test_leaves_non_forge_symlinks_at_target(self, tmp_path: Path) -> None:
        claude_root = tmp_path / ".claude-other"
        skills_dir = claude_root / "skills"
        skills_dir.mkdir(parents=True)

        other_dir = tmp_path / "other-skill"
        other_dir.mkdir()
        for name in SKILL_NAMES:
            (skills_dir / name).symlink_to(other_dir)

        result = runner.invoke(app, ["remove-skills", "--target", str(claude_root)])
        assert result.exit_code == 0
        for name in SKILL_NAMES:
            assert (skills_dir / name).is_symlink()
            assert (skills_dir / name).readlink() == other_dir
