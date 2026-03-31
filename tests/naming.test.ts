import { describe, test, expect } from "bun:test";
import { slugifyBranchComponent } from "../src/naming";

describe("slugifyBranchComponent", () => {
  test("lowercases and replaces spaces with hyphens", () => {
    expect(slugifyBranchComponent("Customer Onboarding")).toBe(
      "customer-onboarding",
    );
  });

  test("replaces slashes and special characters", () => {
    expect(slugifyBranchComponent("OAuth / SSO polish")).toBe(
      "oauth-sso-polish",
    );
  });

  test("collapses consecutive hyphens", () => {
    expect(slugifyBranchComponent("foo---bar")).toBe("foo-bar");
  });

  test("strips leading and trailing hyphens", () => {
    expect(slugifyBranchComponent("-hello-world-")).toBe("hello-world");
  });

  test("strips leading and trailing whitespace", () => {
    expect(slugifyBranchComponent("  spaced out  ")).toBe("spaced-out");
  });

  test("returns empty string for all-special-character input", () => {
    expect(slugifyBranchComponent("!!!")).toBe("");
  });

  test("returns empty string for empty input", () => {
    expect(slugifyBranchComponent("")).toBe("");
  });

  test("returns empty string for whitespace-only input", () => {
    expect(slugifyBranchComponent("   ")).toBe("");
  });

  test("preserves digits", () => {
    expect(slugifyBranchComponent("issue 42 fix")).toBe("issue-42-fix");
  });

  test("handles mixed special characters", () => {
    expect(slugifyBranchComponent("feat: add (new) thing!")).toBe(
      "feat-add-new-thing",
    );
  });

  test("handles single word", () => {
    expect(slugifyBranchComponent("simple")).toBe("simple");
  });

  test("handles already-slugged input", () => {
    expect(slugifyBranchComponent("already-slugged")).toBe("already-slugged");
  });
});
