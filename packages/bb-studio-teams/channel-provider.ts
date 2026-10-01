import { z } from "zod";

/** A channel is a BB thread on this provider. Studio Teams creates these threads; the model picker never lists it. */
export const channelProviderId = "bot-teams-channel";
export const channelPostTool = "bots_channel_thread_post";

/** Hidden thread input: Studio Teams hands the bridge a stored channel message to show. */
export const channelDeliverPrefix = "[bot-teams:channel-deliver]";
/** Hidden thread input: wakes a new channel thread without a visible message. */
export const channelStartPrefix = "[bot-teams:channel-start]";

/**
 * A channel's chat mode and bot permissions are channel settings, set from the
 * channel button beside the composer (channel-settings.tsx), the CLI, or agent
 * tools. The model picker is not involved: the provider offers one model.
 */
export const channelModes = ["smart", "directed", "everyone"] as const;
export type ChannelMode = (typeof channelModes)[number];

export const channelModeDetails: Record<ChannelMode, { label: string; description: string }> = {
  smart: { label: "Smart", description: "A coordinator picks collaborators, work order, and busy-bot actions" },
  directed: { label: "Directed", description: "Only the bots you mention answer" },
  everyone: { label: "Everyone", description: "Every bot in the channel can answer" },
};

export const channelPermissions = [
  { permission: null, label: "Each bot's own", description: "Use the mode set in every bot's profile" },
  { permission: "accept-edits", label: "Accept Edits", description: "Sandboxed, and asks you to approve anything beyond it" },
  { permission: "auto", label: "Auto", description: "Sandboxed, and the provider reviews on its own" },
  { permission: "full", label: "Full Access", description: "No sandbox and no approvals" },
] as const;

/** The provider's only model, with the one reasoning level BB requires: there is nothing to pick. */
export const channelModelId = "channel";
export const channelModels = [{
  id: channelModelId,
  displayName: "Channel",
  description: "Bots in this channel answer with their own models",
  supportedReasoningEfforts: [{ reasoningEffort: "none" as const, description: "Bots use their own reasoning levels" }],
  defaultReasoningEffort: "none" as const,
  isDefault: true,
}];

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
