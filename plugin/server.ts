// bb-plugin-mobile — server side of BB Go, the personal native iOS app.
//
// BB's push-notifications plugin only speaks Expo push. BB Go registers
// `apns:<device token>` subscriptions and points push-notifications'
// `expoPushUrl` at this plugin's /push route, which sends those to APNs and
// forwards every other token to Expo unchanged.
//
// It also drives the app's one status Live Activity (see live.ts): thread
// events recompute "needs you / running" and push start, update, or end.
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
  sendApns,
  type ApnsConfig,
  type ExpoMessage,
  type ExpoTicket,
} from "./apns.js";
import { decide, EMPTY_RECORD, livePayload, summarize, threadTitle, type LiveAction, type LiveRecord } from "./live.js";

const messageSchema = z.object({ to: z.string().min(1) }).passthrough();
const batchSchema = z.union([z.array(messageSchema).max(100), messageSchema.transform((message) => [message])]);

type LastDelivery = { at: string; apns: number; expo: number; errors: string[]; categories?: string[] };
const LAST_DELIVERY_KEY = "last-delivery";
/** Option buttons on a question notification; iOS shows about this many before it gets cramped. */
const MAX_CHOICES = 6;
const LIVE_KEY = "live";

const hexToken = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine(isHexToken, "Expected a hex APNs token");

const liveContract = defineRpcContract({
  live_register: {
    experimental_description: "BB Go reports its Live Activity push tokens and activity lifecycle.",
    input: z.object({
      pushToStartToken: hexToken.optional(),
      activityId: z.string().min(1).max(200).optional(),
      activityToken: hexToken.optional(),
      endedActivityId: z.string().min(1).max(200).optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
});

/** Coalesces bursts of thread events into one Live Activity push. */
const RECONCILE_DELAY_MS = 1500;
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

  // --- Status Live Activity -------------------------------------------------

  let liveQueue: Promise<void> = Promise.resolve();
  let pendingLatest: string | null | undefined;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;

  /** Serializes read-modify-write of the live record. */
  function withLive(fn: (record: LiveRecord) => Promise<LiveRecord | void>): Promise<void> {
    const run = liveQueue.then(async () => {
      const record = (await bb.storage.kv.get<LiveRecord>(LIVE_KEY)) ?? EMPTY_RECORD;
      const next = await fn(record);
      if (next) await bb.storage.kv.set(LIVE_KEY, next);
    });
    liveQueue = run.catch((error: unknown) => {
      bb.log.warn(`live activity: ${error instanceof Error ? error.message : String(error)}`);
    });
    return liveQueue;
  }

  async function pushLive(deviceToken: string, action: Exclude<LiveAction, { kind: "none" | "restart" }>) {
    const apns = await apnsConfig();
    if ("missing" in apns) return { status: 0, reason: apns.missing };
    const { payload, priority } = livePayload(action, Date.now());
    return sendApns({ deviceToken, payload, pushType: "liveactivity", priority }, apns.config, apns.token, sender.send);
  }

  function reconcile(): Promise<void> {
    return withLive(async (record) => {
      if (!record.pushToStartToken && !record.activity) return;
      const now = Date.now();
      const latest = pendingLatest !== undefined ? pendingLatest : (record.state?.latest ?? null);
      pendingLatest = undefined;
      const threads = await bb.sdk.threads.list({ archived: false, hasParent: false, limit: 200 });
      const state = summarize(threads, latest, now);
      const action = decide(record, state, now);
      switch (action.kind) {
        case "none":
          return { ...record, state: record.activity ? record.state : state };
        case "update": {
          const result = await pushLive(record.activity!.token, action);
          if (result.status === 200) return { ...record, state };
          bb.log.warn(`live activity update failed: ${result.reason ?? result.status}`);
          // A dead activity token means the activity is gone; start fresh next time.
          return result.status === 400 || result.status === 410 ? { ...record, activity: null } : record;
        }
        case "end": {
          const result = await pushLive(record.activity!.token, action);
          if (result.status !== 200) bb.log.warn(`live activity end failed: ${result.reason ?? result.status}`);
          return { ...record, activity: null, startRequestedAt: null, state };
        }
        case "restart":
        case "start": {
          if (action.kind === "restart") {
            await pushLive(record.activity!.token, { kind: "end", state: { ...state, latest: null } });
          }
          const result = await pushLive(record.pushToStartToken!, { kind: "start", state, alert: action.alert });
          if (result.status !== 200) {
            bb.log.warn(`live activity start failed: ${result.reason ?? result.status}`);
            return { ...record, activity: null, startRequestedAt: null };
          }
          return { ...record, activity: null, startRequestedAt: now, state };
        }
      }
    });
  }

  function scheduleReconcile(latest?: string) {
    if (latest !== undefined) pendingLatest = latest;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      void reconcile();
    }, RECONCILE_DELAY_MS);
  }

  bb.events.on("thread.active", () => scheduleReconcile());
  bb.events.on("thread.idle", ({ thread }) => {
    if (thread.parentThreadId === null) scheduleReconcile(`✓ ${threadTitle(thread)} finished`);
  });
  bb.events.on("thread.failed", ({ thread }) => {
    if (thread.parentThreadId === null) scheduleReconcile(`✗ ${threadTitle(thread)} failed`);
  });
  bb.events.on("interaction.pending", ({ thread }) => scheduleReconcile(`⚠ ${threadTitle(thread)} needs you`));
  bb.events.on("thread.archived", () => scheduleReconcile());
  bb.events.on("thread.deleted", () => scheduleReconcile());

  // Answering an interaction or reading a failure has no event; poll to catch it.
  const interval = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
  bb.onDispose(() => {
    clearInterval(interval);
    if (reconcileTimer) clearTimeout(reconcileTimer);
  });

  bb.rpc.register(liveContract, {
    async live_register(input) {
      await withLive(async (record) => {
        const next = { ...record };
        if (input.pushToStartToken) next.pushToStartToken = input.pushToStartToken;
        if (input.activityId && input.activityToken) {
          const same = record.activity?.id === input.activityId;
          next.activity = {
            id: input.activityId,
            token: input.activityToken,
            startedAt: same ? record.activity!.startedAt : Date.now(),
          };
          next.startRequestedAt = null;
        }
        if (input.endedActivityId && record.activity?.id === input.endedActivityId) next.activity = null;
        return next;
      });
      scheduleReconcile();
      return { ok: true as const };
    },
  });

  bb.cli.register({
    name: "mobile",
    summary: "BB Go push relay status",
    commands: [{ name: "status", summary: "Show APNs setup and the last delivery", usage: "bb mobile status [--json]" }],
    async run(argv) {
      const [command] = argv.filter((arg) => arg !== "--json");
      if (command !== undefined && command !== "status") {
        return { exitCode: 1, stderr: "Usage: bb mobile status [--json]" };
      }
      const apns = await apnsConfig();
      const last = await bb.storage.kv.get<LastDelivery>(LAST_DELIVERY_KEY);
      const live = await bb.storage.kv.get<LiveRecord>(LIVE_KEY);
      const status = {
        apnsReady: !("missing" in apns),
        apnsProblem: "missing" in apns ? apns.missing : null,
        environment: "missing" in apns ? null : apns.config.environment,
        relayPath: "/api/v1/plugins/mobile/http/push?token=<bb plugin token mobile>",
        lastDelivery: last ?? null,
        liveActivity: {
          canStart: Boolean(live?.pushToStartToken),
          running: Boolean(live?.activity),
          needsYou: live?.state?.needsYou ?? 0,
          threadsRunning: live?.state?.running ?? 0,
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
          `Live Activity: ${
            status.liveActivity.running
              ? `showing ${status.liveActivity.needsYou} needs you, ${status.liveActivity.threadsRunning} running`
              : status.liveActivity.canStart
                ? "idle (app registered)"
                : "app has not registered yet"
          }`,
        ].join("\n"),
      };
    },
  });
}
