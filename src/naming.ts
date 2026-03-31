/**
 * Naming helpers for branches and pull requests.
 */

/** Normalize a free-form title into a branch-safe slug. */
export function slugifyBranchComponent(value: string): string {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  normalized = normalized.replace(/-{2,}/g, "-");
  normalized = normalized.replace(/^-+|-+$/g, "");
  return normalized;
}
