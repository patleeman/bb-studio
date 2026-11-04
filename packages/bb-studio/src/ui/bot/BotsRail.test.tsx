// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

const open = vi.hoisted(() => vi.fn());
vi.mock("../../kit/app/index", () => ({ openAppPath: open }));
vi.mock("../live", () => ({ useLive: () => ({ data: { bots: [{ botId: "b", name: "Nia", attention: { reason: "Asked you a question", count: 1, unread: 0, since: 1 }, working: false }] } }) }));
import { BotsPanel, useBotsBadge } from "./BotsRail";

test("the rail's Bots item opens the Bot page in place of its own address", () => {
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<BotsPanel />));
  expect(open).toHaveBeenCalledWith("/plugins/studio/studio/bot", { replace: true });
  act(() => root.unmount());
});

test("its badge comes from every Bot's attention", () => {
  let badge: unknown;
  function Probe() { badge = useBotsBadge(); return null; }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  expect(badge).toEqual({ count: 1, tone: "critical", label: "Nia needs you" });
  act(() => root.unmount());
});
