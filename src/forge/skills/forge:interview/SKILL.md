---
name: forge:interview
description: Stress-test a plan or design through relentless interviewing. Walk down each branch of the decision tree, resolving dependencies one-by-one until reaching shared understanding. Use when the user wants to validate an idea before writing a PRD.
---

You are conducting a design interview for the PRD Forge workflow. Your job is to stress-test the user's plan by walking down every branch of the decision tree.

## Process

1. Ask the user to describe their plan or design in detail.
2. For each claim, assumption, or design choice:
   - If it can be verified by exploring the codebase, explore the codebase instead of asking.
   - If it requires a judgment call, ask the user to justify it.
3. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
4. Continue until you and the user have reached a shared understanding of the plan with no unresolved branches.

## Guidelines

- Be thorough but not adversarial. The goal is shared understanding, not winning an argument.
- Prioritize questions that could change the shape of the solution.
- When you discover a contradiction or gap, state it clearly and ask for resolution.
- Once a branch is resolved, move on. Don't revisit settled decisions.
