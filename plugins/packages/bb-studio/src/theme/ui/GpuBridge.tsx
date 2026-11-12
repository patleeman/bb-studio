import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useRef } from "react";
import type { rpcContract } from "../../contract";
import { browserCheckContext, handleGpuRequest, measuredLines, THEME_GPU_CHANNEL } from "../gpu";

export function canMeasureHere(doc: Document): boolean {
  return doc.visibilityState !== "hidden" && typeof doc.defaultView?.WebGLRenderingContext === "function";
}

export function ThemeGpuBridge() {
  const rpc = useRpc<typeof rpcContract>();
  const latest = useRef(rpc);
  latest.current = rpc;
  useRealtime(THEME_GPU_CHANNEL, (payload) => {
    const client = latest.current;
    void handleGpuRequest(payload, {
      canMeasure: () => canMeasureHere(document),
      claim: async (requestId) => (await client.call("theme_gpu_claim", { requestId })).go,
      reply: (requestId, results) => client.call("theme_gpu_reply", { requestId, results }),
      measure: (theme) => {
        const context = browserCheckContext(document);
        try { return measuredLines(theme, { createContext: context.createContext }); } finally { context.release(); }
      },
    });
  });
  return null;
}
