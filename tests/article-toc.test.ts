import { describe, expect, it } from "vitest";
import { getActiveHeadingId, getCenteredScrollTop } from "../src/lib/article-toc";

describe("article toc helper", () => {
  it("uses the first heading before the reader reaches any section", () => {
    expect(getActiveHeadingId([
      { id: "intro", top: 220 },
      { id: "setup", top: 520 }
    ])).toBe("intro");
  });

  it("tracks the last heading that has crossed the threshold", () => {
    expect(getActiveHeadingId([
      { id: "intro", top: -20 },
      { id: "setup", top: 96 },
      { id: "details", top: 280 }
    ])).toBe("setup");
  });

  it("returns null when there are no headings", () => {
    expect(getActiveHeadingId([])).toBeNull();
  });

  it("centers the current toc item when possible", () => {
    expect(getCenteredScrollTop(300, 180, 24)).toBe(42);
    expect(getCenteredScrollTop(300, 60, 24)).toBe(0);
  });
});
