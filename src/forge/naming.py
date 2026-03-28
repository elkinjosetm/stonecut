"""Naming helpers for branches and pull requests."""

from __future__ import annotations

import re


def slugify_branch_component(value: str) -> str:
    """Normalize a free-form title into a branch-safe slug."""
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized.strip("-")
