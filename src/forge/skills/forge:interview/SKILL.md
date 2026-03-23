---
name: forge:interview
description: Stress-test a plan or design through relentless interviewing. Walk down each branch of the decision tree, resolving dependencies one-by-one until reaching shared understanding. Use when the user wants to validate an idea before writing a PRD.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Guidelines

- Be relentless. Push back on vague answers. The goal is stress-testing, not politeness.
- Prioritize questions that could change the shape of the solution.
- When you discover a contradiction or gap, state it clearly and demand resolution.
- For each question, provide your recommended answer.
- Once a branch is resolved, move on. Don't revisit settled decisions.

## Next Step

When the interview is complete and you've reached shared understanding, ask the user: "Ready to write the PRD? I can run `/forge:prd` next."
