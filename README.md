# PRD Forge

A CLI that drives PRD-driven development with Claude Code. You write the PRD, Forge executes the issues one by one.

## Workflow

Ideas can come from anywhere — Jira tickets, Slack threads, MCP servers, or just a conversation. The pipeline starts once you're ready to act on one:

1. **`/forge:interview`** — Stress-test the idea. Get grilled on the plan until it's solid.
2. **`/forge:prd`** — Turn the validated idea into a PRD (local file or GitHub issue).
3. **`/forge:issues`** — Break the PRD into independently-grabbable issues (local markdown files or GitHub sub-issues).
4. **`forge run`** — Execute the issues sequentially with Claude Code.

Steps 1–3 are Claude Code skills installed via `forge setup-skills`. Step 4 is the Forge CLI.

### Suggested: managing your idea backlog

For projects using GitHub issues, we recommend tracking ideas with a `roadmap` label. When an idea is ready, interview it, write the PRD (which closes the roadmap issue), break it into sub-issues, and execute. See [DESIGN.md](DESIGN.md#suggested-practice-managing-your-idea-backlog-with-github-labels) for the full flow.

## Installation

### Install from source (recommended)

```sh
git clone https://github.com/elkinjosetm/prd-forge.git
cd prd-forge

# macOS
brew install pipx
# For Linux/Windows, see https://pipx.pypa.io/stable/installation/

pipx install -e .
```

This makes the `forge` command globally available — no venv activation needed. Source code changes are picked up automatically; dependency or metadata changes (e.g., `pyproject.toml` edits) require running `pipx install -e . --force` again. Then install the Claude Code skills:

```sh
forge setup-skills
```

### Dev dependencies and hooks

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
git config core.hooksPath .githooks
```

This installs `ruff` and `pytest`, and activates a pre-commit hook that runs lint and format checks before each commit.

## Usage

Forge has one execution command (`run`) with two sources (`--local` for local PRDs, `--github` for GitHub PRDs) and two execution modes (`once` for interactive, `afk` for autonomous).

### `forge run --local` — Local PRDs

```sh
# Interactive — pick the next issue, work on it with Claude in real time
forge run --local my-feature -m once

# Autonomous — run 5 issues headless, then push and create a PR
forge run --local my-feature -m afk -i 5

# Run all remaining issues
forge run --local my-feature -m afk -i all
```

### `forge run --github` — GitHub PRDs

```sh
# Interactive — pick the next open sub-issue
forge run --github 42 -m once

# Autonomous — run 5 issues headless, then push and create a PR
forge run --github 42 -m afk -i 5

# Run all remaining sub-issues
forge run --github 42 -m afk -i all
```

### Flags

| Flag | Short | Required | Description |
|------|-------|----------|-------------|
| `--mode` | `-m` | Always | `once` (interactive) or `afk` (autonomous) |
| `--iterations` | `-i` | In `afk` mode | Positive integer or `all`. Silently ignored in `once` mode. |
| `--version` | `-V` | — | Show version and exit. |

### Pre-execution prompts

Before starting, Forge:

1. Checks for a clean working tree
2. Prompts for a branch name (suggests `forge/<slug>` across both modes: local uses the spec name, GitHub uses the PRD title slug, with `forge/issue-<number>` fallback)
3. Prompts for a base branch / PR target (suggests `main`)
4. Creates or checks out the branch

### After an `afk` run

Forge automatically pushes the branch, creates a PR, and includes a Forge Report listing each issue with its status (completed or failed). Timing stats are printed per iteration and for the full session.
In GitHub mode, the PR title defaults to the PRD issue title with a `PRD #<number>` fallback if the title is unavailable.

## Modes

### Local mode (`forge run --local <name>`)

Expects a local PRD directory at `.forge/<name>/` with this structure:

```
.forge/my-feature/
├── prd.md              # The full PRD
├── issues/
│   ├── 01-setup.md     # Issue files, numbered for ordering
│   ├── 02-core.md
│   └── 03-api.md
├── status.json         # Auto-created: tracks completed issues
└── progress.txt        # Auto-created: timestamped completion log
```

### GitHub mode (`forge run --github <number>`)

Works with GitHub issues instead of local files:

- The PRD is a GitHub issue labeled `prd`
- Tasks are sub-issues of the PRD
- Progress is tracked by issue state (open/closed)
- Completed issues are closed via `gh issue close`

## Skills

The repo ships three Claude Code skills for steps 1–3 of the workflow. Install them with:

```sh
forge setup-skills
```

This creates symlinks in `~/.claude/skills/` pointing to the installed package. Once linked, they're available as `/forge:interview`, `/forge:prd`, and `/forge:issues` in any Claude Code session.

For non-default Claude Code installations, pass `--target` with the Claude root path:

```sh
forge setup-skills --target ~/.claude-acme
```

To remove the symlinks:

```sh
forge remove-skills              # default (~/.claude)
forge remove-skills --target ~/.claude-acme
```

## Prerequisites

- Python 3.10+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `claude` must be in your PATH
- [GitHub CLI](https://cli.github.com/) — `gh`, authenticated. Only needed for GitHub mode.

## Legacy scripts (deprecated)

The original shell scripts (`ralph-once`, `ralph-afk`, `ralph-lib`) remain in the repo for reference. They are functionally replaced by Forge and will be removed in a future release.

```sh
# These still work but are deprecated — use forge instead
ralph-once --spec ./specs/my-feature
ralph-afk --prd 42 --iterations all
```
