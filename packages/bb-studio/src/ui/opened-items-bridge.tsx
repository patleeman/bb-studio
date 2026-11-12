import { useEffect } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { setOpenedRecorder } from "./opened-items";

/** Always mounted: records opened items as Studio tabs (see opened-items.ts). */
export function OpenedItemsBridge() {
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => setOpenedRecorder((path) => rpc.call("visitTab", { path }).then(({ tab }) => tab?.title || null)), [rpc]);
  return null;
}
