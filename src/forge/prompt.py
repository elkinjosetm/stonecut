"""Prompt builder — loads and renders the execute.md template."""

from __future__ import annotations

from importlib import resources


def _load_template() -> str:
    """Load the execute.md template from package data."""
    return resources.files("forge").joinpath("templates/execute.md").read_text()


def render_local(
    *,
    prd_content: str,
    issue_number: int,
    issue_filename: str,
    issue_content: str,
) -> str:
    """Render the prompt for local spec execution."""
    template = _load_template()
    return template.format(
        task_source="a structured spec",
        prd_content=prd_content,
        issue_number=issue_number,
        issue_filename=issue_filename,
        issue_content=issue_content,
    )


def render_github(
    *,
    prd_content: str,
    issue_number: int,
    issue_title: str,
    issue_content: str,
) -> str:
    """Render the prompt for GitHub PRD execution."""
    template = _load_template()
    return template.format(
        task_source="a GitHub issue",
        prd_content=prd_content,
        issue_number=issue_number,
        issue_filename=issue_title,
        issue_content=issue_content,
    )
