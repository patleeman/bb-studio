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
// It also drives the app's thread Live Activities (see live.ts): thread events
// pick which threads get one and push start, update, or end.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  APNS_TOKEN_PREFIX,
  deliverApns,
  Http2ApnsSender,
  isHexToken,
  notificationCategory,
  ProviderToken,
  rememberedDevices,
  sendApns,
  type ApnsConfig,
  type ExpoMessage,
  type ExpoTicket,
} from "./apns.js";
import { activityPayload, askOf, decide, lastText, pick, START_TIMEOUT_MS, threadTitle, type LiveThread, type Phase, type ThreadActivityState, type ThreadRecord } from "./live.js";

const messageSchema = z.object({ to: z.string().min(1) }).passthrough();
const batchSchema = z.union([z.array(messageSchema).max(100), messageSchema.transform((message) => [message])]);

type LastDelivery = { at: string; apns: number; expo: number; errors: string[]; categories?: string[] };
const LAST_DELIVERY_KEY = "last-delivery";
/** Option buttons on a question notification; iOS shows about this many before it gets cramped. */
const MAX_CHOICES = 6;
/** The retired one-per-phone status activity; ended once on upgrade. */
const LEGACY_LIVE_KEY = "live";
/** The app's push-to-start token for thread activities. */
const LIVE_START_KEY = "live-start";
const LIVE_THREADS_KEY = "thread-activities";
/** Thread ids whose notifications BB Studio shouldn't get. */
const MUTED_KEY = "muted-threads";
const MAX_MUTED = 500;
/** APNs recipients seen on the relay, with when each was last seen. */
const DEVICES_KEY = "devices";

const hexToken = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine(isHexToken, "Expected a hex APNs token");

export const liveContract = defineRpcContract({
  live_register: {
    experimental_description: "BB Studio reports its Live Activity push tokens and activity lifecycle.",
    input: z.object({
      threadPushToStartToken: hexToken.optional(),
      activityId: z.string().min(1).max(200).optional(),
      activityToken: hexToken.optional(),
      threadId: z.string().regex(/^thr_[A-Za-z0-9]+$/).optional(),
      endedActivityId: z.string().min(1).max(200).optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
  mute_list: {
    experimental_description: "Threads muted in BB Studio.",
    input: z.object({}).optional(),
    output: z.object({ threadIds: z.array(z.string()) }),
  },
  notify: {
    experimental_description: "Another plugin sends a notification to the phones BB Studio has delivered to.",
    input: z.object({
      title: z.string().max(200),
      body: z.string().max(4000),
      kind: z.enum(["turn-finished", "thread-error", "pending-interaction"]),
      threadId: z.string().min(1).nullable(),
      projectId: z.string().min(1),
      path: z.string().max(500).optional(),
      coalesceKey: z.string().max(300).optional(),
    }),
    output: z.object({ ok: z.literal(true), sent: z.number() }),
  },
  mute_set: {
    experimental_description: "BB Studio mutes or unmutes a thread's notifications on this phone.",
    input: z.object({ threadId: z.string().regex(/^thr_[A-Za-z0-9]+$/), muted: z.boolean() }),
    output: z.object({ threadIds: z.array(z.string()) }),
  },
});

/** Coalesces bursts of thread events into one Live Activity push. */
const RECONCILE_DELAY_MS = 1500;
/** Streaming output on a shown thread checks back this often. */
const OUTPUT_DELAY_MS = 10_000;
const RECONCILE_INTERVAL_MS = 2 * 60_000;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    apnsKey: {
      type: "string",
      label: "APNs auth key (.p8 contents)",
      description: "Paste the key; line breaks are optional. Leave empty to use the key file path instead.",
      secret: true,
    },
    apnsKeyPath: {
      type: "string",
      label: "APNs auth key file",
      description: "Path to AuthKey_XXXXXXXXXX.p8, used when the key above is empty. ~ is expanded.",
      default: "",
    },
    apnsKeyId: { type: "string", label: "APNs key ID", default: "" },
    apnsTeamId: { type: "string", label: "Apple team ID", default: "3753DAN98U" },
    bundleId: { type: "string", label: "App bundle ID", default: "nyc.plee.bbgo" },
    apnsEnvironment: {
      type: "select",
      label: "APNs environment",
      description: "auto tries production, then the sandbox for Xcode-installed builds.",
      options: ["auto", "production", "development"],
      default: "auto",
    },
    expoPushUrl: {
      type: "string",
      label: "Expo push URL for non-APNs tokens",
      default: "https://exp.host/--/api/v2/push/send",
    },
  });

  const sender = new Http2ApnsSender();
  bb.onDispose(() => sender.close());

  let tokenCache: { fingerprint: string; token: ProviderToken } | null = null;

  /** Current APNs config, or the reason it is not usable yet. */
  async function apnsConfig(): Promise<{ config: ApnsConfig; token: ProviderToken } | { missing: string }> {
    const values = await settings.get();
    let keyPem = values.apnsKey?.toString().trim() ?? "";
    if (keyPem === "" && values.apnsKeyPath.trim() !== "") {
      try {
        keyPem = await readFile(values.apnsKeyPath.trim().replace(/^~(?=\/)/, homedir()), "utf8");
      } catch {
        return { missing: `APNs key file not readable at ${values.apnsKeyPath}` };
      }
    }
    if (keyPem === "") return { missing: "APNs key is not set" };
    if (values.apnsKeyId.trim() === "") return { missing: "APNs key ID is not set" };
    const config: ApnsConfig = {
      keyPem,
      keyId: values.apnsKeyId.trim(),
      teamId: values.apnsTeamId.trim(),
      bundleId: values.bundleId.trim(),
      environment: values.apnsEnvironment as ApnsConfig["environment"],
    };
    const fingerprint = `${config.keyId}:${config.teamId}:${keyPem.length}:${keyPem.slice(-16)}`;
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
      const response = await fetch((await settings.get()).expoPushUrl, {
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
  async function enrichInteractions(messages: ExpoMessage[]): Promise<void> {
    const lookups = new Map<string, Promise<Record<string, unknown> | null>>();
    const lookup = async (threadId: string) => {
      try {
        const interactions = await bb.sdk.threads.interactions.list({ threadId });
        const pending = interactions.find((interaction) => interaction.status === "pending");
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
    };
    await Promise.all(
      messages.map(async (message) => {
        const threadId = message.data?.threadId;
        if (message.data?.kind !== "pending-interaction" || typeof threadId !== "string") return;
        if (!lookups.has(threadId)) lookups.set(threadId, lookup(threadId));
        const extra = await lookups.get(threadId)!;
        if (extra) message.data = { ...message.data, ...extra };
      }),
    );
  }

  async function deliver(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    const tickets: ExpoTicket[] = new Array(messages.length);
    const expoIndexes: number[] = [];
    const apnsIndexes: number[] = [];
    messages.forEach((message, index) =>
      (message.to.startsWith(APNS_TOKEN_PREFIX) ? apnsIndexes : expoIndexes).push(index),
    );

    // Muted threads are dropped for the app only; other subscribers still get them.
    const muted = new Set((await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? []);
    if (muted.size > 0) {
      for (let position = apnsIndexes.length - 1; position >= 0; position--) {
        const index = apnsIndexes[position]!;
        const threadId = messages[index]!.data?.threadId;
        if (typeof threadId === "string" && muted.has(threadId)) {
          tickets[index] = { status: "ok" };
          apnsIndexes.splice(position, 1);
        }
      }
    }

    if (apnsIndexes.length > 0) {
      await enrichInteractions(apnsIndexes.map((index) => messages[index]!));
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

    await rememberDevices(messages, tickets);
    const errors = tickets.flatMap((ticket) => (ticket.status === "error" ? [ticket.message ?? "unknown"] : []));
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

  async function rememberDevices(messages: ExpoMessage[], tickets: ExpoTicket[]) {
    const devices = (await bb.storage.kv.get<Record<string, number>>(DEVICES_KEY)) ?? {};
    await bb.storage.kv.set(DEVICES_KEY, rememberedDevices(devices, messages, tickets, Date.now()));
  }

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

  // --- Thread Live Activities -----------------------------------------------

  let liveQueue: Promise<void> = Promise.resolve();
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcileAt = Infinity;
  /** Threads with an activity, so output events elsewhere don't wake us. */
  let shown = new Set<string>();

  /** Serializes read-modify-write of the activity records. */
  function withLive(fn: (records: Record<string, ThreadRecord>) => Promise<Record<string, ThreadRecord> | void>): Promise<void> {
    const run = liveQueue.then(async () => {
      const records = (await bb.storage.kv.get<Record<string, ThreadRecord>>(LIVE_THREADS_KEY)) ?? {};
      const next = await fn(records);
      if (next) await bb.storage.kv.set(LIVE_THREADS_KEY, next);
      shown = new Set(Object.keys(next ?? records));
    });
    liveQueue = run.catch((error: unknown) => {
      bb.log.warn(`live activity: ${error instanceof Error ? error.message : String(error)}`);
    });
    return liveQueue;
  }

  async function stateFor(thread: LiveThread, phase: Phase, now: number): Promise<ThreadActivityState> {
    const [output, interactions] = await Promise.all([
      bb.sdk.threads.output({ threadId: thread.id }).catch(() => null),
      phase === "needsYou" ? bb.sdk.threads.interactions.list({ threadId: thread.id }).catch(() => []) : [],
    ]);
    const pending = interactions.find((interaction) => interaction.status === "pending");
    return {
      title: threadTitle(thread),
      phase,
      last: lastText(output?.output),
      ask: pending ? askOf(pending) : null,
      updatedAt: Math.floor(now / 1000),
    };
  }

  /** Ends the status activity earlier versions showed, once. */
  async function retireStatusActivity(apns: { config: ApnsConfig; token: ProviderToken }) {
    const legacy = await bb.storage.kv.get<{ activity: { token: string } | null }>(LEGACY_LIVE_KEY);
    if (!legacy) return;
    if (legacy.activity) {
      const payload = JSON.stringify({ aps: { timestamp: Math.floor(Date.now() / 1000), event: "end", "dismissal-date": 0, "content-state": {} } });
      await sendApns({ deviceToken: legacy.activity.token, payload, pushType: "liveactivity", priority: 10 }, apns.config, apns.token, sender.send);
    }
    await bb.storage.kv.delete(LEGACY_LIVE_KEY);
    await bb.storage.kv.delete("live-threads");
  }

  function reconcile(): Promise<void> {
    return withLive(async (records) => {
      const apns = await apnsConfig();
      if ("missing" in apns) return;
      await retireStatusActivity(apns);
      const startToken = await bb.storage.kv.get<string>(LIVE_START_KEY);
      if (!startToken && !Object.keys(records).length) return;
      const now = Date.now();
      const muted = new Set((await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? []);
      const threads = await bb.sdk.threads.list({ archived: false, hasParent: false, limit: 200 });
      const showing = new Set(Object.keys(records).filter((id) => records[id]!.activity || records[id]!.startRequestedAt));
      const picked = new Map(pick(threads, showing, muted, now).map((entry) => [entry.thread.id, entry]));
      const push = (deviceToken: string, payload: { payload: string; priority: 5 | 10 }) =>
        sendApns({ deviceToken, ...payload, pushType: "liveactivity" }, apns.config, apns.token, sender.send);
      const next: Record<string, ThreadRecord> = {};
      let later = Infinity;
      for (const threadId of new Set([...Object.keys(records), ...picked.keys()])) {
        const record = records[threadId];
        const entry = picked.get(threadId);
        const state = entry ? await stateFor(entry.thread, entry.phase, now) : null;
        const action = decide(record, state, now, Boolean(startToken));
        switch (action.kind) {
          case "none": {
            // Keep a record while it's shown, starting, or dismissed for the current phase.
            const starting = record?.startRequestedAt != null && now - record.startRequestedAt < START_TIMEOUT_MS;
            if (record && (record.activity || starting || record.dismissed === state?.phase)) next[threadId] = record;
            break;
          }
          case "later":
            next[threadId] = record!;
            later = Math.min(later, action.ms);
            break;
          case "end": {
            const result = await push(record!.activity!.token, activityPayload(action, threadId, record!.state, now));
            if (result.status !== 200) bb.log.warn(`live activity end failed: ${result.reason ?? result.status}`);
            break;
          }
          case "update": {
            const result = await push(record!.activity!.token, activityPayload(action, threadId, state!, now));
            if (result.status === 200) next[threadId] = { ...record!, state, pushedAt: now };
            // A dead token means the activity is gone; start fresh next time.
            else if (result.status !== 400 && result.status !== 410) next[threadId] = record!;
            if (result.status !== 200) bb.log.warn(`live activity update failed: ${result.reason ?? result.status}`);
            break;
          }
          case "restart":
          case "start": {
            if (action.kind === "restart") await push(record!.activity!.token, activityPayload({ kind: "end" }, threadId, state!, now));
            const result = await push(startToken!, activityPayload({ kind: "start", alert: action.alert }, threadId, state!, now));
            if (result.status === 200) next[threadId] = { activity: null, startRequestedAt: now, state, pushedAt: now };
            else bb.log.warn(`live activity start failed: ${result.reason ?? result.status}`);
            break;
          }
        }
      }
      if (later !== Infinity) scheduleReconcile(later);
      return next;
    });
  }

  function scheduleReconcile(delay = RECONCILE_DELAY_MS) {
    const at = Date.now() + delay;
    if (reconcileTimer && reconcileAt <= at) return;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileAt = at;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      void reconcile();
    }, delay);
  }

  bb.events.on("thread.active", () => scheduleReconcile());
  bb.events.on("thread.idle", () => scheduleReconcile());
  bb.events.on("thread.failed", () => scheduleReconcile());
  bb.events.on("interaction.pending", () => scheduleReconcile());
  bb.events.on("thread.archived", () => scheduleReconcile());
  bb.events.on("thread.deleted", () => scheduleReconcile());
  bb.events.on("experimental_thread.events", ({ thread }) => {
    if (shown.has(thread.id)) scheduleReconcile(OUTPUT_DELAY_MS);
  });

  // Answering an interaction or reading a thread has no event; poll to catch it.
  const interval = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
  bb.onDispose(() => {
    clearInterval(interval);
    if (reconcileTimer) clearTimeout(reconcileTimer);
  });

  bb.rpc.register(liveContract, {
    async live_register(input) {
      if (input.threadPushToStartToken) await bb.storage.kv.set(LIVE_START_KEY, input.threadPushToStartToken);
      const { threadId } = input;
      if (threadId) {
        await withLive(async (records) => {
          const record = records[threadId];
          if (input.activityId && input.activityToken) {
            const same = record?.activity?.id === input.activityId;
            records[threadId] = {
              state: record?.state ?? null,
              pushedAt: record?.pushedAt ?? 0,
              activity: { id: input.activityId, token: input.activityToken, startedAt: same ? record!.activity!.startedAt : Date.now() },
              startRequestedAt: null,
              dismissed: null,
            };
          }
          // Swiped away: keep it away until the thread moves on.
          if (input.endedActivityId && record?.activity?.id === input.endedActivityId) {
            records[threadId] = { ...record, activity: null, dismissed: record.state?.phase ?? null };
          }
          return records;
        });
      }
      scheduleReconcile();
      return { ok: true as const };
    },
    async notify(input) {
      const devices = Object.keys((await bb.storage.kv.get<Record<string, number>>(DEVICES_KEY)) ?? {});
      // Without a thread there is nothing to reply to, so leave out the kind that adds a reply box.
      const data = input.threadId
        ? { kind: input.kind, threadId: input.threadId, projectId: input.projectId, ...(input.path ? { path: input.path } : {}) }
        : { projectId: input.projectId, ...(input.path ? { path: input.path } : {}) };
      if (devices.length > 0) {
        await deliver(devices.map((to) => ({ to, title: input.title, body: input.body, sound: "default", data })));
      }
      return { ok: true as const, sent: devices.length };
    },
    async mute_list() {
      return { threadIds: (await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? [] };
    },
    async mute_set(input) {
      const current = (await bb.storage.kv.get<string[]>(MUTED_KEY)) ?? [];
      const rest = current.filter((id) => id !== input.threadId);
      const threadIds = input.muted ? [...rest, input.threadId].slice(-MAX_MUTED) : rest;
      await bb.storage.kv.set(MUTED_KEY, threadIds);
      return { threadIds };
    },
  });

  bb.cli.register({
    name: "mobile",
    summary: "BB Studio push relay status",
    commands: [{ name: "status", summary: "Show APNs setup and the last delivery", usage: "bb mobile status [--json]" }],
    async run(argv) {
      const [command] = argv.filter((arg) => arg !== "--json");
      if (command !== undefined && command !== "status") {
        return { exitCode: 1, stderr: "Usage: bb mobile status [--json]" };
      }
      const apns = await apnsConfig();
      const last = await bb.storage.kv.get<LastDelivery>(LAST_DELIVERY_KEY);
      const canStart = Boolean(await bb.storage.kv.get<string>(LIVE_START_KEY));
      const records = Object.values((await bb.storage.kv.get<Record<string, ThreadRecord>>(LIVE_THREADS_KEY)) ?? {});
      const status = {
        apnsReady: !("missing" in apns),
        apnsProblem: "missing" in apns ? apns.missing : null,
        environment: "missing" in apns ? null : apns.config.environment,
        relayPath: "/api/v1/plugins/mobile/http/push?token=<bb plugin token mobile>",
        lastDelivery: last ?? null,
        liveActivities: {
          canStart,
          threads: records.flatMap((record) => (record.activity && record.state ? [{ title: record.state.title, phase: record.state.phase }] : [])),
        },
      };
      if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(status) };
      return {
        exitCode: 0,
        stdout: [
          `APNs: ${status.apnsReady ? `ready (${status.environment})` : `not ready: ${status.apnsProblem}`}`,
          `Relay: ${status.relayPath}`,
          last
            ? `Last delivery ${last.at}: ${last.apns} APNs, ${last.expo} Expo${last.categories?.length ? ` (categories: ${last.categories.join(", ")})` : ""}${last.errors.length ? `; errors: ${last.errors.join("; ")}` : ""}`
            : "No deliveries yet.",
          `Live Activities: ${
            status.liveActivities.threads.length
              ? status.liveActivities.threads.map((thread) => `${thread.title} (${thread.phase})`).join(", ")
              : status.liveActivities.canStart
                ? "none showing (app registered)"
                : "app has not registered yet"
          }`,
        ].join("\n"),
      };
    },
  });
}
