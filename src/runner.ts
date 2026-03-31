/**
 * Runner — commit flow and orchestration helpers.
 *
 * verifyAndFix: single check → fix cycle.
 * commitIssue: stage, commit, retry on failure up to maxRetries times.
 *
 * Modules throw on failure. No process.exit, no console output.
 */

import { commitChanges, stageChanges } from "./git";
import type { Runner, WorkingTreeSnapshot } from "./types";

/**
 * Single check → fix cycle.
 *
 * Runs `check`. If it passes, returns immediately. If it fails,
 * spawns the runner with a prompt built from the error output,
 * then runs the check once more.
 *
 * Returns [success, output] from the final check.
 */
export async function verifyAndFix(
  runner: Runner,
  check: () => [boolean, string],
  fixPrompt: (error: string) => string,
): Promise<[boolean, string]> {
  const [ok, output] = check();
  if (ok) {
    return [true, output];
  }
  await runner.run(fixPrompt(output));
  return check();
}

/**
 * Stage, commit, and retry on failure up to `maxRetries` times.
 *
 * Returns [success, output] where output is the commit or error
 * output from the last attempt.
 */
export async function commitIssue(
  runner: Runner,
  message: string,
  snapshot: WorkingTreeSnapshot,
  maxRetries: number = 3,
): Promise<[boolean, string]> {
  stageChanges(snapshot);

  let output = "";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const [ok, result] = await verifyAndFix(
      runner,
      () => commitChanges(message),
      (error) =>
        "The git commit failed with the following output. " +
        "Fix the issues and stop. Do not commit.\n\n" +
        error,
    );
    output = result;
    if (ok) {
      return [true, output];
    }
    // Re-stage after the fix attempt (runner may have changed files)
    stageChanges(snapshot);
  }

  return [false, output];
}
