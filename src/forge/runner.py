"""Runner — spawns Claude Code sessions."""

from __future__ import annotations

import subprocess
import sys


def run_interactive(prompt: str) -> None:
    """Spawn an interactive Claude Code session with the prompt piped to stdin.

    Forge exits after spawning — the user takes over the session.
    """
    subprocess.run(
        ["claude", "--allowedTools", "Bash,Edit,Read,Write,Glob,Grep"],
        input=prompt,
        text=True,
    )
    sys.exit(0)
