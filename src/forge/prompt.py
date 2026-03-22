"""Prompt builder — loads and renders the execute.md template."""

from __future__ import annotations

from importlib import resources


_BOOKKEEPING_LOCAL_ONCE = """\
6. After committing, mark this issue as complete by running:
   python3 -c "
import json
with open('{status_path}') as f:
    status = json.load(f)
status['completed'].append({issue_number})
status['completed'] = sorted(set(status['completed']))
with open('{status_path}', 'w') as f:
    json.dump(status, f, indent=2)
    f.write('\\n')
"
7. Append to the progress log:
   echo "$(date '+%Y-%m-%d %H:%M') — Issue {issue_number} complete: {issue_filename}" >> {progress_path}"""

_BOOKKEEPING_GITHUB_ONCE = """\
6. After committing, close this GitHub issue by running:
   gh issue close {issue_number}"""


def _load_template() -> str:
    """Load the execute.md template from package data."""
    return resources.files("forge").joinpath("templates/execute.md").read_text()


def render_local_once(
    *,
    prd_content: str,
    issue_number: int,
    issue_filename: str,
    issue_content: str,
    spec_dir: str,
) -> str:
    """Render the prompt for local spec in once mode (includes bookkeeping)."""
    template = _load_template()
    bookkeeping = _BOOKKEEPING_LOCAL_ONCE.format(
        status_path=f"{spec_dir}/status.json",
        progress_path=f"{spec_dir}/progress.txt",
        issue_number=issue_number,
        issue_filename=issue_filename,
    )
    return template.format(
        task_source="a structured spec",
        prd_content=prd_content,
        issue_number=issue_number,
        issue_filename=issue_filename,
        issue_content=issue_content,
        commit_suffix="",
        bookkeeping=bookkeeping,
        bookkeeping_stop=" and the bookkeeping steps",
    )


def render_local_afk(
    *,
    prd_content: str,
    issue_number: int,
    issue_filename: str,
    issue_content: str,
) -> str:
    """Render the prompt for local spec in afk mode (no bookkeeping)."""
    template = _load_template()
    return template.format(
        task_source="a structured spec",
        prd_content=prd_content,
        issue_number=issue_number,
        issue_filename=issue_filename,
        issue_content=issue_content,
        commit_suffix="",
        bookkeeping="",
        bookkeeping_stop="",
    )


def render_github_once(
    *,
    prd_content: str,
    issue_number: int,
    issue_title: str,
    issue_content: str,
) -> str:
    """Render the prompt for GitHub PRD in once mode (includes bookkeeping)."""
    template = _load_template()
    bookkeeping = _BOOKKEEPING_GITHUB_ONCE.format(issue_number=issue_number)
    return template.format(
        task_source="a GitHub issue",
        prd_content=prd_content,
        issue_number=issue_number,
        issue_filename=issue_title,
        issue_content=issue_content,
        commit_suffix=f" (#{issue_number})",
        bookkeeping=bookkeeping,
        bookkeeping_stop=" and the bookkeeping step",
    )


def render_github_afk(
    *,
    prd_content: str,
    issue_number: int,
    issue_title: str,
    issue_content: str,
) -> str:
    """Render the prompt for GitHub PRD in afk mode (no bookkeeping)."""
    template = _load_template()
    return template.format(
        task_source="a GitHub issue",
        prd_content=prd_content,
        issue_number=issue_number,
        issue_filename=issue_title,
        issue_content=issue_content,
        commit_suffix=f" (#{issue_number})",
        bookkeeping="",
        bookkeeping_stop="",
    )
