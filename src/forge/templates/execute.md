You are executing a single task from {task_source}.

## Instructions
1. Read the PRD below — it contains the full context, architecture, and constraints.
2. Read the issue spec below — it contains exactly what to build and the acceptance criteria.
3. Implement everything described in the issue spec.
4. Verify your work compiles and passes any validation described in the issue.
5. Commit all changes in a single commit with message: <concise description of what was built>{commit_suffix}
{bookkeeping}
IMPORTANT:
- Do ONLY this one issue. Stop after committing{bookkeeping_stop}.
- Do NOT modify files outside the scope of this issue unless fixing an import path that changed.
- Scope lint to specific files — do not run project-wide lint that auto-fixes unrelated files.

---

## PRD

{prd_content}

---

## Issue {issue_number}: {issue_filename}

{issue_content}
