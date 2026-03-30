"""ClaudeRunner — adapter for Claude Code CLI."""

from __future__ import annotations

from forge.runner import RunResult


class ClaudeRunner:
    """Runner adapter for Claude Code.

    Full implementation (JSON parsing, subtype extraction) is in a
    follow-up issue.  This stub satisfies the Runner protocol so that
    the registry and wiring can be built and tested independently.
    """

    def run(self, prompt: str) -> RunResult:
        raise NotImplementedError("ClaudeRunner.run() is not yet implemented")
