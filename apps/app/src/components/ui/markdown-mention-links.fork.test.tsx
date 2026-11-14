// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleLinkClick } from "@/lib/fork-link-handlers";
import { MarkdownPreview } from "./markdown-preview";
import {
  forkMentionHref,
  isMentionHref,
  parseMentionHref,
} from "./markdown-mention-links.fork";
import type { MarkdownLinkRouting } from "./markdown-link-routing";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      ...actual.sdk,
      threads: { ...actual.sdk.threads, resolveMentions: vi.fn(async () => []) },
    },
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const WORKSPACE = "/work/workspaces/thr_main";

function fileRouting(onOpenLink = vi.fn(() => true)): MarkdownLinkRouting {
  return {
    localFile: {
      absoluteLinks: { kind: "contained", rootPath: WORKSPACE },
      relativeLinks: { baseDir: WORKSPACE, rootPath: WORKSPACE },
      onOpenLink,
    },
  } as unknown as MarkdownLinkRouting;
}

function click(anchor: Element): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, "target", { value: anchor });
  return event;
}

describe("@ mention links in chat Markdown", () => {
  it("reads raw and encoded mentions, and nothing else", () => {
    expect(parseMentionHref("@thread:thr_abc")).toEqual({ kind: "thread", id: "thr_abc" });
    expect(parseMentionHref("%40page%3Apg_0123")).toEqual({ kind: "page", id: "pg_0123" });
    expect(isMentionHref("notes/@thread:thr_abc")).toBe(false);
    expect(isMentionHref("https://x.test/@thread:thr_abc")).toBe(false);
    expect(isMentionHref("docs/plan.md")).toBe(false);
    expect(isMentionHref(undefined)).toBe(false);
  });

  it("sends a thread mention to its conversation route and keeps other mentions raw", () => {
    expect(forkMentionHref("@thread:thr_abc")).toBe("/threads/thr_abc");
    expect(forkMentionHref("%40thread%3Athr_abc")).toBe("/threads/thr_abc");
    expect(forkMentionHref("@page:pg_0123")).toBe("@page:pg_0123");
    expect(forkMentionHref("docs/plan.md")).toBe("docs/plan.md");
  });

  it("renders [full report](@thread:…) as a link to the conversation, never a file", () => {
    const onOpenLink = vi.fn(() => true);
    const { container } = render(
      <MarkdownPreview content="The [full report](@thread:thr_abc) has it." linkRouting={fileRouting(onOpenLink)} />,
    );
    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("/threads/thr_abc");
    anchor.click();
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("keeps a page mention out of the file opener and hands a plain click to the plugins", () => {
    const onOpenLink = vi.fn(() => true);
    const { container } = render(
      <MarkdownPreview content="See [the plan](@page:pg_0123)." linkRouting={fileRouting(onOpenLink)} />,
    );
    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("@page:pg_0123");
    const openWithPlugin = vi.fn(() => true);
    const event = click(anchor);
    expect(handleLinkClick(event, openWithPlugin)).toBe(true);
    expect(openWithPlugin).toHaveBeenCalledWith("@page:pg_0123", expect.anything());
    expect(event.defaultPrevented).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("swallows a mention no plugin opens instead of opening a dead tab", () => {
    document.body.innerHTML = '<a href="@page:pg_gone">gone</a>';
    const anchor = document.querySelector("a")!;
    const event = click(anchor);
    expect(handleLinkClick(event, () => false)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("still opens ordinary relative file links as files", () => {
    const onOpenLink = vi.fn(() => true);
    const { container } = render(
      <MarkdownPreview content="Open [plan](docs/plan.md)." linkRouting={fileRouting(onOpenLink)} />,
    );
    container.querySelector("a")!.click();
    expect(onOpenLink).toHaveBeenCalledWith(expect.objectContaining({ path: `${WORKSPACE}/docs/plan.md` }));
  });
});
