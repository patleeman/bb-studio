// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MirrorBox, takeOverBlocker, type MirrorStatus } from "./mirror-banner";

describe("takeOverBlocker", () => {
  it("blocks while the thread runs at the source", () => {
    expect(takeOverBlocker({ mirrored: true, readOnly: true, sourceStatus: "active", sourceQueuedMessages: 0 })).toBe("running in bb");
  });
  it("blocks while the source has queued messages", () => {
    expect(takeOverBlocker({ mirrored: true, readOnly: true, sourceStatus: "idle", sourceQueuedMessages: 2 })).toBe("messages queued in bb");
  });
  it("allows an idle thread with nothing queued", () => {
    expect(takeOverBlocker({ mirrored: true, readOnly: true, sourceStatus: "idle", sourceQueuedMessages: 0 })).toBeNull();
  });
});

describe("MirrorBox", () => {
  const idle: MirrorStatus = { mirrored: true, readOnly: true, sourceStatus: "idle", sourceQueuedMessages: 0 };
  let root: Root;
  let host: HTMLDivElement;
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ note: "Main now belongs to BB Studio." }), { status: 200 }));
  const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
  const press = (key: string) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("claims lost focus after the Take over button, so the next Tab can't reach it", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => root.render(<MirrorBox threadId="main" status={idle} title="Main" />));
    const description = $('[data-testid="mirror-description"]')!;
    expect(document.activeElement).toBe(description);
    const button = $('[data-testid="mirror-take-over"]')!;
    expect(button.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelectorAll("button, [href], input, textarea, [tabindex]:not([tabindex='-1'])")).toHaveLength(1);
  });

  it("never takes focus from somewhere else", () => {
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    act(() => root.render(<MirrorBox threadId="main" status={idle} title="Main" />));
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("asks before taking over, with Cancel focused, and Enter or Escape there takes nothing over", async () => {
    act(() => root.render(<MirrorBox threadId="main" status={idle} title="Main" />));
    act(() => $('[data-testid="mirror-take-over"]')!.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('[data-testid="mirror-confirm"]')?.textContent).toContain("Take over Main?");
    expect($('[data-testid="mirror-confirm"]')?.textContent).toContain("It stops following bb.");
    expect(document.activeElement).toBe($('[data-testid="mirror-confirm-cancel"]'));
    act(() => (document.activeElement as HTMLElement).click());
    expect($('[data-testid="mirror-confirm"]')).toBeNull();
    act(() => $('[data-testid="mirror-take-over"]')!.click());
    press("Escape");
    expect($('[data-testid="mirror-confirm"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes over only from the confirmation's own Take over", async () => {
    act(() => root.render(<MirrorBox threadId="main" status={idle} title="Main" />));
    act(() => $('[data-testid="mirror-take-over"]')!.click());
    await act(async () => { $('[data-testid="mirror-confirm-take-over"]')!.click(); });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/fork/import/threads/main/take-over", { method: "POST" });
    expect($('[data-testid="mirror-banner-done"]')?.textContent).toBe("Main now belongs to BB Studio.");
  });

  it("can't be started while bb still runs the thread", () => {
    act(() => root.render(<MirrorBox threadId="main" status={{ ...idle, sourceStatus: "active" }} title="Main" />));
    expect(($('[data-testid="mirror-take-over"]') as HTMLButtonElement).disabled).toBe(true);
    expect($('[data-testid="mirror-heading"]')?.textContent).toBe("Read-only · running in bb");
  });

  it("reads Read-only alone when it can be taken over", () => {
    act(() => root.render(<MirrorBox threadId="main" status={idle} title="Main" />));
    expect($('[data-testid="mirror-heading"]')?.textContent).toBe("Read-only");
    expect($('[data-testid="mirror-description"]')?.textContent).toBe("");
  });
});
