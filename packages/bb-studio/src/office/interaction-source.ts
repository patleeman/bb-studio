import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { OFFICE_TRUST_RENDERER } from "./trust";
import { respondToNeed } from "../needs-you";
import type { InboxSource, SourceEvent } from "./inbox";

type Sdk = Pick<BbPluginApi["sdk"], "threads" | "plugins">;
/** Reads all pending interactions, including bot-owned threads hidden from Work. */
export function interactionSource(sdk: Sdk): InboxSource {
  return {
    id: "bb-interaction", keyPrefix: "interaction:",
    async list() {
      const events: SourceEvent[] = [];
      for (let offset = 0; ; offset += 200) {
        const threads = await sdk.threads.list({ archived: false, includeHidden: true, offset, limit: 200 });
        for (const thread of threads.filter(t => t.hasPendingInteraction)) {
          const interactions = await sdk.threads.interactions.list({ threadId: thread.id });
          for (const interaction of interactions.filter(i => i.status === "pending")) {
            const payload = interaction.payload as { kind?: string; reason?: string; availableDecisions?: string[]; questions?: { header?: string; prompt?: string; question?: string; allowFreeText?: boolean }[] };
            const trust = interaction.origin?.kind === "plugin" && interaction.origin.pluginId === "studio" && interaction.origin.rendererId === OFFICE_TRUST_RENDERER;
            const question = payload.kind === "user_question";
            const first = payload.questions?.[0];
            const answerable = question && payload.questions?.length === 1 && first?.allowFreeText === true;
            const actions: NonNullable<SourceEvent["actions"]> = [];
            if (trust) actions.push({ id: "approve", label: "Approve", primary: true }, { id: "deny", label: "Deny" });
            if (answerable) actions.push({ id: "answer", label: "Send answer", primary: true });
            if (!question) {
              if (payload.availableDecisions?.includes("allow_once")) actions.push({ id: "approve", label: "Approve", primary: true });
              if (payload.availableDecisions?.includes("deny")) actions.push({ id: "deny", label: "Deny" });
            }
            events.push({
              key: `interaction:${interaction.id}`, projectId: thread.projectId, source: "bb-interaction", type: "request",
              title: (trust ? (interaction.payload as { title: string }).title : null) || first?.header || (question ? "Question" : "Approval needed"),
              body: first?.prompt ?? first?.question ?? payload.reason ?? thread.title ?? thread.titleFallback ?? "This thread needs your input.",
              threadId: thread.id, botId: null, item: null, href: `/threads/${thread.id}`, actions, answerable,
              createdAt: interaction.createdAt,
            });
          }
        }
        if (threads.length < 200) break;
      }
      return events;
    },
    async act(event, actionId, text) {
      if (!event.threadId || !["approve", "deny", "answer"].includes(actionId)) throw new Error("Invalid interaction action");
      const interactionId = event.key.slice("interaction:".length);
      const current = await sdk.threads.interactions.get({ threadId: event.threadId, interactionId });
      if (current.origin?.kind === "plugin" && current.origin.pluginId === "studio" && current.origin.rendererId === OFFICE_TRUST_RENDERER) {
        if (current.status !== "pending") throw new Error("This request has already been answered.");
        if (actionId === "answer") throw new Error("Choose Approve or Deny for this request.");
        await sdk.threads.interactions.respond({ threadId: event.threadId, interactionId, value: { approved: actionId === "approve" } });
        return;
      }
      await respondToNeed(sdk, { threadId: event.threadId, interactionId: event.key.slice("interaction:".length), action: actionId as "approve" | "deny" | "answer", answer: text });
    },
  };
}
