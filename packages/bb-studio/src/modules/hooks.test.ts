import { expect, it, vi } from "vitest";
import type { BbPluginApi, PluginHookHandler } from "@get-bb/plugin-sdk";
import { ModuleHooks } from "./hooks";
it("runs module admission handlers through one host hook and preserves waits and rejection", async () => {
  const on = vi.fn();
  const hooks = new ModuleHooks({ on } as unknown as BbPluginApi["experimental_hooks"]);
  const first = vi.fn(() => ({ action: "wait" as const, reason: "Capacity", sendAt: 200 }));
  const second = vi.fn(() => ({ action: "wait" as const, reason: "Rate", sendAt: 100 }));
  hooks.scope().on("message.dispatch", first);
  hooks.scope().on("message.dispatch", second);
  hooks.register();
  expect(on).toHaveBeenCalledTimes(1);
  const dispatch = on.mock.calls[0]![1] as PluginHookHandler<"message.dispatch">;
  expect(await dispatch({} as never)).toEqual({ action: "wait", reason: "Capacity; Rate", sendAt: 100 });
  hooks.scope().on("message.dispatch", () => ({ action: "reject", message: "Denied" }));
  expect(await dispatch({} as never)).toEqual({ action: "reject", message: "Denied" });
});
it("runs all proceed handlers and propagates failures", async () => {
  const on = vi.fn(); const hooks = new ModuleHooks({ on } as unknown as BbPluginApi["experimental_hooks"]);
  const next = vi.fn(() => ({ action: "proceed" as const }));
  hooks.scope().on("message.dispatch", next); hooks.scope().on("message.dispatch", next); hooks.register();
  const dispatch = on.mock.calls[0]![1];
  expect(await dispatch({})).toEqual({ action: "proceed" }); expect(next).toHaveBeenCalledTimes(2);
  hooks.scope().on("message.dispatch", () => { throw new Error("Unavailable"); });
  await expect(dispatch({})).rejects.toThrow("Unavailable");
});
