/**
 * Prompt builder — loads and renders the execute.md template.
 */

import { join } from "node:path";

async function renderTemplate(
  vars: Record<string, string | number>,
): Promise<string> {
  const template = await Bun.file(
    join(import.meta.dir, "templates", "execute.md"),
  ).text();
  return template.replace(
    /\{(\w+)\}/g,
    (_, key: string) => String(vars[key] ?? `{${key}}`),
  );
}

export async function renderLocal({
  prdContent,
  issueNumber,
  issueFilename,
  issueContent,
}: {
  prdContent: string;
  issueNumber: number;
  issueFilename: string;
  issueContent: string;
}): Promise<string> {
  return renderTemplate({
    task_source: "a structured spec",
    prd_content: prdContent,
    issue_number: issueNumber,
    issue_filename: issueFilename,
    issue_content: issueContent,
  });
}

export async function renderGithub({
  prdContent,
  issueNumber,
  issueTitle,
  issueContent,
}: {
  prdContent: string;
  issueNumber: number;
  issueTitle: string;
  issueContent: string;
}): Promise<string> {
  return renderTemplate({
    task_source: "a GitHub issue",
    prd_content: prdContent,
    issue_number: issueNumber,
    issue_filename: issueTitle,
    issue_content: issueContent,
  });
}
