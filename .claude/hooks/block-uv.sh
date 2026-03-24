#!/usr/bin/env bash
# PreToolUse hook: blocks uv commands in this project.
# This project uses setuptools + .venv — not uv.

command=$(jq -r '.tool_input.command')

if echo "$command" | grep -qE '(^|[;&|] *)uv '; then
  echo '{"decision":"block","reason":"Do not use uv in this project. Use the .venv directly (e.g. .venv/bin/pytest, .venv/bin/ruff)."}'
else
  echo '{"decision":"allow"}'
fi
