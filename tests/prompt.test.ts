import { describe, expect, test } from "bun:test";
import { renderLocal, renderGithub } from "../src/prompt.js";

describe("renderLocal", () => {
  test("interpolates all placeholders with local values", async () => {
    const result = await renderLocal({
      prdContent: "PRD body here",
      issueNumber: 3,
      issueFilename: "add-auth-module",
      issueContent: "Implement OAuth2 flow",
    });

    expect(result).toContain("a structured spec");
    expect(result).toContain("PRD body here");
    expect(result).toContain("Issue 3: add-auth-module");
    expect(result).toContain("Implement OAuth2 flow");
  });

  test("uses 'a structured spec' as task source", async () => {
    const result = await renderLocal({
      prdContent: "prd",
      issueNumber: 1,
      issueFilename: "file",
      issueContent: "content",
    });

    expect(result).toContain(
      "You are executing a single task from a structured spec.",
    );
    expect(result).not.toContain("a GitHub issue");
  });

  test("preserves multiline PRD and issue content", async () => {
    const prd = "Line 1\nLine 2\nLine 3";
    const issue = "Step A\nStep B\nStep C";
    const result = await renderLocal({
      prdContent: prd,
      issueNumber: 5,
      issueFilename: "multi-line",
      issueContent: issue,
    });

    expect(result).toContain(prd);
    expect(result).toContain(issue);
  });

  test("handles special characters in content", async () => {
    const result = await renderLocal({
      prdContent: "Use `code` and $variables",
      issueNumber: 7,
      issueFilename: "special-chars",
      issueContent: "Check {braces} and [brackets]",
    });

    expect(result).toContain("Use `code` and $variables");
    expect(result).toContain("Check {braces} and [brackets]");
  });
});

describe("renderGithub", () => {
  test("interpolates all placeholders with GitHub values", async () => {
    const result = await renderGithub({
      prdContent: "GitHub PRD body",
      issueNumber: 42,
      issueTitle: "Add login page",
      issueContent: "Build the login page with SSO",
    });

    expect(result).toContain("a GitHub issue");
    expect(result).toContain("GitHub PRD body");
    expect(result).toContain("Issue 42: Add login page");
    expect(result).toContain("Build the login page with SSO");
  });

  test("uses 'a GitHub issue' as task source", async () => {
    const result = await renderGithub({
      prdContent: "prd",
      issueNumber: 1,
      issueTitle: "title",
      issueContent: "content",
    });

    expect(result).toContain(
      "You are executing a single task from a GitHub issue.",
    );
    expect(result).not.toContain("a structured spec");
  });

  test("uses issueTitle as the filename field", async () => {
    const result = await renderGithub({
      prdContent: "prd",
      issueNumber: 10,
      issueTitle: "My Issue Title",
      issueContent: "body",
    });

    expect(result).toContain("Issue 10: My Issue Title");
  });

  test("preserves full template structure", async () => {
    const result = await renderGithub({
      prdContent: "prd content",
      issueNumber: 1,
      issueTitle: "title",
      issueContent: "issue content",
    });

    // Verify key template sections are present
    expect(result).toContain("## Instructions");
    expect(result).toContain("## PRD");
    expect(result).toContain("Do ONLY this one issue");
    expect(result).toContain("Do NOT commit");
  });
});
