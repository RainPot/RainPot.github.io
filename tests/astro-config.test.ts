import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("astro react integration config", () => {
  it("prebundles react-dom client entry for browser hydration", () => {
    const config = readFileSync("astro.config.mjs", "utf8");

    expect(config).toContain('integrations: [react()]');
    expect(config).toContain('optimizeDeps: {');
    expect(config).toContain('include: ["react", "react-dom/client"]');
  });
});
