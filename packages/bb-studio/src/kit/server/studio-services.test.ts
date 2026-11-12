import { z } from "zod";
import { studioSchemas } from "../contract";
import { createStudioNotifier } from "./core";
import { expect, it, vi } from "vitest";
import { studioServices } from "./studio-services";

it("validates service records with the public item reference constraints", async () => {
  const services = studioServices({ plugins: { async callRpc({ outputSchema }) {
    return outputSchema.parse({ outgoing: [{ from: { pluginId: "", id: "item" }, to: { pluginId: "pages", id: "other" }, source: "pages", kind: "mention" }], backlinks: [] });
  } } });
  await expect(services.links({ pluginId: "pages", id: "item" })).rejects.toThrow();
});

it("coalesces and retries in-process change notifications without calling RPC", async () => {
  vi.useFakeTimers();
  const notify = vi.fn().mockRejectedValueOnce(new Error("temporarily unavailable")).mockResolvedValue(undefined);
  const callRpc = vi.fn(async () => { throw new Error("RPC must not be used"); });
  const notifier = createStudioNotifier({ plugins: { callRpc }, pluginId: "pages", schemas: studioSchemas(z), notify });
  try {
    notifier.changed("pg_a");
    notifier.changed("pg_b");
    await vi.advanceTimersByTimeAsync(250);
    expect(notify).toHaveBeenCalledWith("pages", ["pg_a", "pg_b"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(notify).toHaveBeenLastCalledWith("pages", undefined);
    expect(callRpc).not.toHaveBeenCalled();
  } finally { notifier.dispose(); vi.useRealTimers(); }
});
