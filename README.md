# Stonecut

A CLI that drives PRD-driven development with agentic coding CLIs. You write the PRD, Stonecut executes the issues one by one.

## Workflow

Ideas can come from anywhere — Jira tickets, Slack threads, MCP servers, or just a conversation. The pipeline starts once you're ready to act on one:

1. **`/stonecut-interview`** — Stress-test the idea. Get grilled on the plan until it's solid.
2. **`/stonecut-prd`** — Turn the validated idea into a PRD (local file or GitHub issue).
3. **`/stonecut-issues`** — Break the PRD into independently-grabbable issues (local markdown files or GitHub sub-issues).
4. **`stonecut`** — Execute the issues sequentially with an agentic coding CLI.

Steps 1–3 are Claude Code skills installed via `stonecut setup-skills`. Step 4 is the Stonecut CLI.

### Suggested: managing your idea backlog

For projects using GitHub issues, we recommend tracking ideas with a `roadmap` label. When an idea is ready, interview it, write the PRD (which closes the roadmap issue), break it into sub-issues, and execute. See [DESIGN.md](DESIGN.md#suggested-practice-managing-your-idea-backlog-with-github-labels) for the full flow.

## Installation

### Prerequisites

- [Bun](https://bun.sh/) — install with `curl -fsSL https://bun.sh/install | bash`
- An agentic coding CLI — [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`) is the default runner and must be in your PATH. [OpenAI Codex CLI](https://github.com/openai/codex) (`codex`) is required only when using `--runner codex`.
- [GitHub CLI](https://cli.github.com/) — `gh`, authenticated. Required for GitHub mode and for pushing branches / creating PRs in local mode.

### Install from npm

```sh
bun add -g stonecut
```

This makes the `stonecut` command globally available. Then initialize your project and install the Claude Code skills:

```sh
stonecut init          # scaffold .stonecut/ with config and gitignore
stonecut setup-skills  # install Claude Code skills
```

### Install from source

```sh
git clone https://github.com/elkinjosetm/stonecut.git
cd stonecut
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

Running bare `stonecut` starts the interactive run wizard — the primary workflow for executing PRD issues. Use `stonecut --help` to discover all available commands.

### `stonecut` — Interactive wizard

When flags are omitted, Stonecut prompts for each missing parameter:

```sh
# Full wizard — prompted for source, iterations, branch, and base branch
stonecut

# Partial — only iterations, branch, and base are prompted
stonecut --local my-feature

# Partial — only source, branch, and base are prompted
stonecut -i all
```

You can also use `stonecut run` explicitly — it's identical to bare `stonecut`.

Flags provided via CLI skip the corresponding prompts. When all flags are given, the command runs without any prompts (the existing behavior).

If no `.stonecut/` directory exists, the wizard prints a hint suggesting `stonecut init`.

### `stonecut init` — Project setup

Scaffolds a `.stonecut/` directory with project-level configuration:

```sh
stonecut init
```

This creates:

- **`.stonecut/config.json`** — Project defaults for the run wizard (see [Configuration](#configuration) below).
- **`.stonecut/.gitignore`** — Ignores runtime artifacts (`logs/`, `status.json`, `progress.txt`) so only meaningful files (config, PRDs, issues) are committed.

The command errors if `config.json` already exists, preventing accidental overwrites. To reconfigure, edit the file directly.

### Configuration

`.stonecut/config.json` controls wizard defaults. All fields are optional:

```json
{
  "runner": "claude",
  "baseBranch": "main",
  "branchPrefix": "stonecut/"
}
```

| Field          | Default       | Description                                                                     |
| -------------- | ------------- | ------------------------------------------------------------------------------- |
| `runner`       | `"claude"`    | Agentic CLI runner (`claude`, `codex`). Used when `--runner` is omitted.        |
| `baseBranch`   | `"main"`      | Default PR target branch. Suggested in the wizard's base branch prompt.         |
| `branchPrefix` | `"stonecut/"` | Prefix for suggested branch names (e.g. `feat/stonecut/` for team conventions). |

When config is present, the wizard uses these as default values — you can hit enter through prompts for the common case. When config is absent, the current hardcoded defaults apply.

### `stonecut --local` — Local PRDs

```sh
# Run 5 issues, then push and create a PR
stonecut run --local my-feature -i 5

# Run all remaining issues
stonecut run --local my-feature -i all
```

### `stonecut --github` — GitHub PRDs

```sh
# Run 5 sub-issues
stonecut run --github 42 -i 5

# Run all remaining sub-issues
stonecut run --github 42 -i all
```

### Commands

| Command         | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| _(bare)_        | Start the interactive run wizard (default command).                    |
| `run`           | Alias for bare `stonecut` — execute issues from a local or GitHub PRD. |
| `init`          | Scaffold `.stonecut/` directory with project config and gitignore.     |
| `setup-skills`  | Install Stonecut skills as symlinks into `~/.claude/skills/`.          |
| `remove-skills` | Remove Stonecut skill symlinks from `~/.claude/skills/`.               |

### Flags

| Flag           | Short | Required | Description                                                              |
| -------------- | ----- | -------- | ------------------------------------------------------------------------ |
| `--local`      | —     | No       | Local PRD name (`.stonecut/<name>/`). Prompted if omitted.               |
| `--github`     | —     | No       | GitHub PRD issue number. Prompted if omitted.                            |
| `--iterations` | `-i`  | No       | Positive integer or `all`. Prompted with default `all` if omitted.       |
| `--runner`     | —     | No       | Agentic CLI runner (`claude`, `codex`). Default from config or `claude`. |
| `--version`    | `-V`  | —        | Show version and exit.                                                   |

### Pre-execution prompts

Before starting, Stonecut prompts for any missing parameters in order:

1. **Source** — `--local` or `--github` (skipped when provided via flag)
2. **Spec name / issue number** — free-text input for the chosen source (skipped when provided via flag)
3. **Iterations** — number of issues to process, default `all` (skipped when `-i` provided)
4. **Branch name** — suggests `<branchPrefix><slug>` based on the source (prefix from config or `stonecut/`)
5. **Base branch** — suggests the configured `baseBranch` or the repository's default branch (usually `main`)
6. Creates or checks out the branch

When all parameters are provided via flags, only the branch and base branch prompts appear (steps 4–5).

### After a run

Stonecut automatically pushes the branch, creates a PR, and includes a Stonecut Report listing each issue with its status (completed or failed with error reason). The report also shows which runner was used. Timing stats are printed per iteration and for the full session.
In GitHub mode, the PR title defaults to the PRD issue title with a `PRD #<number>` fallback if the title is unavailable.

## Sources

### Local mode (`stonecut run --local <name>`)

Expects a local PRD directory at `.stonecut/<name>/` with this structure:

```
.stonecut/my-feature/
├── prd.md              # The full PRD
├── issues/
│   ├── 01-setup.md     # Issue files, numbered for ordering
│   ├── 02-core.md
│   └── 03-api.md
├── status.json         # Auto-created: tracks completed issues
└── progress.txt        # Auto-created: timestamped completion log
```

### GitHub mode (`stonecut run --github <number>`)

Works with GitHub issues instead of local files:

- The PRD is a GitHub issue labeled `prd`
- Tasks are sub-issues of the PRD
- Progress is tracked by issue state (open/closed)
- Completed issues are closed via `gh issue close`

## Skills

The repo ships three Claude Code skills for steps 1–3 of the workflow. Install them with:

```sh
stonecut setup-skills
```

This creates symlinks in `~/.claude/skills/` pointing to the installed package. Once linked, they're available as `/stonecut-interview`, `/stonecut-prd`, and `/stonecut-issues` in any Claude Code session.

For non-default Claude Code installations, pass `--target` with the Claude root path:

```sh
stonecut setup-skills --target ~/.claude-acme
```

To remove the symlinks:

```sh
stonecut remove-skills              # default (~/.claude)
stonecut remove-skills --target ~/.claude-acme
```
