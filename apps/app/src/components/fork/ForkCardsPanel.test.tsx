// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { forkCascade } from "@/test/fork-css-cascade";

const root = document.documentElement;

function layout(framed: boolean) {
  const app = document.createElement("div");
  app.setAttribute("data-testid", "app-layout-root");
  if (framed) app.setAttribute("data-framed", "");
  const group = document.createElement("div");
  group.setAttribute("data-panel-group", "");
  const timeline = document.createElement("div");
  timeline.setAttribute("data-panel-id", "thread-detail-timeline-panel");
  timeline.setAttribute("data-panel-size", "50.0");
  const panel = document.createElement("div");
  panel.setAttribute("data-panel-id", "thread-detail-secondary-panel");
  const aside = document.createElement("aside");
  aside.setAttribute("data-surface-tone", "sidebar");
  panel.appendChild(aside);
  group.append(timeline, panel);
  app.appendChild(group);
  document.body.appendChild(app);
  return { timeline, panel, aside };
}

afterEach(() => {
  document.body.replaceChildren();
  root.removeAttribute("data-fork-cards");
});

describe("the workbench card", () => {
  it("starts one gap below the window's top in the framed layout", () => {
    root.setAttribute("data-fork-cards", "");
    const { aside } = layout(true);
    expect(forkCascade(aside, "top")).toBe("var(--fork-cards-gap)");
    expect(forkCascade(aside, "height")).toBe(
      "calc(100% - var(--fork-cards-gap))",
    );
    expect(forkCascade(aside, "margin-left")).toBe("var(--fork-cards-gap)");
    aside.setAttribute("inert", "");
    expect(forkCascade(aside, "top")).toBeNull();
  });

  it("keeps bb's top in the plain layout and without a card layout", () => {
    root.setAttribute("data-fork-cards", "");
    expect(forkCascade(layout(false).aside, "top")).toBeNull();
    document.body.replaceChildren();
    root.removeAttribute("data-fork-cards");
    expect(forkCascade(layout(true).aside, "top")).toBeNull();
  });

  it("leaves the panel's width and the conversation's share to bb", () => {
    root.setAttribute("data-fork-cards", "");
    const { timeline, panel, aside } = layout(true);
    expect(forkCascade(panel, "flex")).toBeNull();
    expect(forkCascade(timeline, "flex")).toBeNull();
    expect(forkCascade(aside, "width")).toBeNull();
  });
});
