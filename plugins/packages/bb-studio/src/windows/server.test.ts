import { expect, it, vi } from "vitest";
import { MAIN_WINDOW_CHANNEL } from "./shared";
import { windowRelayHandlers } from "./server";

it("relays a window's Open in BB to the main window", () => {
  const publish = vi.fn();
  expect(windowRelayHandlers(publish)["window.openInMain"]({ path: "/threads/thr_bot" })).toEqual({ ok: true });
  expect(publish).toHaveBeenCalledWith(MAIN_WINDOW_CHANNEL, { path: "/threads/thr_bot" });
});

it("relays a window's BB command, web address and link to the main window", () => {
  const publish = vi.fn();
  const handlers = windowRelayHandlers(publish);
  expect(handlers["window.runInMain"]({ kind: "command", commandId: "app:window.new" })).toEqual({ ok: true });
  expect(handlers["window.runInMain"]({ kind: "url", url: "https://example.com/" })).toEqual({ ok: true });
  expect(handlers["window.runInMain"]({ kind: "link", link: "bb://page/pg_1", how: "window" })).toEqual({ ok: true });
  expect(publish.mock.calls).toEqual([[MAIN_WINDOW_CHANNEL, { command: "app:window.new" }], [MAIN_WINDOW_CHANNEL, { url: "https://example.com/" }], [MAIN_WINDOW_CHANNEL, { link: "bb://page/pg_1", how: "window" }]]);
});
