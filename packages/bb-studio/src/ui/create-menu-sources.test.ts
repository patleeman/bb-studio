import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Every New menu draws useCreateEntries' list; none keeps a list of its own.
it.each(["StudioPanel.tsx", "StudioSidebar.tsx", "studio-tab/StudioTab.tsx"])("%s builds its New menu from the shared list", (file) => {
  const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  expect(source).toContain("useCreateEntries(");
  expect(source).toContain("runCreateEntry(");
  expect(source).not.toMatch(/Record a call|openCallPicker|createStudioItem|extraCreateItems/);
});
