---
name: forge:prd
description: Write a PRD through structured user interview, codebase exploration, and module design. Saves the result as a local file or GitHub issue. Use when the user wants to create a product requirements document or plan a new feature.
---

You are writing a PRD as part of the PRD Forge workflow. Follow these steps, skipping any that aren't necessary for the situation.

## Process

### 1. Gather context

Ask the user for a detailed description of the problem they want to solve and any ideas they have for the solution.

### 2. Explore the codebase

Explore the repo to verify the user's assertions and understand the current state of the code.

### 3. Interview

Interview the user relentlessly about every aspect of the plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

### 4. Design modules

Sketch out the major modules that need to be built or modified. Look for opportunities to extract deep modules — modules that encapsulate significant functionality behind a simple, testable interface that rarely changes.

Check with the user that these modules match their expectations. Ask which modules they want tests written for.

### 5. Choose a destination

Ask the user where to save the PRD:

- **Local file** — Save as `specs/<name>/prd.md` in the project. Ask the user: "What should I name this spec?" The name can be anything — a ticket ID (e.g., `ASC-1`), a descriptive slug (e.g., `auth-refactor`), or whatever fits. Create the `specs/<name>/` directory if it doesn't exist.
- **GitHub issue** — Create a GitHub issue using `gh issue create --label prd`. Before creating, ensure the `prd` label exists:

  ```bash
  # Only create the label if it doesn't already exist
  if ! gh label list --search "prd" --json name --jq '.[].name' | grep -qx "prd"; then
    gh label create prd --description "Product Requirements Document" --color "0052CC"
  fi
  ```

If the project already has a `specs/` directory, default to suggesting local. Otherwise, just ask.

### 6. Documentation impact check

Before writing the PRD, ensure that documentation impact has been explicitly addressed. Based on everything you've learned from the interview and codebase exploration, analyze which user-facing documentation artifacts (README, CLI help text, docs/ content) would be affected by these changes.

Present your assessment to the user for confirmation:

- If changes are needed, list the specific artifacts and what would need updating.
- If no changes are needed, state why (e.g., "Internal refactor — no user-facing behavior changes") and ask the user to confirm.

Record the confirmed answer for inclusion in the PRD's Documentation Impact section.

This step is a gate — do not proceed to writing the PRD until documentation impact is resolved.

### 7. Write the PRD

Once you have a complete understanding of the problem and solution, write the PRD using the template below and save it to the chosen destination.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Documentation Impact

Which user-facing documentation artifacts are affected by these changes:

- **README** — Which sections need adding or updating?
- **CLI help text** — Are commands, flags, or usage examples changing?
- **docs/ content** — Are there deeper documentation files that need updating?

If no documentation changes are needed, state why (e.g., "Internal refactor — no user-facing behavior changes"). This assessment should be provided by the model based on its analysis and confirmed by the user during the interview.

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>

## Next Step

Once the PRD is saved, ask the user: "Ready to break this into issues? I can run `/forge:issues` next."
