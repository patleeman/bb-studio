// bb-plugin-mobile — server side of BB Studio, the personal native iOS app.
//
// BB's push-notifications plugin only speaks Expo push. BB Studio registers
// `apns:<device token>` subscriptions and points push-notifications'
// `expoPushUrl` at this plugin's /push route, which sends those to APNs and
// forwards every other token to Expo unchanged.
//
// Plugins without BB's shared notification queue send through `notify`, which
// reaches the devices this relay has delivered to before.
//
// Once a notified thread is read or answered anywhere, a silent push tells the
// app to remove its notifications (see clear.ts).
import { setThreadMuted, stillMuted } from "./mute-levels.js";
import { studioCliName, studioCliRegistration } from "./cli-name";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  APNS_TOKEN_PREFIX,
  deliverApns,
  DEVICE_TTL_MS,
  Http2ApnsSender,
  isGoneResult,
  notificationCategory,
  ProviderToken,
  rememberedDevices,
  sendApns,
  type ApnsConfig,
  type ExpoMessage,
  type ExpoTicket,
} from "./apns.js";
import { CLEAR_BATCH, clearPayload, keptWorkers, noteNotified, noteWorkers, partition, settled, type Notified, type NotifiedWorkers, type ThreadReadState } from "./clear.js";
import { DeskHold, holdable } from "./desk.js";
import { appendJournal, JOURNAL_KEY, journalEntry, journalSummary, type JournalEntry, type JournalOutcome } from "./journal.js";
import { redactSecrets } from "./redact.js";
import { isQuietCompletion, isUserFacingReply, triggerOf, turnPushAllowed, type TurnTrigger } from "./notifications.js";
import { collapseIdFor, PushWindows, summaryBody, windowKey } from "./push-window.js";
import { StudioApprovals } from "./studio-approvals.js";
import { activityTokenSchema, botIdSchema, deviceIdSchema, liveActivityPayload, liveActivityPriority, liveActivityPushSchema, LiveActivityTokens, MOBILE_MIGRATIONS, tokenKindSchema } from "./live-activities.js";
import { describeMobileMigration, LEGACY_KEY_PATH_KEY, LEGACY_MOBILE_SETTINGS, migrateMobileSettings, MOBILE_MIGRATED_KEY, MOBILE_SETTINGS, mobileConstants } from "./settings.js";

const messageSchema = z.object({ to: z.string().min(1), body: z.string().optional(), data: z.record(z.string(), z.unknown()).optional() }).passthrough();
const batchSchema = z.union([z.array(messageSchema).max(100), messageSchema.transform((message) => [message])]);

type LastDelivery = { at: string; apns: number; expo: number; errors: string[]; categories?: string[] };
const LAST_DELIVERY_KEY = "last-delivery";
/** Option buttons on a question notification; iOS shows about this many before it gets cramped. */
const MAX_CHOICES = 6;
/** Thread ids whose notifications BB Studio shouldn't get. */
const MUTED_KEY = "muted-threads";
const MUTE_LEVELS_SYNCED_KEY = "muted-threads:levels-synced";
const MAX_MUTED = 500;
/** APNs recipients seen on the relay, with when each was last seen. */
const DEVICES_KEY = "devices";
/** Threads the app has notifications for; see clear.ts. */
const NOTIFIED_KEY = "notified-threads";
const NOTIFIED_WORKERS_KEY = "notified-workers";
/** The "Hold phone notifications while I'm at my Mac" switch (desk.ts); on unless set false. */
const DESK_HOLD_KEY = "desk-hold";
const deskOutput = z.object({ enabled: z.boolean(), atDesk: z.boolean().nullable(), held: z.number().int().min(0) });
const STUDIO_PLUGIN_ID = "studio";
/** A BB reply push already checked against its turn and Studio's tag. Copies ({ ...message }) keep it; JSON (the APNs payload) never carries it. */
const CHECKED = Symbol("reply-push-checked");
type CheckedMessage = ExpoMessage & { [CHECKED]?: true };
/** How long BB's reply push waits for Studio to tag the reply (Jev answers within 15 seconds). */
const REPLY_TAG_WAIT_MS = 20_000;
const pushIdsOutput = z.object({ botId: z.string().optional(), conversationId: z.string().optional(), workerId: z.string().optional() }).passthrough();
/** Reading a thread has no event, so notified threads are checked this often. */
const CLEAR_INTERVAL_MS = 60_000;
/** Coalesces thread events into one check. */
const CLEAR_DELAY_MS = 3_000;

const threadRef = z.string().min(1).max(200);

export const notifyInput = z.object({
  title: z.string().max(200),
  body: z.string().max(4000),
  kind: z.enum(["turn-finished", "thread-error", "pending-interaction", "needs-you"]),
  threadId: z.string().min(1).nullable(),
  projectId: z.string().min(1),
  path: z.string().max(500).optional(),
  category: z.literal('BB_LOOP').optional(),
  loopId: z.string().min(1).optional(),
  actions: z.array(z.enum(['done','snooze','got_it','drop','choose','hand_off','nudge'])).optional(),
  loopKind: z.enum(['do','decide','read','waiting']).optional(),
  options: z.array(z.string().max(120)).max(4).optional(),
  coalesceKey: z.string().max(300).optional(),
  botId: botIdSchema.optional(),
  conversationId: threadRef.optional(),
  workerId: threadRef.optional(),
  interactionId: threadRef.optional(),
}).superRefine((input, context) => {
  if ((input.conversationId || input.workerId) && !input.botId) context.addIssue({ code: "custom", path: ["botId"], message: "A conversation or worker needs its Bot." });
  if (input.workerId && !input.conversationId) context.addIssue({ code: "custom", path: ["conversationId"], message: "A worker needs the conversation it reports to." });
  if (input.kind === "needs-you" && (!input.botId || !input.conversationId || input.threadId !== input.conversationId)) {
    context.addIssue({ code: "custom", path: ["kind"], message: "needs-you needs botId and conversationId, with threadId set to the conversation." });
  }
});

export const mobileContract = defineRpcContract({
  mute_list: {
    experimental_description: "Threads muted in BB Studio.",
    input: z.object({}).optional(),
    output: z.object({ threadIds: z.array(z.string()) }),
  },
  notify: {
    experimental_description: "Another plugin sends a notification to the phones BB Studio has delivered to.",
    input: notifyInput,
    output: z.object({ ok: z.literal(true), sent: z.number() }),
  },
  live_activity_register: {
    experimental_description: "The app registers a Live Activity push token for one Bot on one device: its push-to-start token, or the update token of the Bot's running activity.",
    input: z.strictObject({ deviceId: deviceIdSchema, botId: botIdSchema, kind: tokenKindSchema, token: activityTokenSchema }),
    output: z.object({ ok: z.literal(true) }),
  },
  live_activity_unregister: {
    experimental_description: "The app forgets a device's Live Activity tokens: one Bot's or all, one kind or both.",
    input: z.strictObject({ deviceId: deviceIdSchema, botId: botIdSchema.optional(), kind: tokenKindSchema.optional() }),
    output: z.object({ removed: z.number().int().min(0) }),
  },
  live_activity_push: {
    experimental_description: "Starts, updates or ends a Bot's Live Activity on every device that registered a token for it. Tokens Apple rejects for good are forgotten; an ended activity's update tokens too.",
    input: liveActivityPushSchema,
    output: z.object({ sent: z.number().int().min(0), removed: z.number().int().min(0) }),
  },
  push_status: {
    experimental_description: "Whether pushes can go out, to how many phones, and the last delivery. Studio shows it in its Phone notifications settings.",
    input: z.null().optional(),
    output: z.object({
      ready: z.boolean(),
      problem: z.string().nullable(),
      devices: z.number().int().min(0),
      lastDelivery: z.object({ at: z.number(), sent: z.number().int().min(0) }).nullable(),
      deskHold: deskOutput.optional(),
    }),
  },
  desk_beat: {
    experimental_description: "A client says whether the user is at the desk: \"active\" every 30 to 60 seconds while they are, \"away\" when the Mac goes idle or locks. While any client is active, phone pushes about threads wait.",
    input: z.strictObject({ clientId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/), state: z.enum(["active", "away"]), source: z.enum(["system", "window"]) }),
    output: deskOutput,
  },
  desk_hold_set: {
    experimental_description: "Turns \"Hold phone notifications while I'm at my Mac\" on or off. Off sends what is waiting now.",
    input: z.strictObject({ enabled: z.boolean() }),
    output: deskOutput,
  },
  push_test: {
    experimental_description: "Send a test push to every phone the relay has delivered to.",
    input: z.null().optional(),
    output: z.object({ ok: z.boolean(), sent: z.number().int().min(0), message: z.string() }),
  },
  mute_set: {
    experimental_description: "BB Studio mutes or unmutes a thread's notifications on this phone.",
    input: z.object({ threadId: z.string().regex(/^thr_[A-Za-z0-9]+$/), muted: z.boolean() }),
    output: z.object({ threadIds: z.array(z.string()) }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  // Durable identity lets the phone reject pushes from a different selected server.
  const serverId = (await bb.storage.kv.get<string>("server-id")) ?? randomUUID();
  await bb.storage.kv.set("server-id", serverId);
  bb.http.route("GET", "/identity", (context) => context.json({ serverId }));
  // Only the APNs key and Key ID are settings (settings.ts); the rest are constants.
  const settings = bb.settings.define(MOBILE_SETTINGS);
  const constants = mobileConstants();
  if (!(await bb.storage.kv.get(MOBILE_MIGRATED_KEY))) {
    // The old fields, declared for this load only, so BB returns their values.
    const legacy = bb.settings.define(LEGACY_MOBILE_SETTINGS);
    try {
      const report = await migrateMobileSettings({
        kv: bb.storage.kv,
        keys: { get: () => settings.get(), experimental_set: (values) => settings.experimental_set(values) },
        legacy: { get: () => legacy.get() },
        readKeyFile: (path) => readFile(path.replace(/^~(?=\/)/, homedir()), "utf8"),
      });
      if (report) {
        bb.log.info(describeMobileMigration(report));
        const timer = setTimeout(() => {
          void Promise.resolve().then(() => bb.sdk.plugins.reload({ pluginId: "mobile" })).catch((error: unknown) => bb.log.warn(`Settings moved; reload Studio Mobile to hide the old fields (${error instanceof Error ? error.message : String(error)}).`));
        }, 3000);
        timer.unref?.();
        bb.onDispose(() => clearTimeout(timer));
      }
    } catch (error) {
      bb.log.warn(`Couldn't migrate Studio Mobile's settings; trying again next load: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const db = bb.storage.database();
  bb.storage.migrate(db, MOBILE_MIGRATIONS);
  const activityTokens = new LiveActivityTokens(db);

  const sender = new Http2ApnsSender();
  bb.onDispose(() => sender.close());

  let tokenCache: { fingerprint: string; token: ProviderToken } | null = null;

  /** Current APNs config, or the reason it is not usable yet. */
  async function apnsConfig(): Promise<{ config: ApnsConfig; token: ProviderToken } | { missing: string }> {
    const values = await settings.get();
    let keyPem = values.apnsKey?.toString().trim() ?? "";
    // A key file path the migration couldn't read (settings.ts); pasting the key replaces it.
    const keyPath = keyPem === "" ? (await bb.storage.kv.get<string>(LEGACY_KEY_PATH_KEY)) ?? "" : "";
    if (keyPath !== "") {
      try {
        keyPem = await readFile(keyPath.replace(/^~(?=\/)/, homedir()), "utf8");
      } catch {
        return { missing: `APNs key is not set, and the old key file isn't readable at ${keyPath}` };
      }
    }
    if (keyPem === "") return { missing: "APNs key is not set" };
    if (values.apnsKeyId.trim() === "") return { missing: "APNs key ID is not set" };
    const config: ApnsConfig = {
      keyPem,
      keyId: values.apnsKeyId.trim(),
      teamId: constants.teamId,
      bundleId: constants.bundleId,
      environment: constants.environment,
    };
    const fingerprint = `${config.keyId}:${config.teamId}:${createHash("sha256").update(keyPem).digest("hex")}`;
    if (tokenCache?.fingerprint !== fingerprint) {
      try {
        tokenCache = { fingerprint, token: new ProviderToken(config) };
      } catch {
        return { missing: "APNs key could not be parsed as a P-256 private key" };
      }
    }
    return { config, token: tokenCache.token };
  }

  async function forwardToExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    const failed = (message: string): ExpoTicket[] => messages.map(() => ({ status: "error", message }));
    try {
      const response = await fetch(constants.expoPushUrl, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(20_000),
      });
      const parsed = (await response.json()) as { data?: ExpoTicket[] };
      if (!Array.isArray(parsed.data) || parsed.data.length !== messages.length) {
        return failed(`Expo returned an unexpected response (${response.status})`);
      }
      return parsed.data;
    } catch {
      return failed("Expo push request failed");
    }
  }

  /**
   * BB's pending-interaction pushes carry only the thread. Add the interaction
   * so the app can offer Approve/Deny or a reply box on the lock screen.
   */
  type Lookups = Map<string, Promise<Record<string, unknown> | null>>;
  async function interactionDetails(lookups: Lookups, threadId: string, interactionId: string | undefined): Promise<Record<string, unknown> | null> {
    const key = `${threadId}\u0000${interactionId ?? ""}`;
    if (!lookups.has(key)) lookups.set(key, lookupInteraction(threadId, interactionId));
    return lookups.get(key)!;
  }
  async function lookupInteraction(threadId: string, interactionId: string | undefined): Promise<Record<string, unknown> | null> {
    try {
      const interactions = await bb.sdk.threads.interactions.list({ threadId });
      const pending = interactions.find((interaction) => interaction.status === "pending" && (interactionId === undefined || interaction.id === interactionId));
      if (!pending) return null;
      const payload = pending.payload as {
        kind: string;
        subject?: { kind?: string };
        availableDecisions?: string[];
        questions?: Array<{ multiSelect?: boolean; allowFreeText?: boolean; options?: Array<{ label: string }> }>;
      };
      // One single-select question gets a button per option (the app's notification extension builds them).
      const question = payload.questions?.length === 1 ? payload.questions[0] : undefined;
      const choices = question && !question.multiSelect ? (question.options ?? []).slice(0, MAX_CHOICES) : [];
      return {
        interactionId: pending.id,
        interactionKind: payload.kind,
        ...(payload.subject?.kind ? { subjectKind: payload.subject.kind } : {}),
        ...(payload.availableDecisions ? { decisions: payload.availableDecisions } : {}),
        ...(choices.length > 0
          ? { choices: choices.map((option) => option.label.slice(0, 40)), choiceFreeText: question?.allowFreeText === true }
          : {}),
      };
    } catch (error) {
      bb.log.warn(`interaction lookup failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function enrichInteractions(messages: ExpoMessage[], lookups: Lookups): Promise<void> {
    await Promise.all(
      messages.map(async (message) => {
        const data = message.data;
        const threadId = typeof data?.workerId === "string" ? data.workerId : data?.threadId;
        if (data?.kind !== "pending-interaction" || typeof threadId !== "string") return;
        const extra = await interactionDetails(lookups, threadId, typeof data.interactionId === "string" ? data.interactionId : undefined);
        if (extra) message.data = { ...message.data, ...extra };
      }),
    );
  }

  const studioApprovals = new StudioApprovals();

  async function sentByStudio(message: ExpoMessage, lookups: Lookups, owners: Map<string, Promise<boolean>>): Promise<boolean> {
    const data = message.data;
    const threadId = data?.threadId;
    if (data?.kind !== "pending-interaction" || typeof threadId !== "string" || data.workerId !== undefined) return false;
    const details = await interactionDetails(lookups, threadId, typeof data.interactionId === "string" ? data.interactionId : undefined);
    if (details?.interactionKind !== "approval" || details.subjectKind === "plan" || typeof details.interactionId !== "string") return false;
    const interactionId = details.interactionId;
    if (!owners.has(threadId)) {
      owners.set(threadId, bb.sdk.plugins.callRpc({
        pluginId: STUDIO_PLUGIN_ID, method: "bot_push_ids", input: { threadId } as never, outputSchema: pushIdsOutput,
        signal: AbortSignal.timeout(5_000),
      }).then((ids) => typeof ids.workerId === "string" && ids.workerId === threadId && typeof ids.conversationId === "string", () => false));
    }
    if (!(await owners.get(threadId)!)) return false;
    return studioApprovals.reached(interactionId, message.to);
  }

  type EventRow = { type?: string; turnId?: string | null; scope?: { turnId?: string | null } | null; data?: Record<string, unknown> };
  const turnOf = (event: EventRow) => event.scope?.turnId ?? event.turnId ?? null;
  /** The thread's latest turn: what started it and its final reply. Null when BB's events can't tell. */
  async function latestTurn(threadId: string): Promise<{ trigger: TurnTrigger; reply: string | null } | null> {
    try {
      const list = (types: string[], limit: number) => bb.sdk.threads.events.list({ threadId, types, order: "desc", limit: String(limit) } as never) as Promise<EventRow[]>;
      const [started] = await list(["turn/started"], 1);
      const turnId = started ? turnOf(started) : null;
      if (!turnId) return null;
      const [accepted, requested, completed] = await Promise.all([list(["turn/input/accepted"], 5), list(["client/turn/requested"], 20), list(["item/completed"], 100)]);
      const requestId = accepted.find((event) => turnOf(event) === turnId)?.data?.clientRequestId;
      const request = typeof requestId === "string" ? requested.find((event) => event.data?.requestId === requestId) : undefined;
      if (typeof requestId === "string" && !request) return null;
      const items = completed.filter((event) => turnOf(event) === turnId);
      const message = items.map((event) => event.data?.item as { type?: string; text?: string } | undefined).find((item) => item?.type === "agentMessage");
      if (!message && completed.length >= 100 && items.length === completed.length) return null;
      const reply = typeof message?.text === "string" && message.text.trim() !== "" ? message.text : null;
      return { trigger: triggerOf(request?.data ?? null), reply };
    } catch {
      return null;
    }
  }


  const replyTag = z.object({ decision: z.enum(["push", "quiet", "unknown"]), ask: z.string().nullable() }).passthrough();
  type ReplyTag = z.infer<typeof replyTag>;
  type Lookup = { turns: Map<string, Promise<{ trigger: TurnTrigger; reply: string | null } | null>>; tags: Map<string, Promise<ReplyTag | null>> };
  /** Studio's tag for the thread's newest reply (strands.replyPush); null when Studio doesn't answer. */
  function studioTag(threadId: string, lookup: Lookup): Promise<ReplyTag | null> {
    if (!lookup.tags.has(threadId)) {
      lookup.tags.set(threadId, bb.sdk.plugins.callRpc({
        pluginId: STUDIO_PLUGIN_ID, method: "strands.replyPush", input: { threadId, waitMs: REPLY_TAG_WAIT_MS } as never, outputSchema: replyTag,
        signal: AbortSignal.timeout(REPLY_TAG_WAIT_MS + 5_000),
      }).then((tag) => tag as ReplyTag, () => null));
    }
    return lookup.tags.get(threadId)!;
  }

  /**
   * BB's own push for a finished turn (push-notifications: it has a
   * subscription), checked against the turn it is about, then against
   * Studio's tag for its reply: a status reply is dropped, and one that needs
   * the user goes out with its ask as the body, even when another thread
   * started the turn (a worker's notice). When Studio can't tell, the turn's
   * own rules decide as before. True: drop it.
   */
  async function quietTurn(message: ExpoMessage, lookup: Lookup): Promise<boolean> {
    const data = message.data;
    if (data?.kind !== "turn-finished" || typeof data.subscriptionId !== "string" || typeof data.threadId !== "string" || data.botId !== undefined) return false;
    // Held and sent later (the conversation's window, the desk): decided on its first pass, about its own turn; its "N new" summary stays.
    if ((message as CheckedMessage)[CHECKED]) return false;
    const threadId = data.threadId;
    if (!lookup.turns.has(threadId)) lookup.turns.set(threadId, latestTurn(threadId));
    const turn = await lookup.turns.get(threadId)!;
    const allowed = turn === null || turnPushAllowed(turn);
    // A keepalive, a quiet reply or a turn with nothing to say never pushes; a turn another thread started pushes only for an ask.
    if (!allowed && !(turn!.trigger === "thread" && isUserFacingReply(turn!.reply))) return true;
    const tag = await studioTag(threadId, lookup);
    const drop = tag?.decision === "push" ? false : !allowed || tag?.decision === "quiet";
    if (!drop) {
      if (tag?.decision === "push" && tag.ask) message.body = tag.ask;
      (message as CheckedMessage)[CHECKED] = true;
    }
    return drop;
  }

  const windows = new PushWindows(async ({ key, messages, shown, held, since }) => {
    const thread = await bb.sdk.threads.get({ threadId: key }).catch(() => null);
    const lastReadAt = thread?.lastReadAt ?? 0;
    if (thread && lastReadAt >= thread.latestAttentionAt) return false;
    const count = thread && lastReadAt >= since ? held : shown;
    const tickets = await deliver(messages.map((message) => ({ ...message, body: summaryBody(message.body, count), collapseId: collapseIdFor(key) })), { windowed: false, later: "window" });
    return tickets.some((ticket) => ticket.status === "ok");
  });
  bb.onDispose(() => windows.dispose());

  let deskHoldEnabled = (await bb.storage.kv.get<{ enabled: boolean }>(DESK_HOLD_KEY))?.enabled !== false;
  const desk = new DeskHold({
    seen: async ({ threadId, workerId }) => {
      const state = await readState(threadId, workerId ? [workerId] : []);
      return state === undefined ? undefined : settled(state);
    },
    send: async (messages) => { await deliver(messages, { windowed: false, held: false, later: "desk" }); },
    log: (message) => bb.log.info(message),
  });
  bb.onDispose(() => desk.dispose());
  const deskStatus = () => {
    const { atDesk, held } = desk.status();
    return { enabled: deskHoldEnabled, atDesk, held };
  };

  let journalQueue: Promise<void> = Promise.resolve();
  function journal(entries: JournalEntry[]): Promise<void> {
    if (entries.length === 0) return journalQueue;
    journalQueue = journalQueue.then(async () => {
      await bb.storage.kv.set(JOURNAL_KEY, appendJournal((await bb.storage.kv.get<JournalEntry[]>(JOURNAL_KEY)) ?? [], entries));
    }).catch((error: unknown) => bb.log.warn(`delivery journal: ${error instanceof Error ? error.message : String(error)}`));
    return journalQueue;
  }

  async function deliver(messages: ExpoMessage[], options: { windowed?: boolean; held?: boolean; later?: "desk" | "window" } = {}): Promise<ExpoTicket[]> {
    const outcomes: (JournalOutcome | undefined)[] = new Array(messages.length);
    const tickets: ExpoTicket[] = new Array(messages.length);
    const expoIndexes: number[] = [];
    const apnsIndexes: number[] = [];
    const lookups: Lookups = new Map();
    const owners = new Map<string, Promise<boolean>>();
    const lookup: Lookup = { turns: new Map(), tags: new Map() };
    const studios = await Promise.all(messages.map(async (message) => isQuietCompletion(message) || await sentByStudio(message, lookups, owners) || await quietTurn(message, lookup)));
    messages.forEach((message, index) => {
      if (studios[index]) {
        tickets[index] = { status: "ok" };
        outcomes[index] = "quiet";
        return;
      }
      (message.to.startsWith(APNS_TOKEN_PREFIX) ? apnsIndexes : expoIndexes).push(index);
    });

    // Muted threads are dropped for the app only; other subscribers still get them.
    const muted = new Set((await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? []);
    if (muted.size > 0) {
      for (let position = apnsIndexes.length - 1; position >= 0; position--) {
        const index = apnsIndexes[position]!;
        const data = messages[index]!.data;
        if ([data?.threadId, data?.workerId].some((id) => typeof id === "string" && muted.has(id))) {
          tickets[index] = { status: "ok" };
          outcomes[index] = "muted";
          apnsIndexes.splice(position, 1);
        }
      }
    }

    // While the user is at the desk, pushes about threads wait (desk.ts).
    if (deskHoldEnabled && options.held !== false && apnsIndexes.length > 0) {
      const holding = apnsIndexes.filter((index) => holdable(messages[index]!));
      if (desk.hold(holding.map((index) => messages[index]!))) {
        for (const index of holding) { tickets[index] = { status: "ok" }; outcomes[index] = "desk"; }
        apnsIndexes.splice(0, apnsIndexes.length, ...apnsIndexes.filter((index) => !holding.includes(index)));
      }
    }

    // One reply push per conversation per window (push-window.ts); the rest wait and go out as one.
    if (options.windowed !== false && apnsIndexes.length > 0) {
      const byKey = new Map<string, number[]>();
      for (const index of apnsIndexes) {
        const key = windowKey(messages[index]!);
        if (key) byKey.set(key, [...(byKey.get(key) ?? []), index]);
      }
      const held = new Set<number>();
      for (const [key, indexes] of byKey) {
        if (windows.offer(key, indexes.map((index) => messages[index]!))) {
          for (const index of indexes) messages[index] = { ...messages[index]!, collapseId: collapseIdFor(key) };
        } else {
          for (const index of indexes) { held.add(index); tickets[index] = { status: "ok" }; outcomes[index] = "window"; }
        }
      }
      if (held.size > 0) apnsIndexes.splice(0, apnsIndexes.length, ...apnsIndexes.filter((index) => !held.has(index)));
    }

    if (apnsIndexes.length > 0) {
      await enrichInteractions(apnsIndexes.map((index) => messages[index]!), lookups);
      for (const index of apnsIndexes) messages[index]!.data = { ...messages[index]!.data, serverId };
      const apns = await apnsConfig();
      await Promise.all(
        apnsIndexes.map(async (index) => {
          tickets[index] =
            "missing" in apns
              ? { status: "error", message: apns.missing, details: { error: "MobilePluginNotConfigured" } }
              : await deliverApns(messages[index]!, apns.config, apns.token, sender.send);
        }),
      );
    }
    if (expoIndexes.length > 0) {
      const expoTickets = await forwardToExpo(expoIndexes.map((index) => messages[index]!));
      expoIndexes.forEach((index, position) => {
        tickets[index] = expoTickets[position]!;
      });
    }

    // Only attempted deliveries refresh devices; quiet and muted messages do not.
    const deliveryIndexes = [...apnsIndexes, ...expoIndexes];
    await rememberDevices(deliveryIndexes.map((index) => messages[index]!), deliveryIndexes.map((index) => tickets[index]!));
    await rememberNotified(apnsIndexes.flatMap((index) => {
      const { threadId, workerId } = messages[index]!.data ?? {};
      return tickets[index]?.status === "ok" && typeof threadId === "string"
        ? [{ threadId, ...(typeof workerId === "string" && workerId !== threadId ? { workerId } : {}) }]
        : [];
    }));
    const now = Date.now();
    await journal(messages.map((message, index) => {
      const outcome = outcomes[index] ?? (tickets[index]?.status === "ok" ? "sent" : "error");
      const category = outcome === "sent" && message.to.startsWith(APNS_TOKEN_PREFIX) ? notificationCategory(message.data ?? {}) : undefined;
      return journalEntry(message, outcome, now, { ...(category ? { category } : {}), ...(options.later && outcome === "sent" ? { later: options.later } : {}) });
    }));
    // Expo names the device token in some errors; none is stored, logged or printed.
    const errors = tickets.flatMap((ticket) => (ticket.status === "error" ? [redactSecrets(ticket.message ?? "unknown")] : []));
    for (const error of new Set(errors)) bb.log.warn(`push delivery failed: ${error}`);
    await bb.storage.kv.set(LAST_DELIVERY_KEY, {
      at: new Date().toISOString(),
      apns: apnsIndexes.length,
      expo: expoIndexes.length,
      errors: [...new Set(errors)],
      categories: apnsIndexes.map((index) => notificationCategory(messages[index]!.data ?? {}) ?? "none"),
    } satisfies LastDelivery);
    return tickets;
  }

  let devicesQueue: Promise<void> = Promise.resolve();
  function updateDevices(update: (devices: Record<string, number>) => Record<string, number>): Promise<void> {
    const task = devicesQueue.then(async () => {
      const devices = (await bb.storage.kv.get<Record<string, number>>(DEVICES_KEY)) ?? {};
      await bb.storage.kv.set(DEVICES_KEY, update(devices));
    });
    devicesQueue = task.catch(() => {});
    return task;
  }

  async function rememberDevices(messages: ExpoMessage[], tickets: ExpoTicket[]) {
    await updateDevices((devices) => rememberedDevices(devices, messages, tickets, Date.now()));
  }

  // --- Clearing read notifications -------------------------------------------

  /** Serializes read-modify-write of the notified threads. */
  let notifiedQueue: Promise<void> = Promise.resolve();
  function withNotified(fn: (notified: Notified, workers: NotifiedWorkers) => Promise<{ notified: Notified; workers: NotifiedWorkers }>): Promise<void> {
    notifiedQueue = notifiedQueue
      .then(async () => {
        const notified = (await bb.storage.kv.get<Notified>(NOTIFIED_KEY)) ?? {};
        const workers = (await bb.storage.kv.get<NotifiedWorkers>(NOTIFIED_WORKERS_KEY)) ?? {};
        const next = await fn(notified, workers);
        await bb.storage.kv.set(NOTIFIED_KEY, next.notified);
        if (Object.keys(workers).length > 0 || Object.keys(next.workers).length > 0) await bb.storage.kv.set(NOTIFIED_WORKERS_KEY, next.workers);
      })
      .catch((error: unknown) => {
        bb.log.warn(`clearing notifications: ${error instanceof Error ? error.message : String(error)}`);
      });
    return notifiedQueue;
  }

  function rememberNotified(entries: Array<{ threadId: string; workerId?: string }>): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    return withNotified(async (notified, workers) => ({
      notified: noteNotified(notified, entries.map((entry) => entry.threadId), Date.now()),
      workers: noteWorkers(workers, entries),
    }));
  }

  const readWarnings = new Map<string, number>();
  async function readState(threadId: string, workers: readonly string[]): Promise<ThreadReadState | null | undefined> {
    try {
      // Only a missing thread establishes deletion. A failed interactions
      // request must not turn a still-pending approval into a clear push.
      const thread = await bb.sdk.threads.get({ threadId }).catch((error: unknown) => {
        if (error && typeof error === "object" && ("status" in error && error.status === 404 || "statusCode" in error && error.statusCode === 404)) return null;
        throw error;
      });
      if (!thread) return null;
      const lists = await Promise.all([
        bb.sdk.threads.interactions.list({ threadId }),
        ...workers.map((id) => bb.sdk.threads.interactions.list({ threadId: id }).catch((error: unknown) => {
          if (error && typeof error === "object" && ("status" in error && error.status === 404 || "statusCode" in error && error.statusCode === 404)) return [];
          throw error;
        })),
      ]);
      readWarnings.delete(threadId);
      return { ...thread, hasPendingInteraction: lists.some((interactions) => interactions.some((interaction) => interaction.status === "pending")) };
    } catch (error) {
      const now = Date.now();
      if (!readWarnings.has(threadId) || now - readWarnings.get(threadId)! >= 5 * CLEAR_INTERVAL_MS) {
        bb.log.warn(`notification read-state lookup failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
        readWarnings.set(threadId, now);
      }
      return undefined;
    }
  }

  function clearReadNotifications(): Promise<void> {
    return withNotified(async (notified, workers) => {
      const threadIds = Object.keys(notified);
      for (const id of readWarnings.keys()) if (!(id in notified)) readWarnings.delete(id);
      if (threadIds.length === 0) return { notified, workers: {} };
      const apns = await apnsConfig();
      if ("missing" in apns) return { notified, workers };
      const states = Object.fromEntries(await Promise.all(threadIds.map(async (id) => [id, await readState(id, workers[id] ?? [])] as const)));
      const { clear, keep } = partition(notified, states, Date.now());
      const observed = (await bb.storage.kv.get<Record<string, number>>(DEVICES_KEY)) ?? {};
      let devices = Object.keys(observed)
        .filter((to) => to.startsWith(APNS_TOKEN_PREFIX))
        .map((to) => to.slice(APNS_TOKEN_PREFIX.length));
      const gone = new Set<string>();
      for (let start = 0; start < clear.length; start += CLEAR_BATCH) {
        const batch = clear.slice(start, start + CLEAR_BATCH);
        const payload = clearPayload(batch, serverId);
        devices = devices.filter((deviceToken) => !gone.has(deviceToken));
        let delivered = devices.length > 0;
        for (const deviceToken of devices) {
          const result = await sendApns({ deviceToken, payload, pushType: "background", priority: 5 }, apns.config, apns.token, sender.send);
          // A token Apple rejects for good is forgotten instead of blocking every clear and retrying it each minute.
          if (isGoneResult(result)) {
            gone.add(deviceToken);
            continue;
          }
          if (result.status !== 200) {
            delivered = false;
            bb.log.warn(`clear push failed: ${result.reason ?? result.status}`);
          }
        }
        // Clearing twice is harmless; dropping a failed clear is permanent.
        if (!delivered) for (const id of batch) keep[id] = notified[id]!;
      }
      if (gone.size > 0) {
        await updateDevices((current) => {
          for (const deviceToken of gone) {
            const key = `${APNS_TOKEN_PREFIX}${deviceToken}`;
            if (current[key] === observed[key]) delete current[key];
          }
          return current;
        });
      }
      return { notified: keep, workers: keptWorkers(workers, keep) };
    });
  }

  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleClear() {
    if (clearTimer) return;
    clearTimer = setTimeout(() => {
      clearTimer = null;
      void clearReadNotifications();
    }, CLEAR_DELAY_MS);
  }
  // Answering a question resumes the thread; archiving or deleting removes it.
  bb.events.on("thread.active", () => scheduleClear());
  bb.events.on("thread.archived", () => scheduleClear());
  bb.events.on("thread.deleted", () => scheduleClear());
  const clearEvery = setInterval(() => void clearReadNotifications(), CLEAR_INTERVAL_MS);
  bb.onDispose(() => {
    clearInterval(clearEvery);
    if (clearTimer) clearTimeout(clearTimer);
  });

  // Token auth: only the push-notifications sender (given the tokened URL) may post here.
  bb.http.route(
    "POST",
    "/push",
    async (context) => {
      let raw: unknown;
      try {
        raw = await context.req.json();
      } catch {
        return context.json({ errors: [{ code: "VALIDATION_ERROR", message: "Body must be JSON" }] }, 400);
      }
      const parsed = batchSchema.safeParse(raw);
      if (!parsed.success) {
        return context.json({ errors: [{ code: "VALIDATION_ERROR", message: "Expected push messages" }] }, 400);
      }
      return context.json({ data: await deliver(parsed.data as ExpoMessage[]) });
    },
    { auth: "token" },
  );

  let mutedQueue: Promise<unknown> = Promise.resolve();
  const callRpc = (call: Parameters<typeof bb.sdk.plugins.callRpc>[0]) => bb.sdk.plugins.callRpc(call);
  // Threads muted before the two mutes were one get BB's level once.
  if (!(await bb.storage.kv.get(MUTE_LEVELS_SYNCED_KEY))) {
    const before = (await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? [];
    const results = await Promise.all(before.map((threadId) => setThreadMuted(callRpc, threadId, true)));
    if (results.every(Boolean)) await bb.storage.kv.set(MUTE_LEVELS_SYNCED_KEY, { at: Date.now() });
  }
  bb.rpc.register(mobileContract, {
    async notify(input) {
      if (isQuietCompletion({ body: input.body, data: { kind: input.kind } })) return { ok: true as const, sent: 0 };
      // Devices unseen past the TTL are not sent to; the next delivery prunes them.
      const now = Date.now();
      const devices = Object.entries((await bb.storage.kv.get<Record<string, number>>(DEVICES_KEY)) ?? {})
        .flatMap(([to, seen]) => (now - seen > DEVICE_TTL_MS ? [] : [to]));
      // Without a thread there is nothing to reply to, so leave out the kind that adds a reply box.
      const bot = { ...(input.botId ? { botId: input.botId } : {}), ...(input.conversationId ? { conversationId: input.conversationId } : {}), ...(input.workerId ? { workerId: input.workerId } : {}), ...(input.interactionId ? { interactionId: input.interactionId } : {}) };
      const data = input.threadId
        ? { kind: input.kind, threadId: input.threadId, projectId: input.projectId, ...(input.path ? { path: input.path } : {}), ...bot }
        : { projectId: input.projectId, ...(input.path ? { path: input.path } : {}), ...bot };
      const approval = input.kind === "pending-interaction" && input.workerId && input.interactionId ? input.interactionId : null;
      let tickets: ExpoTicket[] = [];
      try {
        tickets = devices.length > 0
          ? await deliver(devices.map((to) => ({
              to, title: input.title, body: input.body, sound: "default", data: {...data, ...(input.category ? {category:input.category,loopId:input.loopId,actions:input.actions,...(input.loopKind?{loopKind:input.loopKind}:{}),...(input.options?.length?{options:input.options}:{})} : {})},
              ...(input.coalesceKey ? { collapseId: input.coalesceKey } : {}),
            })))
          : [];
      } finally {
        if (approval) studioApprovals.finish(approval, devices.filter((_to, index) => tickets[index]?.status === "ok"));
      }
      const muted = new Set((await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? []);
      const sent = tickets.filter((ticket, index) => ticket.status === "ok" &&
        !(devices[index]!.startsWith(APNS_TOKEN_PREFIX) && [input.threadId, input.workerId].some((id) => id && muted.has(id)))).length;
      return { ok: true as const, sent };
    },
    async push_status() {
      const apns = await apnsConfig();
      const now = Date.now();
      const devices = Object.entries((await bb.storage.kv.get<Record<string, number>>(DEVICES_KEY)) ?? {})
        .filter(([to, seen]) => to.startsWith(APNS_TOKEN_PREFIX) && now - seen <= DEVICE_TTL_MS).length;
      const last = await bb.storage.kv.get<LastDelivery>(LAST_DELIVERY_KEY);
      return {
        ready: !("missing" in apns),
        problem: "missing" in apns ? apns.missing : null,
        devices,
        lastDelivery: last ? { at: Date.parse(last.at) || 0, sent: Math.max(0, last.apns + last.expo - last.errors.length) } : null,
        deskHold: deskStatus(),
      };
    },
    desk_beat(input) {
      desk.beat(input);
      return deskStatus();
    },
    async desk_hold_set({ enabled }) {
      deskHoldEnabled = enabled;
      await bb.storage.kv.set(DESK_HOLD_KEY, { enabled });
      if (!enabled) await desk.releaseNow();
      return deskStatus();
    },
    async push_test() {
      const apns = await apnsConfig();
      if ("missing" in apns) return { ok: false, sent: 0, message: apns.missing };
      const now = Date.now();
      const devices = Object.entries((await bb.storage.kv.get<Record<string, number>>(DEVICES_KEY)) ?? {})
        .flatMap(([to, seen]) => (to.startsWith(APNS_TOKEN_PREFIX) && now - seen <= DEVICE_TTL_MS ? [to] : []));
      if (!devices.length) return { ok: false, sent: 0, message: "No phone has received a push yet. Open the BB Studio app and allow notifications." };
      const tickets = await deliver(devices.map((to) => ({ to, title: "BB Studio", body: "Test push from Studio Mobile. Pushes work.", sound: "default", data: {} })));
      const sent = tickets.filter((ticket) => ticket.status === "ok").length;
      const failed = tickets.flatMap((ticket) => (ticket.status === "error" ? [redactSecrets(ticket.message ?? "unknown")] : []));
      return sent
        ? { ok: true, sent, message: `Sent to ${sent} phone${sent === 1 ? "" : "s"}.` }
        : { ok: false, sent: 0, message: `Apple didn't take it: ${[...new Set(failed)].join("; ") || "unknown error"}` };
    },
    async mute_list() {
      const own = (await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? [];
      // BB's level is the mute; a thread unmuted on the desktop leaves the phone's list too.
      const kept = await stillMuted(callRpc, own);
      if (kept === null || kept.length === own.length) return { threadIds: own };
      const next = mutedQueue.then(async () => {
        const current = (await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? [];
        const threadIds = current.filter((id) => kept.includes(id) || !own.includes(id));
        await bb.storage.kv.set(MUTED_KEY, threadIds);
        return { threadIds };
      });
      mutedQueue = next.catch(() => {});
      return next;
    },
    mute_set(input) {
      // Serialized so quick toggles from several devices never overwrite each other.
      const next = mutedQueue.then(async () => {
        const current = (await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? [];
        const rest = current.filter((id) => id !== input.threadId);
        const threadIds = input.muted ? [...rest, input.threadId].slice(-MAX_MUTED) : rest;
        await bb.storage.kv.set(MUTED_KEY, threadIds);
        // The same mute everywhere: BB's own level for the thread. Best effort; the list above still mutes the phone.
        await setThreadMuted(callRpc, input.threadId, input.muted);
        return { threadIds };
      });
      mutedQueue = next.catch(() => {});
      return next;
    },
    live_activity_register(input) {
      activityTokens.register(input);
      return { ok: true as const };
    },
    live_activity_unregister(input) {
      return { removed: activityTokens.unregister(input) };
    },
    async live_activity_push(input) {
      const tokens = activityTokens.forBot(input.botId, input.event === "start" ? "push-to-start" : "update");
      if (!tokens.length) return { sent: 0, removed: 0 };
      const apns = await apnsConfig();
      if ("missing" in apns) throw new Error(apns.missing);
      const payload = liveActivityPayload(input, Date.now());
      const priority = liveActivityPriority(input);
      let sent = 0;
      let removed = 0;
      const pushed = new Set<string>();
      for (const token of tokens) {
        if (pushed.has(token.token)) continue;
        pushed.add(token.token);
        const result = await sendApns({ deviceToken: token.token, payload, pushType: "liveactivity", priority }, apns.config, apns.token, sender.send);
        if (isGoneResult(result)) {
          for (const each of tokens) if (each.token === token.token) activityTokens.forget(each);
          removed++;
          continue;
        }
        if (result.status !== 200) {
          bb.log.warn(`Live Activity ${input.event} push failed: ${result.reason ?? result.status}`);
          continue;
        }
        sent++;
        if (input.event === "end") for (const each of tokens) if (each.token === token.token) activityTokens.forget(each);
      }
      return { sent, removed };
    },
  });

  bb.cli.register(studioCliRegistration({
    name: "mobile",
    summary: "BB Studio push relay status",
    commands: [
      { name: "status", summary: "Show APNs setup and the last delivery", usage: "bb mobile status [--json]" },
      { name: "live-activities", summary: "List the Live Activity tokens phones registered, per device and Bot", usage: "bb mobile live-activities [--json]" },
      { name: "deliveries", summary: "What the relay did with each push: per hour, sent by kind, and the last ones", usage: "bb mobile deliveries [--hours N] [--json]" },
    ],
    async run(argv) {
      const [command] = argv.filter((arg) => arg !== "--json");
      if (command === "deliveries") {
        const hoursArg = argv.indexOf("--hours");
        const hours = hoursArg >= 0 ? Number(argv[hoursArg + 1]) : 24;
        if (!Number.isFinite(hours) || hours <= 0) return { exitCode: 1, stderr: "Usage: bb mobile deliveries [--hours N] [--json]" };
        const since = Date.now() - hours * 3_600_000;
        const entries = ((await bb.storage.kv.get<JournalEntry[]>(JOURNAL_KEY)) ?? []).filter((entry) => entry.at >= since);
        const hourOf = (at: number) => { const date = new Date(at); return `${date.toISOString().slice(0, 10)} ${String(date.getHours()).padStart(2, "0")}:00`; };
        const summary = journalSummary(entries, since, hourOf);
        if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify({ since, summary, entries }) };
        if (entries.length === 0) return { exitCode: 0, stdout: `No pushes in the last ${hours} h.` };
        const counts = (record: Record<string, number | undefined>) => Object.entries(record).map(([key, value]) => `${key} ${value}`).join(", ");
        return {
          exitCode: 0,
          stdout: [
            ...summary.map((row) => `${row.hour}  ${counts(row.outcomes)}${Object.keys(row.sent).length ? `  · sent: ${counts(row.sent)}` : ""}`),
            "",
            "Last 20:",
            ...entries.slice(-20).map((entry) => `${new Date(entry.at).toISOString()}  ${entry.outcome}${entry.later ? ` (${entry.later})` : ""}  ${entry.kind}  ${entry.threadId ?? "-"}${entry.conversationId ? ` in ${entry.conversationId}` : ""}${entry.category ? `  ${entry.category}` : ""}${entry.keyed ? "  keyed" : ""}`),
          ].join("\n"),
        };
      }
      if (command === "live-activities") {
        const rows = activityTokens.all().map(({ deviceId, botId, kind, updatedAt }) => ({ deviceId, botId, kind, updatedAt }));
        if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify({ tokens: rows }) };
        return { exitCode: 0, stdout: rows.length ? rows.map((row) => `${row.deviceId}  ${row.botId}  ${row.kind}  ${new Date(row.updatedAt).toISOString()}`).join("\n") : "No Live Activity tokens." };
      }
      if (command !== undefined && command !== "status") {
        return { exitCode: 1, stderr: "Usage: bb mobile status [--json] | bb mobile live-activities [--json] | bb mobile deliveries [--hours N] [--json]" };
      }
      const apns = await apnsConfig();
      const last = await bb.storage.kv.get<LastDelivery>(LAST_DELIVERY_KEY);
      const status = {
        apnsReady: !("missing" in apns),
        apnsProblem: "missing" in apns ? apns.missing : null,
        environment: "missing" in apns ? null : apns.config.environment,
        relayPath: `/api/v1/plugins/mobile/http/push?token=<${studioCliName()} plugin token mobile>`,
        lastDelivery: last ?? null,
        deskHold: deskStatus(),
      };
      // Errors stored before redaction are redacted here.
      if (argv.includes("--json")) return { exitCode: 0, stdout: redactSecrets(JSON.stringify(status)) };
      return {
        exitCode: 0,
        stdout: redactSecrets([
          `APNs: ${status.apnsReady ? `ready (${status.environment})` : `not ready: ${status.apnsProblem}`}`,
          `Relay: ${status.relayPath}`,
          last
            ? `Last delivery ${last.at}: ${last.apns} APNs, ${last.expo} Expo${last.categories?.length ? ` (categories: ${last.categories.join(", ")})` : ""}${last.errors.length ? `; errors: ${last.errors.join("; ")}` : ""}`
            : "No deliveries yet.",
          `Hold while at the desk: ${status.deskHold.enabled ? "on" : "off"}; at the desk: ${status.deskHold.atDesk === null ? "unknown" : status.deskHold.atDesk ? "yes" : "no"}; held: ${status.deskHold.held}`,
        ].join("\n")),
      };
    },
  }));
}
