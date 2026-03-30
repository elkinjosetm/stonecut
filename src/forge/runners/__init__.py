"""Runner registry — maps runner names to their implementations."""

from __future__ import annotations

from forge.runner import Runner
from forge.runners.claude import ClaudeRunner

_RUNNERS: dict[str, type] = {
    "claude": ClaudeRunner,
}


def get_runner(name: str) -> Runner:
    """Return a runner instance for the given name.

    Raises ``ValueError`` with a list of available runners when *name*
    is not recognised.
    """
    cls = _RUNNERS.get(name)
    if cls is None:
        available = ", ".join(sorted(_RUNNERS))
        raise ValueError(
            f"Unknown runner '{name}'. Available runners: {available}"
        )
    return cls()
