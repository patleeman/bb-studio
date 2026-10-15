// RPC between a live HTML artifact's viewer and Studio. Each open viewer has
// its own `clientId`, so Studio can tell copies apart: an agent's action runs
// in the copy the user touched last, and a viewer ignores its own saves.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const id = z.string().min(1).max(100);
const client = z.string().min(8).max(64);
const actionName = z.string().min(1).max(100);
const ok = z.object({ ok: z.boolean() });

export const liveContract = defineRpcContract({
  "artifacts.live.save": { input: z.object({ id, clientId: client, state: z.unknown() }), output: z.object({ version: z.number() }) },
  "artifacts.live.emit": { input: z.object({ id, name: z.string().min(1).max(100), data: z.unknown() }), output: ok },
  /** The page's actions, sent when it exposes them and then as a heartbeat while it's open. */
  "artifacts.live.open": { input: z.object({ id, clientId: client, actions: z.array(actionName).max(100) }), output: ok },
  "artifacts.live.touch": { input: z.object({ id, clientId: client }), output: ok },
  "artifacts.live.close": { input: z.object({ id, clientId: client }), output: ok },
  "artifacts.live.result": {
    input: z.object({ commandId: z.string().min(1).max(100), clientId: client, ok: z.boolean(), value: z.unknown().optional(), error: z.string().max(2000).optional() }),
    output: ok,
  },
  /** Keeps what the page sent; the viewer then mentions it in the composer. */
  "artifacts.live.take": { input: z.object({ id, label: z.string().min(1).max(120), data: z.unknown() }), output: z.object({ takeId: z.string() }) },
});
