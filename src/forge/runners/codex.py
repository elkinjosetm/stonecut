"""CodexRunner — adapter for OpenAI Codex CLI."""

from __future__ import annotations

import json
import subprocess
import time

from forge.runner import RunResult


class CodexRunner:
    """Runner adapter for OpenAI Codex CLI.

    Spawns a headless Codex session in full-auto mode, uses exit code as
    the primary success signal, and extracts error details from JSONL
    output on failure.
    """

    def run(self, prompt: str) -> RunResult:
        start = time.monotonic()
        try:
            result = subprocess.run(
                ["codex", "exec", "--full-auto", "--json", "--ephemeral", "-"],
                input=prompt,
                text=True,
                capture_output=True,
            )
        except FileNotFoundError:
            return RunResult(
                success=False,
                exit_code=1,
                duration_seconds=time.monotonic() - start,
                error="codex binary not found in PATH",
            )
        duration = time.monotonic() - start

        if result.returncode == 0:
            return RunResult(
                success=True,
                exit_code=0,
                duration_seconds=duration,
            )

        error = _extract_error(result.stdout)
        return RunResult(
            success=False,
            exit_code=result.returncode,
            duration_seconds=duration,
            error=error,
        )


def _extract_error(stdout: str) -> str:
    """Scan JSONL output for the first error event and return its message."""
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(event, dict):
            continue
        event_type = event.get("type")
        if event_type == "turn.failed":
            nested = event.get("error")
            if isinstance(nested, dict):
                msg = nested.get("message")
                if isinstance(msg, str) and msg:
                    return msg
        elif event_type == "error":
            msg = event.get("message")
            if isinstance(msg, str) and msg:
                return msg
    return "codex exited with non-zero status"
