import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ChannelThreads } from "./channel-thread-link";
import { channelReference } from "./channel-references";
import type { Bot, Room } from "./contract";
import type { Store } from "./store";

/** Mention provider ids; a picked pill's itemId is `<providerId>:<itemId>`. */
export const mentionProviders = {
  bots: "bots",
  channels: "channels",
  directMessages: "dms",
} as const;

const excerptLimit = 400;
const channelContextMessages = 20;

const excerpt = (text: string) => {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > excerptLimit ? `${flat.slice(0, excerptLimit)}…` : flat;
};

const matches = (query: string, ...fields: string[]) =>
  fields.join(" ").toLowerCase().includes(query.toLowerCase());

/**
 * `@` offers bots, channels, and direct-message threads in every composer.
 * Picking one gives the agent that conversation as context; in a channel
 * thread, the bridge also turns the pill into a link the bots can follow.
 */
export function registerChannelMentions(
  bb: BbPluginApi,
  store: Store,
  channelThreads: ChannelThreads,
) {
  const memberNames = (room: Room) =>
    room.memberIds
      .map((id) => store.all().find((bot) => bot.id === id)?.name)
      .filter(Boolean)
      .join(", ");

  bb.ui.registerMentionProvider({
    id: mentionProviders.bots,
    label: "Bots",
    search({ query, threadId }) {
      const room = threadId ? channelThreads.roomForThread(threadId) : null;
      const inRoom = (bot: Bot) => !!room?.memberIds.includes(bot.id);
      const bots = store
        .all()
        .filter((bot) => !bot.retired && matches(query, bot.name, bot.handle))
        .sort((a, b) => Number(inRoom(b)) - Number(inRoom(a)) || a.name.localeCompare(b.name))
        .map((bot) => ({
          id: bot.handle,
          title: `${bot.avatar} ${bot.name}`,
          subtitle: `@${bot.handle}${room && !inRoom(bot) ? " · not in this channel yet" : ""}`,
          icon: "Bot",
        }));
      const q = query.toLowerCase();
      const everyone =
        room && ("all".startsWith(q) || "channel".startsWith(q))
          ? [{ id: "all", title: "@all", subtitle: "Everyone in this channel", icon: "Users" }]
          : [];
      return [...everyone, ...bots].slice(0, 8);
    },
    resolve(handle) {
      const bot = store.all().find((candidate) => candidate.handle === handle);
      if (!bot) return { context: `@${handle}` };
      return {
        context: [
          `@${bot.handle} is the Studio Teams bot ${bot.name}: ${bot.description}.`,
          "In a channel, mention it to ask it. Elsewhere, reach it with the bots skill (`bb bots channel send` or its direct messages).",
        ].join("\n"),
      };
    },
  });

  bb.ui.registerMentionProvider({
    id: mentionProviders.channels,
    label: "Channels",
    search({ query, threadId }) {
      const current = threadId ? channelThreads.roomForThread(threadId) : null;
      return store
        .rooms()
        .filter((room) => !room.archived && room.id !== current?.id && matches(query, room.name))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6)
        .map((room) => ({
          id: room.id,
          title: `#${room.name}`,
          subtitle: memberNames(room) || "No bots yet",
          icon: "Hash",
        }));
    },
    resolve(roomId) {
      const room = store.room(roomId);
      const recent = store
        .visibleMessages(room.id, channelContextMessages)
        .filter((message) => !message.system && (message.text.trim() || message.attachments.length))
        .map((message) =>
          `- ${message.speaker}: ${excerpt(message.text) || message.attachments.map((a) => a.name).join(", ")}`,
        );
      return {
        context: [
          `Studio Teams channel ${channelReference(room)} (id ${room.id}).`,
          `Members: ${memberNames(room) || "none"}. Chat mode: ${room.responseBehavior ?? "everyone"}.`,
          recent.length ? `Recent messages, oldest first:\n${recent.join("\n")}` : "No messages yet.",
          `Read more with \`bb bots channel messages ${room.id}\`; post with \`bb bots channel send ${room.id}\`.`,
        ].join("\n"),
      };
    },
  });

  bb.ui.registerMentionProvider({
    id: mentionProviders.directMessages,
    label: "Direct messages",
    async search({ query, threadId }) {
      const direct = store
        .all()
        .filter((bot) => !bot.retired)
        .flatMap((bot) =>
          store
            .conversations(bot.id)
            .filter((c) => c.kind === "admin" && !c.archivedAt && c.threadId !== threadId)
            .map((conversation) => ({ bot, conversation })),
        );
      const rows = await Promise.all(
        direct.map(async ({ bot, conversation }) => {
          try {
            const thread = await bb.sdk.threads.get({ threadId: conversation.threadId });
            const title = thread.title?.trim() || thread.titleFallback?.trim() || bot.name;
            return { bot, conversation, title, updatedAt: thread.updatedAt };
          } catch {
            return null;
          }
        }),
      );
      return rows
        .filter((row): row is NonNullable<typeof row> => !!row && matches(query, row.title, row.bot.name, row.bot.handle))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6)
        .map(({ bot, conversation, title }) => ({
          id: conversation.threadId,
          title: /^direct message$/iu.test(title) ? `${bot.avatar} ${bot.name}` : title,
          subtitle: `Direct message with ${bot.name}`,
          icon: "MessageSquare",
        }));
    },
    async resolve(threadId) {
      const conversation = store.byThread(threadId);
      const bot = conversation && store.all().find((candidate) => candidate.id === conversation.botId);
      const thread = await bb.sdk.threads.get({ threadId });
      const title = thread.title?.trim() || thread.titleFallback?.trim() || "Direct message";
      const latest = (await bb.sdk.threads.output({ threadId }).catch(() => null))?.output;
      return {
        context: [
          `Direct message thread "${title}"${bot ? ` with the Studio Teams bot ${bot.name} (@${bot.handle})` : ""}: [${title}](/threads/${threadId}) (thread ${threadId}).`,
          latest?.trim() ? `Latest reply: ${excerpt(latest)}` : "No replies yet.",
          `Read the whole thread with \`bb thread log ${threadId}\`.`,
        ].join("\n"),
      };
    },
  });
}
