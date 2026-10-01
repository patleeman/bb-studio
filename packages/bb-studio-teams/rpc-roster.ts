import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { BotCreateRequest, rpcContract } from "./contract";
import type { ChannelThreads } from "./channel-thread-link";
import type { ChannelApprovals } from "./approvals";
import type { Store } from "./store";
import { directThreadIndicator } from "./direct-status";
import { missingThread } from "./runtime";

function botCreateRequestView(request: BotCreateRequest) {
  const mission = request.input.mission.slice(0, 4000);
  return {
    id: request.id,
    requesterBotId: request.requesterBotId,
    requesterName: request.requesterName,
    channelName: request.channelName,
    name: request.input.name,
    description: request.input.description,
    avatar: request.input.avatar,
    providerId: request.input.providerId,
    model: request.input.model,
    reasoningLevel: request.input.reasoningLevel,
    permissionMode: request.input.permissionMode,
    intervalMinutes: request.input.intervalMinutes,
    mission,
    missionTruncated: mission.length < request.input.mission.length,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
}

export function rosterHandlers(bb: BbPluginApi, store: Store, channelThreads: ChannelThreads, approvals: ChannelApprovals): Pick<PluginRpcHandlers<typeof rpcContract>, "list" | "spaceConversations"> {
  return {
    spaceConversations: () => ({
      channels: store.rooms().flatMap((room) => {
        const threadId = channelThreads.threadId(room.id);
        return threadId ? [{ threadId, name: room.name, archived: !!room.archived }] : [];
      }),
      direct: store.all().flatMap((bot) => store.conversations(bot.id)
        .filter((conversation) => conversation.kind === "admin")
        .map((conversation) => ({ threadId: conversation.threadId, botName: bot.name }))),
    }),
    list: async () => {
      const activity = store.botActivitySummary();
      const bots = store.all();
      // A linked channel is read when its thread is: reading happens there now.
      // BB's own read state decides it. Delivering a message into the thread
      // moves its lastReadAt past the room's updatedAt, so the room's clock
      // cannot tell a bot's new reply from one the owner has seen.
      const rooms = await Promise.all(store.rooms().map(async (room) => {
        const threadId = channelThreads.threadId(room.id);
        if (!threadId) return room;
        try {
          const thread = await bb.sdk.threads.get({ threadId });
          const updatedAt = Math.max(room.updatedAt, thread.latestAttentionAt);
          const lastReadAt = thread.latestAttentionAt > (thread.lastReadAt ?? 0)
            ? Math.min(thread.lastReadAt ?? 0, updatedAt - 1)
            : updatedAt;
          return { ...room, threadId, updatedAt, lastReadAt };
        } catch (cause) {
          if (!missingThread(cause)) throw cause;
          return room;
        }
      }));
      const directConversations = Object.fromEntries(bots.map((bot) => [
        bot.id,
        store.conversations(bot.id).filter((conversation) => conversation.kind === "admin"),
      ]));
      const directThreadInfo: Record<string, {
        title: string;
        projectId: string;
        archivedAt: number | null;
        pinned: boolean;
        unread: boolean;
        sectionId: string | null;
        updatedAt: number;
      }> = {};
      await Promise.all(Object.values(directConversations).flat().map(async (conversation) => {
        try {
          const thread = await bb.sdk.threads.get({ threadId: conversation.threadId });
          directThreadInfo[conversation.threadId] = {
            title: thread.title?.trim() || thread.titleFallback?.trim() || conversation.title,
            projectId: thread.projectId,
            archivedAt: thread.archivedAt,
            pinned: thread.pinnedAt !== null,
            unread: thread.latestAttentionAt > (thread.lastReadAt ?? 0),
            sectionId: thread.sectionId,
            updatedAt: thread.updatedAt,
          };
        } catch (cause) {
          if (!missingThread(cause)) throw cause;
        }
      }));
      const directThreadIds = new Map(
        bots.flatMap((bot) => {
          const current = store.currentDirectConversation(bot.id);
          return current ? [[current.threadId, bot.id] as const] : [];
        }),
      );
      const roomIds = new Set(rooms.map((room) => room.id));
      const roomThreadIds = new Map(store.activeGroupThreadRooms()
        .filter(({ roomId }) => roomIds.has(roomId))
        .map(({ threadId, roomId }) => [threadId, roomId] as const));
      const directThreads: Record<string, {
        threadId: string;
        status: "pending" | "starting" | "active" | "stopping" | "idle" | "error";
        indicator: ReturnType<typeof directThreadIndicator>;
      }> = {};
      const roomThreads: Record<string, {
        threadId: string;
        status: "pending" | "starting" | "active" | "stopping" | "idle" | "error";
        indicator: ReturnType<typeof directThreadIndicator>;
      }[]> = {};
      for (let offset = 0; directThreadIds.size || roomThreadIds.size; offset += 100) {
        const page = await bb.sdk.threads.list({
          originPluginId: "bot-teams", includeHidden: true, limit: 100, offset,
        });
        for (const thread of page) {
          const botId = directThreadIds.get(thread.id);
          const view = {
            threadId: thread.id,
            status: thread.status,
            indicator: directThreadIndicator(thread),
          };
          if (botId) {
            directThreads[botId] = view;
            directThreadIds.delete(thread.id);
          }
          const roomId = roomThreadIds.get(thread.id);
          if (roomId) {
            (roomThreads[roomId] ??= []).push(view);
            roomThreadIds.delete(thread.id);
          }
        }
        if (page.length < 100) break;
      }
      return {
        bots: bots.map((bot) => {
          const summary = activity.get(bot.id);
          return {
            ...bot,
            working: summary?.working ?? false,
            lastActivityAt: summary?.lastActivityAt ?? null,
          };
        }),
        rooms,
        activeRoomIds: store.activeRoomIds(),
        directThreads,
        directConversations,
        directThreadInfo,
        roomThreads,
        roomWork: store.roomWorkSummary(),
        attentionCounts: store.attention.counts(),
        approvalCounts: approvals.counts(),
        botCreateRequests: store.botCreateRequests().map(botCreateRequestView),
      };
    },
  };
}
