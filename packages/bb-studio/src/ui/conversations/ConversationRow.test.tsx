// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ConversationRowView } from "./BotSidebarPanel";
import type { ConversationLine } from "./model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps a fork's ⑂ parent label outside the truncated title, so a long title cannot cut it off", async () => {
  const row = {
    threadId: "thr_demo000025", title: "Chief of Staff · Fable restarted the app six times to ship these one at a ti…", isMain: false,
    forkedFrom: { threadId: "thr_demo000022", messageId: "thr_demo000022:user-seed:131424", turnId: null, title: "Main" },
    updatedAt: Date.now(), latest: null, needsYou: null, running: false, selected: false,
  } as unknown as ConversationLine;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => { root.render(<ConversationRowView row={row} now={Date.now()} onOpen={() => {}} menuTarget={null} />); });
  const title = host.querySelector<HTMLElement>('[data-testid="conversation-title"]')!;
  const label = host.querySelector<HTMLElement>('[data-testid="forked-from"]')!;
  expect(label.textContent).toBe("⑂ Main");
  expect(title.textContent).toBe(row.title);
  expect(title.contains(label)).toBe(false);
  expect(label.className.split(" ")).toContain("shrink-0");
  expect(label.closest(".truncate")).toBe(label);
  act(() => root.unmount());
  host.remove();
});
