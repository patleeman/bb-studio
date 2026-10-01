import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { ChannelApprovals } from "./approvals";
import type { ChannelThreads } from "./channel-thread-link";
import type { rpcContract } from "./contract";
import type { Runtime } from "./runtime";
import type { Store } from "./store";

type RoomMethod = "channelSurface" | "openChannelThread" | "channelForThread" | "room";

export function roomHandlers(
  store: Store,
  runtime: Runtime,
  channelThreads: ChannelThreads,
  approvals: ChannelApprovals,
): Pick<PluginRpcHandlers<typeof rpcContract>, RoomMethod> {
  return {
    channelSurface: async ({ threadId }) => {
      const room = channelThreads.roomForThread(threadId);
      if (!room) return null;
      return {
        room: { ...room, threadId },
        bots: store.all(),
        jobs: await runtime.roomJobsWithActivity(room.id),
        runs: store.runs(room.id, 50),
        approvals: approvals.list(room.id),
        attention: store.attention.list("open", 10, 0, room.id).items,
      };
    },
    openChannelThread: async ({ id }) => {
      const room = store.room(id);
      const threadId = await channelThreads.ensure(room);
      void channelThreads.sync(room.id);
      return { threadId };
    },
    channelForThread: ({ threadId }) => {
      const linked = channelThreads.roomForThread(threadId);
      if (linked) return linked.id;
      const conversation = store.byThread(threadId);
      const key = conversation?.originalKey ?? conversation?.key;
      if (conversation?.kind !== "group" || !key?.startsWith("group:")) return null;
      const roomId = key.slice("group:".length).split(":")[0]!;
      return store.findRoom(roomId) ? roomId : null;
    },
    room: async ({ id, start, limit }) => ({
      room: store.room(id),
      ...store.transcript(id, { start, limit }),
      runs: store.runs(id, 50),
      jobs: await runtime.roomJobsWithActivity(id),
      approvals: approvals.list(id),
    }),
  };
}
