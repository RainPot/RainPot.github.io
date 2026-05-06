import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getHeaderCondensedState } from "../src/scripts/header";

describe("header scroll state", () => {
  it("uses separate enter and exit thresholds to avoid flicker near the condensed boundary", () => {
    expect(getHeaderCondensedState(95, false)).toBe(false);
    expect(getHeaderCondensedState(96, false)).toBe(true);
    expect(getHeaderCondensedState(64, true)).toBe(true);
    expect(getHeaderCondensedState(48, true)).toBe(false);
  });

  it("keeps the condensed header shell in the document flow", () => {
    const css = readFileSync("src/styles/global.css", "utf8");
    const condensedHeader = css.match(/body\.header-condensed \.site-header \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";
    const condensedNav = css.match(/body\.header-condensed \.nav-links \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";

    expect(condensedHeader).not.toContain("position: fixed");
    expect(condensedNav).toContain("position: fixed");
  });

  it("keeps the full header chrome transparent so particles remain visible behind it", () => {
    const css = readFileSync("src/styles/global.css", "utf8");
    const headerRules = css.match(/\.site-header \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";
    const navRules = css.match(/\.nav-links \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";
    const condensedNavRules = css.match(/body\.header-condensed \.nav-links \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";

    expect(headerRules).toContain("background: transparent");
    expect(navRules).toContain("background: transparent");
    expect(condensedNavRules).toContain("background: transparent");
  });

  it("does not inject a skip link into the base layout", () => {
    const layout = readFileSync("src/layouts/BaseLayout.astro", "utf8");
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(layout).not.toContain('class="skip-link"');
    expect(css).not.toContain(".skip-link");
  });
});
