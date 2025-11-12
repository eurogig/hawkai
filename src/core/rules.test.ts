import { describe, expect, it } from "vitest";
import type { RuleDefinition } from "@/types";
import { compileRules, ruleAppliesToPath } from "./rules";

describe("ruleAppliesToPath", () => {
  const defs: RuleDefinition[] = [
    {
      id: "TEST",
      title: "Test rule",
      severity: "low",
      category: "Test",
      owasp: [],
      fileGlobs: ["**/*.ts"],
      contentRegex: "todo",
      evidenceHint: "",
      remediation: "",
      confidence: 0.5
    }
  ];
  const [rule] = compileRules(defs);

  it("matches files that fit glob", () => {
    expect(ruleAppliesToPath(rule, "src/app.ts")).toBe(true);
  });

  it("does not match files that don't fit glob", () => {
    expect(ruleAppliesToPath(rule, "src/styles.css")).toBe(false);
  });
});
