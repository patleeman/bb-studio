import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { changes, createInput, directiveFor, rpcContract, WORK_ID, type CreateInput, type WorkCard, type WorkChanges } from "./contract";
import { WorkCardStore } from "./store";

type TimelineRow = { id: string; kind?: string; role?: string; text?: string; messageSeq?: number };
type TimelinePage = { rows?: TimelineRow[]; timelinePage?: { olderCursor?: { anchorSeq: number; anchorId: string } | null } };
export type TimelineReader = (threadId: string, cursor: { anchorSeq: number; anchorId: string } | null) => Promise<TimelinePage>;

const PAGES = 8;
const RETRY_MS = 15_000;

export async function findCardMessage(read: TimelineReader, card: Pick<WorkCard, "id" | "threadId" | "messageId">): Promise<{ messageId: string; messageSeq: number } | null> {
  const directive = `id="${card.id}"`;
  let cursor: { anchorSeq: number; anchorId: string } | null = null;
  for (let page = 0; page < PAGES; page++) {
    const result = await read(card.threadId, cursor);
    const rows = [...(result.rows ?? [])].reverse();
    const found = rows.find((row) => row.kind === "conversation" && typeof row.messageSeq === "number" && (row.id === card.messageId || (!!row.text && row.text.includes("::work{") && row.text.includes(directive))));
    if (found && typeof found.messageSeq === "number") return { messageId: found.id, messageSeq: found.messageSeq };
    cursor = result.timelinePage?.olderCursor ?? null;
    if (!cursor) return null;
  }
  return null;
}

export const WORK_TOOLS = ["work_card_create", "work_card_update", "work_card_get"];

export const CREATE_DESCRIPTION = "Start a live work card for one piece of work (a worker's or lead's job, a release, a todo in progress). It returns a ::work{id=\"…\"} line: post it ONCE, on its own line, in the conversation where the user follows the work. The card stays put and redraws in place; it also shows in that conversation's In flight list above the composer. From then on report progress with work_card_update instead of posting status messages. Pass the card id to a worker you start so it can update the card itself. Link its thread with a bare @thread:thr_… mention or [text](/threads/thr_…), never [text](@thread:thr_…). A worker card with workerThreadId gives that thread the card's title, so both carry one name.";
export const UPDATE_DESCRIPTION = "Change a work card in place: state (running, waiting, needs-you, done, failed), step (e.g. \"3/5 Tests\"), line (the latest one-liner) and needs (what the user must do; with state needs-you). Use it for progress instead of posting a new message. A finished card (done or failed) leaves the In flight list after a day.";

export function registerWorkCards(bb: BbPluginApi, db: Database.Database, options: { read?: TimelineReader } = {}) {
  const store = new WorkCardStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); });
  const read: TimelineReader = options.read ?? (async (threadId, cursor) => await bb.sdk.threads.timeline({ threadId, segmentLimit: 40, ...(cursor ? { beforeAnchorSeq: String(cursor.anchorSeq), beforeAnchorId: cursor.anchorId } : {}) } as never) as unknown as TimelinePage);
  const tried = new Map<string, number>();
  const place = async (card: WorkCard): Promise<WorkCard> => {
    if (card.messageSeq !== null) return card;
    const last = tried.get(card.id) ?? 0;
    if (Date.now() - last < RETRY_MS) return card;
    tried.set(card.id, Date.now());
    const found = await findCardMessage(read, card).catch((error: unknown) => { bb.log.warn(`Work card ${card.id}: ${error instanceof Error ? error.message : String(error)}`); return null; });
    if (!found) return card;
    tried.delete(card.id);
    return store.placed(card.id, found.messageId, found.messageSeq);
  };
  const name = (card: WorkCard, before: WorkCard | null) => {
    if (card.kind !== "worker" || !card.workerThreadId) return;
    if (before && before.kind === card.kind && before.workerThreadId === card.workerThreadId && before.title === card.title) return;
    void Promise.resolve().then(() => bb.sdk.threads.update({ threadId: card.workerThreadId!, title: card.title } as never))
      .catch((error: unknown) => { bb.log.warn(`Work card ${card.id}: ${error instanceof Error ? error.message : String(error)}`); });
  };
  const create = (input: CreateInput & { threadId: string }) => {
    const card = store.create(input);
    name(card, null);
    return { card, directive: directiveFor(card.id) };
  };
  const update = (id: string, changes: WorkChanges) => {
    const before = store.find(id);
    const card = store.update(id, changes);
    name(card, before);
    return card;
  };
  const list = async (threadId: string) => ({ cards: await Promise.all(store.inFlight(threadId).map(place)) });
  const placeAll = async (threadId: string) => {
    for (const card of store.inFlight(threadId)) if (card.messageSeq === null) { tried.delete(card.id); await place(card); }
  };
  bb.events?.on("thread.idle", ({ thread }) => { void placeAll(thread.id).catch(() => {}); });

  bb.rpc.register(rpcContract, {
    "work.get": ({ id }) => store.get(id),
    "work.list": ({ threadId }) => list(threadId),
    "work.create": (input) => create(input),
    "work.update": ({ id, ...rest }) => update(id, rest),
    "work.anchor": async ({ id, threadId, messageId }) => await place(store.anchor(id, threadId, messageId)),
  });

  bb.agents.registerTool({
    name: "work_card_create",
    description: CREATE_DESCRIPTION,
    parameters: createInput,
    execute: async (input, ctx) => {
      const threadId = input.threadId ?? ctx.threadId;
      if (!threadId) return "Pass threadId: the conversation the card goes in.";
      const { card, directive } = create({ ...input, threadId });
      return JSON.stringify({ id: card.id, directive, post: `Post this line once, on its own line, in thread ${threadId}: ${directive}` });
    },
  });
  bb.agents.registerTool({
    name: "work_card_update",
    description: UPDATE_DESCRIPTION,
    parameters: changes.extend({ id: z.string().regex(WORK_ID) }),
    execute: async ({ id, ...rest }) => JSON.stringify(update(id, rest)),
  });
  bb.agents.registerTool({
    name: "work_card_get",
    description: "Read a work card by id: its state, step, line and the conversation it is in.",
    parameters: z.object({ id: z.string().regex(WORK_ID) }),
    execute: async ({ id }) => JSON.stringify(store.get(id)),
  });

  return { store, create, update, list, place, placeAll };
}
