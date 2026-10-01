// bb-plugin-mobile — server side of BB Studio, the personal native iOS app.
//
// BB's push-notifications plugin only speaks Expo push. BB Studio registers
// `apns:<device token>` subscriptions and points push-notifications'
// `expoPushUrl` at this plugin's /push route, which sends those to APNs and
// forwards every other token to Expo unchanged.
//
// Plugins without BB's shared notification queue send through `notify`, which
// reaches the devices this relay has delivered to before.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  APNS_TOKEN_PREFIX,
  deliverApns,
  Http2ApnsSender,
  notificationCategory,
  ProviderToken,
  rememberedDevices,
  sendApns,
  type ApnsConfig,
  type ExpoMessage,
  type ExpoTicket,
} from "./apns.js";

const messageSchema = z.object({ to: z.string().min(1) }).passthrough();
const batchSchema = z.union([z.array(messageSchema).max(100), messageSchema.transform((message) => [message])]);

type LastDelivery = { at: string; apns: number; expo: number; errors: string[]; categories?: string[] };
const LAST_DELIVERY_KEY = "last-delivery";
/** Option buttons on a question notification; iOS shows about this many before it gets cramped. */
const MAX_CHOICES = 6;
/** Retired Live Activity state: the per-phone status activity, then per-thread ones. Ended once on upgrade. */
const RETIRED_LIVE_KEYS = ["live", "live-threads", "live-start", "thread-activities"];
/** Thread ids whose notifications BB Studio shouldn't get. */
const MUTED_KEY = "muted-threads";
const MAX_MUTED = 500;
/** APNs recipients seen on the relay, with when each was last seen. */
const DEVICES_KEY = "devices";

export const mobileContract = defineRpcContract({
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
    void retireLiveActivities();
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

  /**
   * Ends the Live Activities earlier versions showed (one per phone, then one
   * per thread) and forgets their tokens. Waits for APNs to be configured.
   */
  let retired = false;
  async function retireLiveActivities() {
    if (retired) return;
    const apns = await apnsConfig();
    if ("missing" in apns) return;
    retired = true;
    try {
      await endRetiredActivities(apns);
    } catch (error) {
      retired = false;
      bb.log.warn(`retiring Live Activities: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function endRetiredActivities(apns: { config: ApnsConfig; token: ProviderToken }) {
    const legacy = await bb.storage.kv.get<{ activity: { token: string } | null }>("live");
    const threads = (await bb.storage.kv.get<Record<string, { activity: { token: string } | null }>>("thread-activities")) ?? {};
    const tokens = [legacy?.activity?.token, ...Object.values(threads).map((record) => record.activity?.token)].filter(
      (token): token is string => Boolean(token),
    );
    const payload = JSON.stringify({ aps: { timestamp: Math.floor(Date.now() / 1000), event: "end", "dismissal-date": 0, "content-state": {} } });
    for (const deviceToken of tokens) {
      const result = await sendApns({ deviceToken, payload, pushType: "liveactivity", priority: 10 }, apns.config, apns.token, sender.send);
      if (result.status !== 200) bb.log.warn(`ending a retired Live Activity failed: ${result.reason ?? result.status}`);
    }
    for (const key of RETIRED_LIVE_KEYS) await bb.storage.kv.delete(key);
  }
  void retireLiveActivities();

  bb.rpc.register(mobileContract, {
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
      const status = {
        apnsReady: !("missing" in apns),
        apnsProblem: "missing" in apns ? apns.missing : null,
        environment: "missing" in apns ? null : apns.config.environment,
        relayPath: "/api/v1/plugins/mobile/http/push?token=<bb plugin token mobile>",
        lastDelivery: last ?? null,
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
        ].join("\n"),
      };
    },
  });
}
