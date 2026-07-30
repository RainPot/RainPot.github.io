import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canZoomFurther, getFittedSize, getZoomScrollOffset } from "../src/lib/image-lightbox";

describe("image lightbox sizing", () => {
  it("scales a wide figure down to fit inside the viewport", () => {
    expect(getFittedSize({ width: 2276, height: 1161 }, { width: 1440, height: 900 }, { width: 72, height: 148 }))
      .toEqual({ width: 1368, height: 698 });
  });

  it("uses the height as the limit for portrait figures", () => {
    expect(getFittedSize({ width: 2059, height: 2359 }, { width: 1440, height: 900 }, { width: 72, height: 148 }))
      .toEqual({ width: 656, height: 752 });
  });

  it("never blows a small image up past its natural pixels", () => {
    expect(getFittedSize({ width: 420, height: 260 }, { width: 1440, height: 900 }))
      .toEqual({ width: 420, height: 260 });
  });

  it("returns zero size before the image reports its natural dimensions", () => {
    expect(getFittedSize({ width: 0, height: 0 }, { width: 1440, height: 900 }))
      .toEqual({ width: 0, height: 0 });
  });

  it("offers a second zoom level only when the fit actually shrank the image", () => {
    expect(canZoomFurther({ width: 2276, height: 1161 }, { width: 1368, height: 698 })).toBe(true);
    expect(canZoomFurther({ width: 420, height: 260 }, { width: 420, height: 260 })).toBe(false);
    expect(canZoomFurther({ width: 2276, height: 1161 }, { width: 0, height: 0 })).toBe(false);
  });
});

describe("image lightbox zoom scrolling", () => {
  it("centers the clicked point after zooming to full size", () => {
    expect(getZoomScrollOffset({ x: 600, y: 400 }, 2, { width: 1200, height: 700 }))
      .toEqual({ left: 600, top: 450 });
  });

  it("clamps to the top-left edge instead of scrolling negative", () => {
    expect(getZoomScrollOffset({ x: 40, y: 20 }, 2, { width: 1200, height: 700 }))
      .toEqual({ left: 0, top: 0 });
  });
});

describe("image lightbox wiring", () => {
  it("loads the lightbox script on the blog post layout", () => {
    expect(readFileSync("src/layouts/BlogPostLayout.astro", "utf8")).toContain('import "../scripts/image-lightbox"');
  });

  it("keeps the overlay hidden until it is opened", () => {
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(css).toContain(".image-lightbox[hidden] {\n  display: none;\n}");
    expect(css).toContain("body.lightbox-open {\n  overflow: hidden;\n}");
  });
});
