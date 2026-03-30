"""Git operations — thin wrapper for branch management, commit, and push."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field

import typer


@dataclass
class WorkingTreeSnapshot:
    """Snapshot of the working tree state before a runner session."""

    untracked: set[str] = field(default_factory=set)


def default_branch() -> str:
    """Detect the remote's default branch, falling back to 'main'."""
    result = subprocess.run(
        ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        # refs/remotes/origin/main → main
        ref = result.stdout.strip()
        prefix = "refs/remotes/origin/"
        if ref.startswith(prefix):
            branch = ref[len(prefix) :]
            if branch:
                return branch
    return "main"


def ensure_clean_tree() -> None:
    """Error if the working tree has uncommitted changes."""
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True,
    )
    if result.stdout.strip():
        typer.echo(
            "Error: working tree has uncommitted changes. Commit or stash them first."
        )
        raise typer.Exit(code=1)


def checkout_or_create_branch(branch: str) -> None:
    """Check out the branch if it exists, otherwise create it."""
    # Check if branch already exists (local)
    result = subprocess.run(
        ["git", "rev-parse", "--verify", branch],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        subprocess.run(["git", "checkout", branch], check=True)
        typer.echo(f"Checked out existing branch: {branch}")
    else:
        subprocess.run(["git", "checkout", "-b", branch], check=True)
        typer.echo(f"Created and checked out new branch: {branch}")


def push_branch(branch: str) -> None:
    """Push the branch to the remote with upstream tracking."""
    typer.echo(f"Pushing branch: {branch}")
    subprocess.run(
        ["git", "push", "-u", "origin", branch],
        check=True,
    )


def snapshot_working_tree() -> WorkingTreeSnapshot:
    """Capture the current set of untracked files before a runner session."""
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True,
    )
    untracked: set[str] = set()
    for line in result.stdout.splitlines():
        if line.startswith("??"):
            # "?? path/to/file" → "path/to/file"
            untracked.add(line[3:].strip())
    return WorkingTreeSnapshot(untracked=untracked)


def stage_changes(snapshot: WorkingTreeSnapshot) -> bool:
    """Stage files changed during a runner session.

    Stages modified tracked files and new untracked files that were not
    present in the snapshot.  Returns True if anything was staged.
    """
    # Stage all modified tracked files
    subprocess.run(["git", "add", "-u"], check=True)

    # Find new untracked files (not in pre-run snapshot)
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True,
    )
    new_files: list[str] = []
    for line in result.stdout.splitlines():
        if line.startswith("??"):
            path = line[3:].strip()
            if path not in snapshot.untracked:
                new_files.append(path)

    if new_files:
        subprocess.run(["git", "add", "--"] + new_files, check=True)

    # Check if anything is staged
    diff = subprocess.run(
        ["git", "diff", "--cached", "--quiet"],
        capture_output=True,
    )
    return diff.returncode != 0


def commit_changes(message: str) -> tuple[bool, str]:
    """Create a git commit with the given message.

    Returns (success, output).  On failure the output contains the
    error details (e.g. pre-commit hook output).
    """
    result = subprocess.run(
        ["git", "commit", "-m", message],
        capture_output=True,
        text=True,
    )
    output = (result.stdout + "\n" + result.stderr).strip()
    return result.returncode == 0, output


def revert_uncommitted(snapshot: WorkingTreeSnapshot) -> None:
    """Revert uncommitted changes, restoring the tree to the last commit.

    Removes new untracked files created during the runner session (those
    not in the snapshot) and restores modified tracked files.
    """
    # Restore modified tracked files
    subprocess.run(["git", "checkout", "."], capture_output=True)

    # Remove new untracked files (only those created during the session)
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True,
    )
    new_files: list[str] = []
    for line in result.stdout.splitlines():
        if line.startswith("??"):
            path = line[3:].strip()
            if path not in snapshot.untracked:
                new_files.append(path)

    if new_files:
        subprocess.run(["git", "clean", "-fd", "--"] + new_files, capture_output=True)


def create_pr(title: str, body: str, base_branch: str) -> None:
    """Create a pull request via gh CLI."""
    typer.echo(f"Creating PR targeting {base_branch}...")
    subprocess.run(
        ["gh", "pr", "create", "--title", title, "--body", body, "--base", base_branch],
        check=True,
    )
    typer.echo("PR created.")
