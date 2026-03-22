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
    monkeypatch.setattr("forge.cli._get_skills_target_dir", lambda: target)
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
    def test_warns_symlink_pointing_elsewhere(self, skills_env: Path, tmp_path: Path) -> None:
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
