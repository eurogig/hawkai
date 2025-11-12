import { describe, expect, it } from "vitest";
import { parseGitHubUrl } from "./url";

describe("parseGitHubUrl", () => {
  it("parses basic repo URL", () => {
    const context = parseGitHubUrl("https://github.com/vercel/next.js");
    expect(context.owner).toBe("vercel");
    expect(context.repo).toBe("next.js");
    expect(context.branch).toBe("main");
  });

  it("parses tree URL with branch", () => {
    const context = parseGitHubUrl("https://github.com/vercel/next.js/tree/canary");
    expect(context.branch).toBe("canary");
  });

  it("throws on invalid URL", () => {
    expect(() => parseGitHubUrl("https://example.com/repo"))
      .toThrowError("Invalid GitHub URL");
  });
});
