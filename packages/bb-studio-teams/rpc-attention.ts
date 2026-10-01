import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { rpcContract } from "./contract";
import type { Runtime } from "./runtime";
import type { Store } from "./store";

export function attentionHandlers(store: Store, runtime: Runtime): Pick<PluginRpcHandlers<typeof rpcContract>, "attentionList" | "attentionUpdate"> {
  return {
    attentionList: ({ status, limit, offset, channelId }) => {
      if (store.attention.wake()) runtime.changed();
      return store.attention.list(status, limit, offset, channelId);
    },
    attentionUpdate: ({ id, action, minutes }) => {
      const value = store.attention.update(id, action, minutes);
      runtime.changed("channel", value.roomId);
      return value;
    },
  };
}
