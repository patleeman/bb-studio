import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { HubItem } from "./hub";
import type { ProviderComments } from "./provider-comments";
import type { ItemComment, StudioServices } from "./services";


export interface NeedEntry {
  id: string;
  source: string;
  kind: "approval" | "question" | "reply" | "mention";
  title: string;
  body: string;
  href: string;
  createdAt: number;
  priority: number;
  threadId?: string;
  interactionId?: string;
  responseKind?: "approval" | "question";
}

type Sdk = Pick<BbPluginApi["sdk"], "threads" | "plugins">;
const mentionedUser = (body: string) => /@(?:user|you)\b/i.test(body) || /@\[[^\]]+\]\(user:[^)]+\)/i.test(body);

export function commentNeeds(comments: readonly ItemComment[], item: HubItem): NeedEntry[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  return comments.flatMap((comment) => {
    if (comment.actor.kind === "user" || comment.resolvedAt !== null) return [];
    const parent = comment.parentId ? byId.get(comment.parentId) : null;
    if (parent?.resolvedAt !== null && parent) return [];
    const mention = mentionedUser(comment.body);
    if (!mention && !(parent && parent.actor.kind === "user")) return [];
    return [{ id: `comment:${item.pluginId}:${item.id}:${comment.id}`, source: item.pluginId,
      kind: mention ? "mention" as const : "reply" as const,
      title: `${mention ? "Mention" : "Reply"} on ${item.title || "Untitled"}`,
      body: comment.body.slice(0, 500), href: item.href, createdAt: comment.createdAt, priority: mention ? 75 : 65 }];
  });
}

function interactionEntry(thread: { id: string; title: string | null; titleFallback: string | null }, interaction: { id: string; payload: unknown; createdAt?: number }): NeedEntry {
  const payload = interaction.payload as { kind?: string; reason?: string | null; availableDecisions?: string[]; questions?: Array<{ header?: string; prompt?: string; question?: string; allowFreeText?: boolean }> };
  const question = payload.kind === "user_question";
  const first = payload.questions?.[0];
  return { id: `interaction:${interaction.id}`, source: "bb", kind: question ? "question" : "approval",
    title: first?.header || (question ? "Question" : "Approval needed"),
    body: first?.prompt ?? first?.question ?? payload.reason ?? thread.title ?? thread.titleFallback ?? "This thread needs your input.",
    href: `/threads/${thread.id}`, createdAt: interaction.createdAt ?? Date.now(), priority: 100,
    threadId: thread.id, interactionId: interaction.id,
    ...(question ? (payload.questions?.length === 1 && first?.allowFreeText ? { responseKind: "question" as const } : {})
      : payload.availableDecisions?.includes("allow_once") && payload.availableDecisions.includes("deny") ? { responseKind: "approval" as const } : {}) };
}

export async function respondToNeed(sdk: Sdk, input: { threadId: string; interactionId: string; action: "approve" | "deny" | "answer"; answer?: string }) {
  const interaction = await sdk.threads.interactions.get({ threadId: input.threadId, interactionId: input.interactionId });
  if (interaction.status !== "pending") throw new Error("This request has already been answered.");
  const payload = interaction.payload as { kind?: string; availableDecisions?: string[]; questions?: Array<{ id: string; allowFreeText?: boolean }>; subject?: { kind?: string; permissions?: { network?: { enabled?: boolean }; fileSystem?: unknown } } };
  if (input.action === "answer") {
    if (payload.kind !== "user_question" || payload.questions?.length !== 1 || !payload.questions[0]?.allowFreeText || !input.answer?.trim()) throw new Error("Open the thread to answer this question.");
    await sdk.threads.interactions.respond({ threadId: input.threadId, interactionId: input.interactionId,
      value: { kind: "user_answer", answers: { [payload.questions[0].id]: { selected: [], freeText: input.answer.trim() } } } });
  } else {
    if (payload.kind === "user_question") throw new Error("Open the thread to answer this question.");
    if (!payload.availableDecisions?.includes(input.action === "deny" ? "deny" : "allow_once")) throw new Error("Open the thread to respond to this approval.");
    const value = input.action === "deny" ? { decision: "deny" } : {
      decision: "allow_once",
      grantedPermissions: payload.subject?.kind === "permission_grant" ? {
        network: payload.subject.permissions?.network?.enabled ? { enabled: true } : null,
        fileSystem: payload.subject.permissions?.fileSystem ?? null,
      } : null,
    };
    await sdk.threads.interactions.respond({ threadId: input.threadId, interactionId: input.interactionId,
      value: value as Parameters<typeof sdk.threads.interactions.respond>[0]["value"] });
  }
}

export async function needsYouData(sdk: Sdk, services: StudioServices, providerComments: ProviderComments,
  items: readonly HubItem[], projectId?: string): Promise<NeedEntry[]> {
  const entries: NeedEntry[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await sdk.threads.list({ ...(projectId ? { projectId } : {}), archived: false, limit: 200, offset }).catch(() => []);
    const pending = page.filter((thread) => thread.hasPendingInteraction);
    const rows = await Promise.all(pending.map(async (thread) => {
      const interactions = await sdk.threads.interactions.list({ threadId: thread.id }).catch(() => []);
      return interactions.filter((interaction) => interaction.status === "pending").map((interaction) => interactionEntry(thread, interaction));
    }));
    entries.push(...rows.flat());
    if (page.length < 200) break;
  }
  const visible = items.filter((item) => !item.archived && (!projectId || item.projectId === projectId || item.projectId === null));
  const local = services.openComments();
  const localByItem = new Map<string, ItemComment[]>();
  for (const comment of local) {
    const key = `${comment.ref.pluginId}:${comment.ref.id}`;
    localByItem.set(key, [...(localByItem.get(key) ?? []), comment]);
  }
  for (const item of visible) if (item.pluginId !== "pages") entries.push(...commentNeeds(localByItem.get(`${item.pluginId}:${item.id}`) ?? [], item));
  const pages = visible.filter((item) => item.pluginId === "pages");
  for (let index = 0; index < pages.length; index += 8) {
    const chunk = await Promise.all(pages.slice(index, index + 8).map(async (item) => commentNeeds(await providerComments.list({ pluginId: item.pluginId, id: item.id }).catch(() => null) ?? [], item)));
    entries.push(...chunk.flat());
  }
  return entries.sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt).slice(0, 30);
}
