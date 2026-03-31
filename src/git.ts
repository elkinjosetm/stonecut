/**
 * Git branch-level operations — branch management, working tree checks, and PR creation.
 *
 * All functions throw on failure. No process.exit, no console output.
 */

function runSync(
  cmd: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** Detect the remote's default branch, falling back to "main". */
export function defaultBranch(): string {
  const result = runSync([
    "git",
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  ]);
  if (result.exitCode === 0) {
    const ref = result.stdout.trim();
    const prefix = "refs/remotes/origin/";
    if (ref.startsWith(prefix)) {
      const branch = ref.slice(prefix.length);
      if (branch) {
        return branch;
      }
    }
  }
  return "main";
}

/** Throw if the working tree has uncommitted changes. */
export function ensureCleanTree(): void {
  const result = runSync(["git", "status", "--porcelain"]);
  if (result.stdout.trim()) {
    throw new Error(
      "Working tree has uncommitted changes. Commit or stash them first.",
    );
  }
}

/** Check out the branch if it exists locally, otherwise create it. */
export function checkoutOrCreateBranch(branch: string): void {
  const verify = runSync(["git", "rev-parse", "--verify", branch]);
  if (verify.exitCode === 0) {
    const checkout = runSync(["git", "checkout", branch]);
    if (checkout.exitCode !== 0) {
      throw new Error(`Failed to checkout branch ${branch}: ${checkout.stderr.trim()}`);
    }
  } else {
    const create = runSync(["git", "checkout", "-b", branch]);
    if (create.exitCode !== 0) {
      throw new Error(`Failed to create branch ${branch}: ${create.stderr.trim()}`);
    }
  }
}

/** Push the branch to the remote with upstream tracking. */
export function pushBranch(branch: string): void {
  const result = runSync(["git", "push", "-u", "origin", branch]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to push branch ${branch}: ${result.stderr.trim()}`);
  }
}

/** Create a pull request via the gh CLI. */
export function createPr(
  title: string,
  body: string,
  baseBranch: string,
): void {
  const result = runSync([
    "gh",
    "pr",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--base",
    baseBranch,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create PR: ${result.stderr.trim()}`);
  }
}
