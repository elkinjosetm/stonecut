# Forge — Design Document

Forge is a CLI tool that executes PRD-driven development workflows using Claude Code. It picks up issues (vertical slices from a PRD), spawns Claude Code sessions to implement them, handles bookkeeping, and creates pull requests with execution reports.

This document captures the design decisions for the initial build and future roadmap.

## Naming

- **Project name:** Forge (repo: forge-orchestrator)
- **CLI command:** `forge`
- **Rationale:** A PRD is a blueprint, issues are the pieces, the tool forges them into reality. The primary execution entry point is `forge run`, with source selection handled by flags.

## Day One — CLI Commands

```
forge run --local <name> -m <once|afk> [-i <N|all>]
forge run --github <number> -m <once|afk> [-i <N|all>]
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

- **`forge run --local <name>`** — local PRD. Looks in `.forge/<name>/` for `prd.md` and `issues/`.
- **`forge run --github <number>`** — GitHub PRD. Issue number on the current repo, tasks are sub-issues.

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

Same prompts for both local and GitHub sources. Simple `questionary` prompts, no AI needed.

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

## Idea → Execution Pipeline

Ideas flow through a label-driven pipeline tracked entirely in GitHub issues:

1. **`roadmap`** — Raw idea. Created as a GitHub issue with the `roadmap` label.
2. **Interview** — Stress-test the idea via `forge:interview`. Discussion happens on the roadmap issue.
3. **`prd`** — Once interviewed, the roadmap issue is closed and a new issue is created with the `prd` label containing the full spec. The PRD links back to the roadmap issue for history.
4. **Issues** — The PRD is broken into sub-issues (via `forge:issues`), either as local markdown files or GitHub sub-issues.
5. **Execute** — `forge run` picks up the issues and implements them.

This keeps each artifact (idea, spec, implementation tickets) as a separate issue with a clear purpose and traceable lineage.

See [GitHub issues labeled `roadmap`](https://github.com/elkinjosetm/prd-forge/labels/roadmap) for current ideas.
