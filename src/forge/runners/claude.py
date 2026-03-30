"""ClaudeRunner — adapter for Claude Code CLI."""

from __future__ import annotations

import json
import subprocess
import time

from forge.runner import RunResult

_ERROR_MESSAGES: dict[str, str] = {
    "error_max_turns": "max turns exceeded",
    "error_max_budget_usd": "max budget exceeded",
}


class ClaudeRunner:
    """Runner adapter for Claude Code.

    Spawns a headless Claude Code session, parses the JSON output to
    determine success/failure, and translates error subtypes into
    human-readable messages.
    """

    def run(self, prompt: str) -> RunResult:
        start = time.monotonic()
        try:
            result = subprocess.run(
                [
                    "claude",
                    "-p",
                    "--output-format",
                    "json",
                    "--allowedTools",
                    "Bash,Edit,Read,Write,Glob,Grep",
                ],
                input=prompt,
                text=True,
                capture_output=True,
            )
        except FileNotFoundError:
            return RunResult(
                success=False,
                exit_code=1,
                duration_seconds=time.monotonic() - start,
                error="claude binary not found in PATH",
            )
        duration = time.monotonic() - start

        output = result.stdout or None

        if output is None:
            return RunResult(
                success=False,
                exit_code=result.returncode,
                duration_seconds=duration,
                output=None,
                error=f"no output (exit code {result.returncode})",
            )

        try:
            data = json.loads(output)
        except (json.JSONDecodeError, TypeError):
            return RunResult(
                success=False,
                exit_code=result.returncode,
                duration_seconds=duration,
                output=output,
                error="malformed JSON output",
            )

        if not isinstance(data, dict):
            return RunResult(
                success=False,
                exit_code=result.returncode,
                duration_seconds=duration,
                output=output,
                error="unexpected JSON output (not an object)",
            )

        subtype = data.get("subtype", "")
        if subtype == "success":
            return RunResult(
                success=True,
                exit_code=result.returncode,
                duration_seconds=duration,
                output=output,
            )

        error_msg = _ERROR_MESSAGES.get(subtype, f"failed ({subtype or 'unknown'})")
        return RunResult(
            success=False,
            exit_code=result.returncode,
            duration_seconds=duration,
            output=output,
            error=error_msg,
        )
