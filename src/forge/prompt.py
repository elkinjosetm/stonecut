"""Prompt builder — loads and renders the execute.md template."""

from __future__ import annotations

from importlib import resources


_BOOKKEEPING_ONCE = """\
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
    bookkeeping = _BOOKKEEPING_ONCE.format(
        status_path=f"{spec_dir}/status.json",
        progress_path=f"{spec_dir}/progress.txt",
        issue_number=issue_number,
        issue_filename=issue_filename,
    )
    return template.format(
        prd_content=prd_content,
        issue_number=issue_number,
        issue_filename=issue_filename,
        issue_content=issue_content,
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
        prd_content=prd_content,
        issue_number=issue_number,
        issue_filename=issue_filename,
        issue_content=issue_content,
        bookkeeping="",
        bookkeeping_stop="",
    )
