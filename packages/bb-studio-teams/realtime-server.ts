import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ChangeEvent } from "./realtime";

export function publishChange(bb: BbPluginApi, scope: ChangeEvent["scope"] = "all", id?: string) {
  const event: ChangeEvent = { revision: randomUUID(), scope, ...(id ? { id } : {}) };
  bb.realtime.publish("scoped-changed", event);
}
