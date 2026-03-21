# Forge — Design Document

Forge is a CLI tool that executes PRD-driven development workflows using Claude Code. It picks up issues (vertical slices from a PRD), spawns Claude Code sessions to implement them, handles bookkeeping, and creates pull requests with execution reports.

This document captures the design decisions for the initial build and future roadmap.

## Naming

- **Project name:** Forge (repo: forge-orchestrator)
- **CLI command:** `forge`
- **Rationale:** A PRD is a blueprint, issues are the pieces, the tool forges them into reality. Works naturally across subcommands: `forge spec`, `forge prd`, `forge status`.

## Day One — CLI Commands

```
forge spec <name> -m <once|afk> [-i <N|all>]
forge prd <number> -m <once|afk> [-i <N|all>]
```

### Flags

| Flag | Alias | Required | Description |
|------|-------|----------|-------------|
| `--mode` | `-m` | Always | Execution mode: `once` or `afk` |
| `--iterations` | `-i` | In `afk` mode | Number of issues to process, or `all` |

- Missing required args produce an error with help text.
- `--iterations` is ignored in `once` mode.
- `--help` available on every command.

### Sources

- **`forge spec <name>`** — local spec. Looks in `.forge/<name>/` for `prd.md` and `issues/`.
- **`forge prd <number>`** — GitHub PRD. Issue number on the current repo, tasks are sub-issues.

## Modes

### `once` (debug/inspect mode)

- Picks the next incomplete issue.
- Prompts for branch name and base branch before execution.
- Builds prompt from template (includes bookkeeping instruction so Claude marks the issue complete).
- Spawns an **interactive** Claude Code session.
- Forge exits — user takes over, can inspect, ask questions, adjust.

### `afk` (autonomous mode)

- Picks the next incomplete issue.
- Prompts for branch name and base branch before first execution.
- Builds prompt from template.
- Spawns **headless** Claude Code session (`claude -p`).
- On session exit:
  - Check exit code.
  - On success: close issue / update `status.json`, log to `progress.txt`.
  - On failure: mark as failed, move on.
- Loops until iterations exhausted.
- After all iterations complete: push branch, create PR with execution report.

### Prompt

Single `execute.md` template with placeholders. Identical for both modes except:

- **`once`**: includes a line instructing Claude to mark the issue complete (bookkeeping via prompt, since Forge isn't running after the session).
- **`afk`**: does not include that line — Forge handles bookkeeping externally after the headless session exits.

The mode difference in spawning is handled by Forge (interactive vs `-p` flag), not by the prompt.

## Pre-execution Flow

Before spawning the first Claude Code session, Forge prompts the user:

1. **Branch name** — with a sensible suggestion (e.g., `prd/42` or `feature/<spec-name>`).
2. **Base branch / PR target** — suggests `main`.

Same prompts for both `spec` and `prd` modes. Simple `questionary` prompts, no AI needed.

## PR Report

At the end of an `afk` run, Forge pushes the branch and creates a PR with a report:

```markdown
## Forge Report
- #1 Setup database schema: completed
- #2 API endpoints: completed
- #3 Auth middleware: failed (non-zero exit code)
- #4 Frontend components: completed
```

## Local Spec Structure

Local specs live in `.forge/` at the repo root:

```
.forge/
└── my-feature/
    ├── prd.md                    # The PRD (created by write-a-prd skill)
    ├── issues/
    │   ├── 01-setup.md           # Vertical slice issues (created by prd-to-issues skill)
    │   ├── 02-core.md
    │   └── 03-api.md
    ├── status.json               # Auto-created by Forge
    └── progress.txt              # Auto-created by Forge
```

Whether `.forge/` is gitignored is the developer's decision per repo. Forge does not touch `.gitignore`.

## GitHub Mode

- PRD is a GitHub issue labeled `prd`.
- Tasks are sub-issues linked via GitHub's sub-issue feature.
- Bookkeeping is handled by closing issues (no local `status.json`).
- Requires authenticated `gh` CLI.

## Tech Stack

- **Language:** Python
- **CLI framework:** `typer`
- **Interactive prompts:** `questionary`
- **Prompt templates:** Markdown files with `{placeholders}`

## Project Structure

```
forge/
├── pyproject.toml
├── src/
│   └── forge/
│       ├── __init__.py
│       ├── cli.py              # typer app, subcommands
│       ├── github.py           # GitHub/gh CLI integration
│       ├── local.py            # local spec operations
│       ├── runner.py           # Claude Code spawning, loop logic
│       ├── prompt.py           # template loading and rendering
│       └── templates/
│           └── execute.md      # prompt template
└── skills/
    ├── grill-me/
    ├── write-a-prd/
    └── prd-to-issues/
```

Skills remain as Claude Code skills. They are not invoked by the CLI on day one but live in the repo for future integration.

---

## Future Roadmap

### Verification Agent Loop

After each issue is implemented, Forge spawns a second Claude Code session to verify the work against the issue's acceptance criteria.

**Flow per issue:**

1. Attempt 1 → spawn executor → spawn verifier
2. Verifier returns PASS → bookkeeping, next issue
3. Verifier returns FAIL → Attempt 2 with verifier's feedback, amend the commit
4. Attempt 2 → spawn verifier
5. PASS → bookkeeping, next issue
6. FAIL → mark as **incorrect**, move on (no infinite loops)

**PR report with verification:**

```markdown
## Forge Report
- #1 Setup database schema: completed (verified)
- #2 API endpoints: completed (verified)
- #3 Auth middleware: incorrect (failed verification: missing token refresh logic)
- #4 Frontend components: completed (verified, 2nd attempt)
```

The verifier's feedback is passed to the second executor attempt so it knows specifically what to fix. Maximum two attempts per issue — if the second attempt fails verification, the issue is marked incorrect and included in the PR report for human review.

### Notification System

Integrate with notification services (Pushover, Telegram, etc.) to alert the user when:

- An `afk` run completes
- An issue fails execution or verification
- A PR is created and ready for review

Especially important for daemon mode where nobody is watching.

### Daemon / Service Mode

A long-running process that lives on a server (home server or cloud), watching registered repos for new PRDs ready to execute.

**Concept:**

- Repos are registered with `forge register /path/to/repo`.
- Registry stored in `~/.config/forge/`.
- Daemon polls GitHub for new PRD issues (webhook-driven later).
- When a new PRD is found: pick up issues, execute them, create PR, notify the user.
- Claude Code runs on the server with its own session/account.
- Repos are already cloned on the server — no cloning logic needed.

This enables a workflow where the user creates issues from any device, and Forge on the server picks them up, works on them, creates a PR, and sends a notification for review.

**Start with polling, evolve to webhooks.**

### Skill Launcher

Allow Forge to launch Claude Code skills as subcommands:

```
forge plan
```

This would spawn a Claude Code session that chains through grill-me → write-a-prd → prd-to-issues, with natural exit ramps between each step ("Ready to write the PRD?" / "Want to create issues?"). The user can bail at any point.

The skills may be merged into a single chained skill or remain separate with Forge handling the flow.

### Interactive No-Args Wizard

Running `forge` with no arguments walks the user through the full workflow interactively:

- What do you want to work on? (spec name or PRD number)
- What mode? (once / afk)
- How many iterations? (if afk)
- Branch name?
- Base branch?

Uses `questionary` prompts to guide the user step by step.

### Multiple Remote Sources

Evolve `forge prd` to support sources beyond GitHub (Linear, Jira, etc.). May require revisiting the `spec`/`prd` subcommand naming to something like `local`/`remote` with source identifiers.

### PyPI Publishing

Package and publish to PyPI for `pip install forge-orchestrator` distribution.
