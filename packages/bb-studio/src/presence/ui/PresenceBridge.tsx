import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useRef } from "react";
import type { rpcContract } from "../../contract";
import { PRESENCE_CHECK_CHANNEL_NAME, handleCheckRequest } from "../check-bridge";
import { measurePresence } from "../measure";
import { inHostWindow } from "../../kit/app/windows";
import { canDraw } from "./PresenceView";

export function PresenceCheckBridge() {
  const rpc = useRpc<typeof rpcContract>();
  const latest = useRef(rpc);
  latest.current = rpc;
  useRealtime(PRESENCE_CHECK_CHANNEL_NAME, (payload) => {
    const client = latest.current;
    void handleCheckRequest(payload, {
      canMeasure: () => canDraw() && document.visibilityState !== "hidden" && typeof Worker === "function",
      claim: async (requestId) => (await client.call("presence_check_claim", { requestId })).go,
      reply: (requestId, results) => client.call("presence_check_reply", { requestId, results }),
      measure: (code) => measurePresence(code, document),
    });
  });
  return null;
}

export function PresenceCheckHost() {
  return inHostWindow() ? null : <PresenceCheckBridge />;
}
