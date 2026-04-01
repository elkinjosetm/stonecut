# PRD Forge

A CLI that drives PRD-driven development with agentic coding CLIs. You write the PRD, Forge executes the issues one by one.

## Workflow

Ideas can come from anywhere — Jira tickets, Slack threads, MCP servers, or just a conversation. The pipeline starts once you're ready to act on one:

1. **`/forge-interview`** — Stress-test the idea. Get grilled on the plan until it's solid.
2. **`/forge-prd`** — Turn the validated idea into a PRD (local file or GitHub issue).
3. **`/forge-issues`** — Break the PRD into independently-grabbable issues (local markdown files or GitHub sub-issues).
4. **`forge run`** — Execute the issues sequentially with an agentic coding CLI.

Steps 1–3 are Claude Code skills installed via `forge setup-skills`. Step 4 is the Forge CLI.

### Suggested: managing your idea backlog

For projects using GitHub issues, we recommend tracking ideas with a `roadmap` label. When an idea is ready, interview it, write the PRD (which closes the roadmap issue), break it into sub-issues, and execute. See [DESIGN.md](DESIGN.md#suggested-practice-managing-your-idea-backlog-with-github-labels) for the full flow.

## Installation

### Prerequisites

- [Bun](https://bun.sh/) — install with `curl -fsSL https://bun.sh/install | bash`
- An agentic coding CLI — [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`) is the default runner and must be in your PATH. [OpenAI Codex CLI](https://github.com/openai/codex) (`codex`) is required only when using `--runner codex`.
- [GitHub CLI](https://cli.github.com/) — `gh`, authenticated. Required for GitHub mode and for pushing branches / creating PRs in local mode.

### Install from npm

```sh
bun add -g prd-forge
```

This makes the `forge` command globally available. Then install the Claude Code skills:

```sh
forge setup-skills
```

### Install from source

```sh
git clone https://github.com/elkinjosetm/prd-forge.git
cd prd-forge
bun install
```

To run the CLI from source:

```sh
bun run src/cli.ts
```

### Dev setup

```sh
bun install
git config core.hooksPath .githooks
```

This installs all dependencies and activates a pre-commit hook that runs eslint and prettier checks before each commit.

Run tests:

```sh
bun test
```

## Usage

Forge has one execution command (`run`) with two sources (`--local` for local PRDs, `--github` for GitHub PRDs). All execution is headless — Forge runs the issues autonomously and creates a PR when done.

### `forge run --local` — Local PRDs

```sh
# Run 5 issues, then push and create a PR
forge run --local my-feature -i 5

# Run all remaining issues
forge run --local my-feature -i all
```

### `forge run --github` — GitHub PRDs

```sh
# Run 5 sub-issues
forge run --github 42 -i 5

# Run all remaining sub-issues
forge run --github 42 -i all
```

### Flags

| Flag           | Short | Required | Description                                                       |
| -------------- | ----- | -------- | ----------------------------------------------------------------- |
| `--iterations` | `-i`  | Always   | Positive integer or `all`.                                        |
| `--runner`     | —     | No       | Agentic CLI runner to use (`claude`, `codex`). Default: `claude`. |
| `--version`    | `-V`  | —        | Show version and exit.                                            |

### Pre-execution prompts

Before starting, Forge:

1. Checks for a clean working tree
2. Prompts for a branch name (suggests `forge/<slug>` — local uses the spec name, GitHub uses the PRD title slug, with `forge/issue-<number>` fallback)
3. Prompts for a base branch / PR target (suggests `main`)
4. Creates or checks out the branch

### After a run

Forge automatically pushes the branch, creates a PR, and includes a Forge Report listing each issue with its status (completed or failed with error reason). The report also shows which runner was used. Timing stats are printed per iteration and for the full session.
In GitHub mode, the PR title defaults to the PRD issue title with a `PRD #<number>` fallback if the title is unavailable.

## Sources

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

This creates symlinks in `~/.claude/skills/` pointing to the installed package. Once linked, they're available as `/forge-interview`, `/forge-prd`, and `/forge-issues` in any Claude Code session.

For non-default Claude Code installations, pass `--target` with the Claude root path:

```sh
forge setup-skills --target ~/.claude-acme
```

To remove the symlinks:

```sh
forge remove-skills              # default (~/.claude)
forge remove-skills --target ~/.claude-acme
```
