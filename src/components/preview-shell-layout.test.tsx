import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  resolve(process.cwd(), "src/components/preview-shell.module.css"),
  "utf8",
);
const layout = readFileSync(
  resolve(process.cwd(), "src/app/layout.tsx"),
  "utf8",
);

describe("mobile preview shell layout", () => {
  it("keeps the preview badge in flow below the exit action", () => {
    expect(styles).toMatch(/\.previewBadge\s*\{[^}]*position:\s*static/);
    expect(styles).toMatch(/\.previewBadge\s*\{[^}]*max-width:\s*100%/);
  });

  it("reserves device safe area and keeps bottom navigation touch targets usable", () => {
    expect(styles).toMatch(/\.app\s*\{[^}]*padding-bottom:\s*calc\(64px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    expect(styles).toMatch(/\.sidebar\s*\{[^}]*height:\s*calc\(64px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    expect(styles).toMatch(/\.navItem\s*\{[^}]*min-height:\s*44px/);
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
  });
});
