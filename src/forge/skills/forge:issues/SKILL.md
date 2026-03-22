---
name: forge:issues
description: Break a PRD into independently-grabbable GitHub issues or local markdown files using tracer-bullet vertical slices. Use when the user wants to convert a PRD into implementation tickets or work items.
---

You are breaking a PRD into issues as part of the PRD Forge workflow. Each issue should be a thin vertical slice that cuts through all integration layers end-to-end.

## Process

### 1. Locate the PRD

Determine where the PRD lives. Check these in order:

1. **Conversation context** — If a PRD was created earlier in this conversation (via `/forge:prd` or otherwise), you already know where it is. State where you found it and confirm with the user.
2. **Ask the user** — If no PRD is in context, ask: "Where is the PRD? Give me a local file path (e.g., `specs/ASC-1/prd.md`) or a GitHub issue number."

If given a GitHub issue number, fetch it with `gh issue view <number>`.
If given a local path, read the file.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code.

### 3. Draft vertical slices

Break the PRD into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories from the PRD this addresses

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Determine where to create the issues

Default to **matching the PRD location**:

- If the PRD is a **local file** (e.g., `specs/ASC-1/prd.md`), default to creating issues in the same directory under `issues/` (e.g., `specs/ASC-1/issues/01-short-title.md`).
- If the PRD is a **GitHub issue**, default to creating issues as GitHub issues using `gh issue create`.

Confirm with the user before creating. If they want a different destination, respect that.

### 6. Create the issues

#### Local files

Create each issue as a markdown file in the issues directory. Use zero-padded numbering with a kebab-case descriptive suffix:

```
specs/<name>/issues/
  01-short-descriptive-title.md
  02-another-slice-title.md
  ...
```

Create issues in dependency order (blockers first). Use the local issue template below.

<local-issue-template>
# Issue <N>: <Title>

## Parent PRD

See `specs/<name>/prd.md`

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Reference specific sections of the parent PRD rather than duplicating content.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- Blocked by Issue <N> (if any)

Or "None — can start immediately" if no blockers.

## User stories addressed

Reference by number from the parent PRD:

- User story 3
- User story 7

</local-issue-template>

#### GitHub issues

Create each issue using `gh issue create`. Create in dependency order so you can reference real issue numbers in the "Blocked by" field.

After creating each GitHub issue, link it as a sub-issue of the PRD:

```bash
# Get node IDs
PRD_NODE_ID=$(gh api repos/{owner}/{repo}/issues/{prd_number} --jq '.node_id')
ISSUE_NODE_ID=$(gh api repos/{owner}/{repo}/issues/{new_issue_number} --jq '.node_id')

# Link as sub-issue
gh api graphql -f query="mutation { addSubIssue(input: { issueId: \"$PRD_NODE_ID\" subIssueId: \"$ISSUE_NODE_ID\" }) { subIssue { number } } }"
```

<github-issue-template>
## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Reference specific sections of the parent PRD rather than duplicating content.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- Blocked by #<issue-number> (if any)

Or "None - can start immediately" if no blockers.

## User stories addressed

Reference by number from the parent PRD:

- User story 3
- User story 7

</github-issue-template>

Do NOT close or modify the parent PRD issue (if it's a GitHub issue).

### 7. Configure execution (local files only)

> **Note:** GitHub mode does not need a config.json. The forge scripts infer the branch (`prd/<issue-number>`) and commit format (`<description> (#<issue-number>)`) automatically from the PRD issue.

After creating local issue files, configure how the forge scripts will execute this spec. Write a `config.json` to the spec directory:

```json
{
  "branch": "<branch-name-or-null>",
  "commitPrefix": "<prefix-or-null>"
}
```

**Branch** — Ask the user: "What branch should this work happen on?" If they provide a name, set `branch` to that value and create the branch (from the current HEAD) if it doesn't already exist. If they want to stay on the current branch, set to `null`.

**Commit prefix** — Determine from the issue structure:
- If all issues share the same commit prefix (single-ticket spec), set `commitPrefix` to that value (e.g., `"SCP-1099"`). The forge scripts will use `<commitPrefix> :: <description>` for commit messages.
- If each issue defines its own commit message (multi-ticket spec where issues reference different ticket IDs), set `commitPrefix` to `null`. The forge scripts will omit the commit step and let each issue's acceptance criteria define the commit message.

When in doubt, ask the user which approach they prefer.
