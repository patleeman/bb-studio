import { z } from "zod";

/** A channel is a BB thread on this provider. Studio Teams creates these threads; the model picker never lists it. */
export const channelProviderId = "bot-teams-channel";
export const channelPostTool = "bots_channel_thread_post";

/** Hidden thread input: Studio Teams hands the bridge a stored channel message to show. */
export const channelDeliverPrefix = "[bot-teams:channel-deliver]";
/** Hidden thread input: wakes a new channel thread without a visible message. */
export const channelStartPrefix = "[bot-teams:channel-start]";

/**
 * The composer's native model picker drives a channel: its "models" are the
 * chat modes, and its "reasoning levels" are the bot permissions. BB fixes
 * the level ids; the labels are ours.
 */
export const channelModes = ["smart", "directed", "everyone"] as const;
export type ChannelMode = (typeof channelModes)[number];

export const channelPermissionLevels = [
  { id: "none", label: "Each bot's own", description: "Use the mode set in every bot's profile", permission: null },
  { id: "low", label: "Accept Edits", description: "Sandboxed, and asks you to approve anything beyond it", permission: "accept-edits" },
  { id: "medium", label: "Auto", description: "Sandboxed, and the provider reviews on its own", permission: "auto" },
  { id: "high", label: "Full Access", description: "No sandbox and no approvals", permission: "full" },
] as const;
export type ChannelPermissionLevel = (typeof channelPermissionLevels)[number]["id"];

export function permissionForLevel(level: string) {
  return channelPermissionLevels.find((entry) => entry.id === level)?.permission ?? null;
}

export function levelForPermission(permission: "accept-edits" | "auto" | "full" | null | undefined): ChannelPermissionLevel {
  return channelPermissionLevels.find((entry) => entry.permission === (permission ?? null))!.id;
}

const modeDetails: Record<ChannelMode, { displayName: string; description: string }> = {
  smart: { displayName: "Smart", description: "A coordinator picks collaborators, work order, and busy-bot actions" },
  directed: { displayName: "Directed", description: "Only the bots you mention answer" },
  everyone: { displayName: "Everyone", description: "Every bot in the channel can answer" },
};

export const channelModels = channelModes.map((id) => ({
  id,
  ...modeDetails[id],
  supportedReasoningEfforts: channelPermissionLevels.map((level) => ({
    reasoningEffort: level.id,
    description: level.description,
  })),
  defaultReasoningEffort: "none" as const,
  isDefault: id === "smart",
}));

export const isChannelMode = (value: string): value is ChannelMode =>
  (channelModes as readonly string[]).includes(value);

export const channelDeliverySchema = z.object({
  messageId: z.string(),
  /** `you`: the owner, from outside this thread; `owner`: the owner, replayed from before it existed. */
  kind: z.enum(["bot", "you", "owner", "system"]),
  speaker: z.string(),
  avatar: z.string().nullable(),
  /** The bot's work thread for this reply; its name links there. */
  workThreadId: z.string().nullable().default(null),
  text: z.string(),
  /** Studio Teams' own download URL: stored attachment paths are not links. */
  attachments: z
    .array(z.object({ name: z.string(), url: z.string(), image: z.boolean() }))
    .default([]),
});
export type ChannelDelivery = z.infer<typeof channelDeliverySchema>;

export const channelPostInput = z.object({
  text: z.string().max(16000),
  /** The composer's model (chat mode) and reasoning level (bot permissions) for this message. */
  mode: z.enum(channelModes).optional(),
  permissionLevel: z.enum(["none", "low", "medium", "high"]).optional(),
  attachments: z
    .array(
      z.object({
        path: z.string().min(1).max(4096),
        name: z.string().max(255).optional(),
        mimeType: z.string().max(255).optional(),
        sizeBytes: z.number().nonnegative().optional(),
        image: z.boolean(),
      }),
    )
    .max(10)
    .default([]),
});

/** The assistant text a delivery shows as. Assistant messages have no author, so the speaker leads the body. */
export function deliveryMarkdown(delivery: ChannelDelivery) {
  const name = (file: { name: string }) => file.name.replace(/[[\]]/g, "");
  // Images show inline; other files are download links.
  const images = delivery.attachments
    .filter((file) => file.image)
    .map((file) => `![${name(file)}](<${file.url}&inline=1>)`);
  const files = delivery.attachments
    .filter((file) => !file.image)
    .map((file) => `- [${name(file)}](<${file.url}>)`);
  const body = [delivery.text.trim(), images.join("\n\n"), files.join("\n")]
    .filter(Boolean)
    .join("\n\n");
  switch (delivery.kind) {
    case "bot": {
      const name = `${delivery.avatar ? `${delivery.avatar} ` : ""}${delivery.speaker}`;
      const header = delivery.workThreadId ? `[${name}](/threads/${delivery.workThreadId})` : name;
      return `**${header}**\n\n${body}`;
    }
    case "you":
      return `**You** · sent outside this thread\n\n${body}`;
    case "owner":
      return `**You**\n\n${body}`;
    case "system":
      return `_${body}_`;
  }
}
