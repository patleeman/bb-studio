// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AppTitle } from "./app-title";

it("titles both app views alike: the name, then a Saved or Interactive badge", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const rename = vi.fn();
  for (const [type, label] of [["saved", "Saved"], ["interactive", "Interactive"]] as const) {
    act(() => root.render(<AppTitle type={type} title="Q3 report" onRename={rename} />));
    expect(container.querySelector("input")!.getAttribute("aria-label")).toBe("App title");
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("Q3 report");
    const badge = container.querySelector("[data-testid=app-type]")!;
    expect([badge.textContent, badge.getAttribute("aria-label")]).toEqual([label, `${label} app`]);
  }
  act(() => root.unmount());
});

it("is the header title of the artifact viewer and of the mini app's page and tab", () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  expect(source("../artifacts/ui/artifact-viewer.tsx")).toContain('<AppTitle type="saved"');
  expect(source("../minis/ui/mini-view.tsx").match(/<AppTitle [^>]*type="interactive"/g)).toHaveLength(2);
});
