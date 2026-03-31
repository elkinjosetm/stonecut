# Forge — Design Document

Forge is a CLI tool that executes PRD-driven development workflows using agentic coding CLIs. It picks up issues (vertical slices from a PRD), spawns headless CLI sessions to implement them, handles bookkeeping, and creates pull requests with execution reports.

This document captures the design decisions for the initial build and future roadmap.

## Naming

- **Project name:** Forge (repo: forge-orchestrator)
- **CLI command:** `forge`
- **Rationale:** A PRD is a blueprint, issues are the pieces, the tool forges them into reality. The primary execution entry point is `forge run`, with source selection handled by flags.

## CLI Commands

```
forge run --local <name> -i <N|all> [--runner <name>]
forge run --github <number> -i <N|all> [--runner <name>]
```

### Flags

| Flag           | Alias | Required | Description                                   |
| -------------- | ----- | -------- | --------------------------------------------- |
| `--iterations` | `-i`  | Always   | Number of issues to process, or `all`         |
| `--runner`     | —     | No       | Agentic CLI runner to use (default: `claude`) |

- Missing required args produce an error with help text.
- `--help` available on every command.

### Sources

- **`forge run --local <name>`** — local PRD. Looks in `.forge/<name>/` for `prd.md` and `issues/`.
- **`forge run --github <number>`** — GitHub PRD. Issue number on the current repo, tasks are sub-issues.

## Runner Architecture

Forge uses a runner abstraction to support multiple agentic coding CLIs. The architecture consists of:

### Runner Interface

A `Runner` interface defines a single method:

```typescript
interface Runner {
  run(prompt: string): Promise<RunResult>;
}
```

### RunResult

`RunResult` is a type that encapsulates the outcome of a single execution:

- `success: boolean` — whether the task completed successfully
- `exitCode: number` — raw exit code from the subprocess
- `durationSeconds: number` — wall-clock time of the execution
- `output: string | null` — captured stdout
- `error: string | null` — human-readable error message if the task failed

Each adapter is responsible for interpreting its CLI's output and translating it into this common structure. The orchestration loop only inspects `success` and `error`.

### ClaudeRunner

The default runner. Spawns `claude -p --output-format json` and parses the JSON output to extract the `subtype` field. Returns `success=true` only when `subtype == "success"`. Translates error subtypes (`error_max_turns`, `error_max_budget_usd`) into human-readable messages.

### Registry

The `runners/` module exposes `getRunner(name: string): Runner`. Unknown names throw a descriptive error listing available runners. Adding a new runner means implementing a single adapter class and registering it.

## Error Handling

Modules throw typed errors. Only `cli.ts` catches errors, formats user-facing messages, and calls `process.exit()`. No module imports or references the CLI framework directly. This decouples business logic from presentation and simplifies testing.

## Execution Flow

1. Picks the next incomplete issue.
2. Prompts for branch name and base branch before first execution.
3. Builds prompt from template.
4. Spawns headless session via the selected runner.
5. On completion:
   - Inspect `RunResult.success`.
   - On success: close issue / update `status.json`, log to `progress.txt`.
   - On failure: record error, move on.
6. Loops until iterations exhausted.
7. After all iterations: push branch, create PR with Forge Report.

### Prompt

Single `execute.md` template with placeholders. The template is CLI-agnostic — runner-specific behavior is encapsulated in the adapter, not the prompt.

## Pre-execution Flow

Before spawning the first session, Forge prompts the user:

1. **Branch name** — with a sensible suggestion using the unified `forge/<slug>` convention. Local mode uses the spec name, GitHub mode uses the PRD title slug, and GitHub falls back to `forge/issue-<number>` when needed.
2. **Base branch / PR target** — suggests `main`.

Interactive prompts use `@clack/prompts`.

## PR Report

At the end of a run, Forge pushes the branch and creates a PR with a report:

```markdown
## Forge Report

**Runner:** claude

- #1 Setup database schema: completed
- #2 API endpoints: failed — max turns exceeded
- #3 Auth middleware: completed
```

In GitHub mode, the PR title is the PRD issue title, with `PRD #<number>` as the fallback when the title is unavailable.

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

- **Language:** TypeScript
- **Runtime:** Bun
- **CLI framework:** Commander.js
- **Interactive prompts:** @clack/prompts
- **Prompt templates:** Markdown files interpolated with template literals

## Project Structure

```
prd-forge/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts              # Commander.js app, subcommands
│   ├── github.ts           # GitHub/gh CLI integration
│   ├── local.ts            # local spec operations
│   ├── runner.ts           # Runner interface, RunResult, orchestration loop
│   ├── git.ts              # git operations and commit flow
│   ├── prompt.ts           # template loading and rendering
│   ├── naming.ts           # branch name generation
│   ├── types.ts            # shared types
│   ├── skills.ts           # skill symlink management
│   ├── runners/
│   │   ├── index.ts        # getRunner() registry
│   │   ├── claude.ts       # ClaudeRunner adapter
│   │   └── codex.ts        # CodexRunner adapter
│   ├── templates/
│   │   └── execute.md      # prompt template
│   └── skills/
│       ├── forge-interview/
│       ├── forge-prd/
│       └── forge-issues/
└── tests/
    ├── cli.test.ts
    ├── local.test.ts
    ├── github.test.ts
    ├── runners.test.ts
    ├── commit-flow.test.ts
    ├── git.test.ts
    ├── naming.test.ts
    ├── prompt.test.ts
    ├── scaffold.test.ts
    └── skills.test.ts
```

Skills remain as Claude Code skills. They are not invoked by the CLI on day one but live in the repo for future integration.

---

## Pipeline

Ideas can come from anywhere — a GitHub issue, a Jira ticket, a Slack thread, an MCP server, or just a conversation. Forge doesn't prescribe where ideas originate. The pipeline starts once you're ready to act on one:

1. **Interview** — Stress-test the idea via `/forge-interview`.
2. **PRD** — Write the spec via `/forge-prd`. Saves to a local file (`.forge/<name>/prd.md`) or a GitHub issue labeled `prd`.
3. **Issues** — Break the PRD into vertical slices via `/forge-issues`. Creates local markdown files or GitHub sub-issues.
4. **Execute** — `forge run` picks up the issues and implements them sequentially.

### Suggested practice: managing your idea backlog with GitHub labels

For projects using GitHub issues, we recommend a label-driven flow to track ideas before they enter the pipeline:

1. **Capture** — Create a GitHub issue with the `roadmap` label. This is the idea backlog entry, regardless of where the idea originated.
2. **Interview** — Run `/forge-interview` on the idea. Discussion happens on the roadmap issue.
3. **PRD** — Run `/forge-prd`. The roadmap issue is closed with a comment linking forward to the new PRD issue. The PRD issue is created with the `prd` label and links back to the roadmap issue for history.
4. **Issues** — Run `/forge-issues`. Sub-issues are created and linked to the PRD issue.
5. **Execute** — `forge run --github <prd_number>` implements the sub-issues. Each is closed on completion.
6. **PR** — Forge pushes the branch and creates a PR. The PR body includes "Closes #prd_number", so the PRD issue is auto-closed when the PR merges.

This keeps each artifact (idea, spec, implementation tickets) as a separate issue with a clear purpose and traceable lineage.

See [GitHub issues labeled `roadmap`](https://github.com/elkinjosetm/prd-forge/labels/roadmap) for current ideas.
