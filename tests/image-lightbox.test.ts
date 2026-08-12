import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  clampTransform,
  getFittedSize,
  getMaxScale,
  getNextIndex,
  getPanBounds,
  zoomAt
} from "../src/lib/image-lightbox";

describe("image lightbox sizing", () => {
  it("scales a wide figure down to fit inside the viewport", () => {
    expect(getFittedSize({ width: 2276, height: 1161 }, { width: 1440, height: 900 }, { width: 128, height: 96 }))
      .toEqual({ width: 1312, height: 669 });
  });

  it("uses the height as the limit for portrait figures", () => {
    expect(getFittedSize({ width: 2059, height: 2359 }, { width: 1440, height: 900 }, { width: 128, height: 96 }))
      .toEqual({ width: 702, height: 804 });
  });

  it("never blows a small image up past its natural pixels", () => {
    expect(getFittedSize({ width: 420, height: 260 }, { width: 1440, height: 900 }))
      .toEqual({ width: 420, height: 260 });
  });

  it("returns zero size before the image reports its natural dimensions", () => {
    expect(getFittedSize({ width: 0, height: 0 }, { width: 1440, height: 900 }))
      .toEqual({ width: 0, height: 0 });
  });
});

describe("image lightbox zoom limits", () => {
  it("lets a downscaled figure zoom back to its original pixels", () => {
    expect(getMaxScale({ width: 4000, height: 2000 }, { width: 1000, height: 500 })).toBe(4);
  });

  it("keeps a two-times floor so barely-shrunk figures are still readable", () => {
    expect(getMaxScale({ width: 2276, height: 1161 }, { width: 1312, height: 669 })).toBe(2);
    expect(getMaxScale({ width: 420, height: 260 }, { width: 420, height: 260 })).toBe(2);
  });

  it("caps the zoom before the image turns into noise", () => {
    expect(getMaxScale({ width: 4000, height: 2000 }, { width: 200, height: 100 })).toBe(6);
  });

  it("falls back to no zoom before the image reports its size", () => {
    expect(getMaxScale({ width: 0, height: 0 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe("image lightbox panning", () => {
  it("allows dragging only as far as the image overflows the stage", () => {
    expect(getPanBounds({ width: 1200, height: 600 }, 2, { width: 1000, height: 700 }))
      .toEqual({ width: 700, height: 250 });
  });

  it("pins the image when it still fits inside the stage", () => {
    expect(getPanBounds({ width: 800, height: 400 }, 1, { width: 1000, height: 700 }))
      .toEqual({ width: 0, height: 0 });
  });

  it("clamps an out-of-range drag back onto the edge", () => {
    expect(clampTransform({ scale: 2, x: 900, y: -400 }, { width: 1200, height: 600 }, { width: 1000, height: 700 }))
      .toEqual({ scale: 2, x: 700, y: -250 });
  });
});

describe("image lightbox zoom anchoring", () => {
  it("keeps the pixel under the cursor in place while zooming in", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }))
      .toEqual({ scale: 2, x: -100, y: -50 });
  });

  it("keeps that anchor when zooming back out from a panned position", () => {
    expect(zoomAt({ scale: 2, x: -100, y: -50 }, 1, { x: 100, y: 50 }))
      .toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("leaves the image alone when the scale does not change", () => {
    expect(zoomAt({ scale: 2, x: 30, y: 12 }, 2, { x: 100, y: 50 }))
      .toEqual({ scale: 2, x: 30, y: 12 });
  });
});

describe("image lightbox navigation", () => {
  it("walks through the gallery one figure at a time", () => {
    expect(getNextIndex(0, 4, 1)).toBe(1);
    expect(getNextIndex(3, 4, -1)).toBe(2);
  });

  it("stops at both ends instead of wrapping around", () => {
    expect(getNextIndex(0, 4, -1)).toBe(0);
    expect(getNextIndex(3, 4, 1)).toBe(3);
  });

  it("stays put when the article has a single figure", () => {
    expect(getNextIndex(0, 1, 1)).toBe(0);
  });
});

describe("image lightbox wiring", () => {
  const script = readFileSync("src/scripts/image-lightbox.ts", "utf8");

  it("loads the lightbox script on the blog post layout", () => {
    expect(readFileSync("src/layouts/BlogPostLayout.astro", "utf8")).toContain('import "../scripts/image-lightbox"');
  });

  it("keeps the overlay hidden until it is opened", () => {
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(css).toContain(".image-lightbox[hidden] {\n  display: none;\n}");
    expect(css).toContain("body.lightbox-open {\n  overflow: hidden;\n}");
  });

  it("shows no caption inside the viewer, so nothing covers the image", () => {
    expect(script).not.toContain("caption");
  });

  it("offers paging controls next to the image", () => {
    expect(script).toContain("data-lightbox-prev");
    expect(script).toContain("data-lightbox-next");
    expect(script).toContain("data-lightbox-counter");
  });
});
