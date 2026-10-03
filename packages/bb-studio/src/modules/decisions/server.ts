import { errorMessage } from "@bb-studio/kit/format";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { personalProjectId } from "@bb-studio/kit/server";
import { z } from "zod";
import {
  askBatch,
  askJev,
  askModel,
  classify,
  discardSession,
  runModel,
  sessionTitlePrefix,
  UnavailableError,
  type ClassifierSettings,
  type ModelTarget,
  type Situation,
} from "./classifier";
import { defaultFallback, fallbackSchema, rpcContract, type Fallback } from "./contract";
import { jevProviderChoices, jevRoutes } from "./jev-providers";
import { askSystemOne } from "./system-one";
import { SmartQueue, describeVerdict, rowText, type DecisionRecord, type ThreadInfo } from "./queue";

const recentKey = "recent-decisions";
const fallbackKey = "fallback";
/** A fixed, harmless sample for connection checks, so a check never reads a thread. */
const sampleSituation: Situation = {
  title: "Connection check",
  requests: ["Rename the config loader and update its tests."],
  latestOutput: "Renaming the loader now.",
  message: "Stop, keep the old name. Only update the tests.",
};
export const typesafeModels = ["jev-latest", "jev-preview", "jev-1.13.0"];
const recentLimit = 30;
const watchIntervalMs = 1000;
/** The standalone Smart Queue plugin decides the same messages; only one may. */
const standaloneQueueId = "smart-queue";
const standaloneCheckMs = 30_000;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Smart Queue",
      default: true,
      description:
        "Hold a message you send while a thread is working, then steer the current turn or queue it as a follow-up. Pauses while the standalone Smart Queue plugin is on.",
    },
    jevProvider: {
      type: "select",
      label: "Jev provider",
      options: [...jevProviderChoices],
      default: "auto",
      description:
        "Where Studio Decisions calls Jev, for Smart Queue and for plugins such as Studio Teams. Auto tries TypeSafe, Vercel AI Gateway, OpenRouter, OpenCode Zen, then Custom, using each one that has a key, and moves on when one fails.",
    },
    typesafeApiKey: {
      type: "string",
      label: "TypeSafe API key",
      secret: true,
      description:
        "TypeSafe serves Jev directly. Create a key at https://console.typesafe.ai/keys. Falls back to the server's TYPESAFE_API_KEY environment variable.",
    },
    typesafeModel: {
      type: "select",
      label: "TypeSafe model",
      options: typesafeModels,
      default: "jev-latest",
      description: "jev-latest follows each stable release, jev-preview tries previews, and jev-1.13.0 pins that version.",
    },
    vercelApiKey: {
      type: "string",
      label: "Vercel AI Gateway API key",
      secret: true,
      description: "Calls Jev through Vercel AI Gateway. Falls back to AI_GATEWAY_API_KEY.",
    },
    openRouterApiKey: {
      type: "string",
      label: "OpenRouter API key",
      secret: true,
      description: "Calls Jev through OpenRouter. Falls back to OPENROUTER_API_KEY.",
    },
    zenApiKey: {
      type: "string",
      label: "OpenCode Zen API key",
      secret: true,
      description: "Calls Jev through OpenCode Zen. Falls back to OPENCODE_API_KEY.",
    },
    customJevEndpoint: {
      type: "string",
      label: "Custom Jev endpoint",
      description:
        "Bring your own provider: the full URL of any endpoint that speaks TypeSafe's System One API, such as https://gateway.example.com/v1/systemone. HTTPS is required except on localhost.",
    },
    customJevApiKey: {
      type: "string",
      label: "Custom Jev API key",
      secret: true,
      description: "Sent as a bearer token to the custom endpoint. Leave empty if it needs none.",
    },
    customJevApiKeyCommand: {
      type: "string",
      label: "Custom Jev key command",
      description:
        "For short-lived tokens: a shell command, run on the BB server, that prints the bearer token. The token is reused until its JWT expiry, or for five minutes. Use this instead of the API key.",
    },
    customJevHeaders: {
      type: "string",
      label: "Custom Jev headers",
      description: "Extra request headers as `name: value` pairs separated by semicolons, such as `source: bb; org-id: 2`.",
    },
    customJevModel: {
      type: "string",
      label: "Custom Jev model",
      description: "The model name the custom endpoint expects, such as jev-latest.",
    },
    jevTimeoutMs: {
      type: "number",
      label: "Jev timeout (milliseconds)",
      default: 5000,
      experimental_schema: z.number().int().min(250).max(15000),
      description: "Direct request deadline, from 250 to 15000 milliseconds.",
    },
    steerConfidence: {
      type: "number",
      label: "Smart Queue: minimum confidence to steer",
      default: 0.7,
      experimental_schema: z.number().min(0).max(1),
      description: "A value from 0 to 1. An uncertain steer becomes a follow-up. Other plugins apply their own thresholds.",
    },
    batchConfidence: {
      type: "number",
      label: "Smart Queue: minimum confidence to batch",
      default: 0.5,
      experimental_schema: z.number().min(0).max(1),
      description:
        "A value from 0 to 1. When a thread frees up, queued follow-ups Jev is this sure belong with the next one are sent with it as one turn. Set to 1 to send each on its own.",
    },
  });
  const config = async (): Promise<ClassifierSettings & { enabled: boolean }> => settings.get();
  const sessions = new Set<string>();

  // The fallback model lives in plugin storage, not declarative settings, so
  // the settings page can edit it with BB's own provider and model picker.
  async function fallback(): Promise<Fallback> {
    const parsed = fallbackSchema.safeParse(await bb.storage.kv.get(fallbackKey));
    return parsed.success ? parsed.data : defaultFallback;
  }
  async function setFallback(value: Fallback) {
    const parsed = fallbackSchema.parse(value);
    await bb.storage.kv.set(fallbackKey, parsed);
    return parsed;
  }
  const describeFallback = (value: Fallback) =>
    value.mode === "off"
      ? "off"
      : value.mode === "thread"
        ? "the caller's provider and default model"
        : `${value.providerId}/${value.model}${value.reasoningLevel ? ` (${value.reasoningLevel})` : ""}`;

  async function jevStatus() {
    const current = await config();
    const { routes, problems } = jevRoutes(current);
    // Names and models only; keys never leave the server.
    return {
      provider: current.jevProvider ?? "auto",
      routes: routes.map(({ name, model }) => ({ name, model })),
      problems,
    };
  }
  async function checkJev() {
    const started = Date.now();
    try {
      const verdict = await askJev(await config(), sampleSituation, AbortSignal.timeout(20_000));
      return {
        ok: true as const,
        via: verdict.via ?? "Jev",
        action: verdict.action,
        confidence: verdict.confidence ?? 0,
        ms: Date.now() - started,
      };
    } catch (error) {
      return { ok: false as const, error: errorMessage(error) };
    }
  }
  async function suggestFallback() {
    for (const provider of (await bb.sdk.providers.list()).filter((candidate) => candidate.available)) {
      const options = await bb.sdk.providers.models({ providerId: provider.id }).catch(() => null);
      const model = options?.models.find((candidate) => candidate.isDefault) ?? options?.models[0];
      if (!model) continue;
      const efforts = model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort);
      return {
        mode: "model" as const,
        providerId: provider.id,
        model: model.model,
        reasoningLevel: efforts.includes("none") ? ("none" as const) : efforts.includes("low") ? ("low" as const) : model.defaultReasoningEffort,
      };
    }
    return null;
  }
  /** A result other plugins can read without depending on error classes crossing the RPC boundary. */
  async function answer<T>(caller: string, what: string, run: () => Promise<T>) {
    const started = Date.now();
    try {
      return { ok: true as const, ...(await run()), ms: Date.now() - started };
    } catch (error) {
      const unavailable = error instanceof UnavailableError;
      const message = errorMessage(error);
      if (!unavailable) bb.log.warn(`${what} for ${caller} failed: ${message}`);
      return { ok: false as const, unavailable, error: message };
    }
  }
  bb.rpc.register(rpcContract, {
    "systemOne.ask": ({ caller, state, questions }) =>
      answer(caller, "Jev", async () => askSystemOne(await config(), { state, questions }, AbortSignal.timeout(60_000))),
    "model.ask": ({ caller, requestId, hostId, prompt, providerId, modelSelection }) =>
      answer(caller, "Fallback model", async () =>
        runModel(
          bb,
          modelSelection ? { mode: "model", ...modelSelection } : await fallback(),
          { projectId: await personalProjectId(bb), hostId, requestId: `${caller} ${requestId}`, defaultProviderId: providerId },
          prompt,
          AbortSignal.timeout(60_000),
          sessions,
        ),
      ),
    "fallback.get": () => fallback(),
    "fallback.set": (value) => setFallback(value),
    "fallback.suggest": () => suggestFallback(),
    "jev.status": () => jevStatus(),
    "jev.check": () => checkJev(),
  });

  async function situation(threadId: string, message: string, thread: ThreadInfo): Promise<Situation> {
    const [history, output] = await Promise.all([
      bb.sdk.threads.promptHistory({ threadId, limit: "3" }).catch(() => []),
      bb.sdk.threads.output({ threadId }).catch(() => ({ output: null })),
    ]);
    return {
      title: thread.title ?? thread.titleFallback,
      requests: [...history]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((prompt) => rowText({ content: prompt.input }))
        .filter(Boolean),
      latestOutput: output.output,
      message,
    };
  }

  /** Classifier sessions run on the thread's machine, in BB's Personal project, away from the user's projects. */
  async function modelTarget(thread: ThreadInfo, queuedMessageId: string): Promise<ModelTarget> {
    if (!thread.environmentId) throw new Error("The thread has no environment to run the fallback model on.");
    const [environment, projectId] = await Promise.all([
      bb.sdk.environments.get({ environmentId: thread.environmentId }),
      personalProjectId(bb),
    ]);
    return { projectId, hostId: environment.hostId, requestId: queuedMessageId, defaultProviderId: thread.providerId };
  }

  // Cached, so the dispatch hook never waits on the plugin list.
  let standaloneQueue = { on: false, checkedAt: 0 };
  async function standaloneQueueOn() {
    if (Date.now() - standaloneQueue.checkedAt < standaloneCheckMs) return standaloneQueue.on;
    try {
      const { plugins } = await bb.sdk.plugins.list();
      standaloneQueue = { on: plugins.some((plugin) => plugin.id === standaloneQueueId && plugin.enabled), checkedAt: Date.now() };
    } catch (error) {
      bb.log.warn(`Studio Decisions could not check for the Smart Queue plugin: ${String(error)}`);
      standaloneQueue = { ...standaloneQueue, checkedAt: Date.now() };
    }
    return standaloneQueue.on;
  }
  const queueEnabled = async () => (await config()).enabled && !(await standaloneQueueOn());

  async function record(entry: DecisionRecord) {
    const recent = (await bb.storage.kv.get<DecisionRecord[]>(recentKey)) ?? [];
    await bb.storage.kv.set(recentKey, [entry, ...recent].slice(0, recentLimit));
    bb.log.info(
      `Smart Queue chose ${entry.verdict.action} for ${entry.queuedMessageId} in ${entry.threadId} (${describeVerdict(entry.verdict)}).`,
    );
  }

  const queue = new SmartQueue({
    pluginId: bb.pluginId,
    enabled: queueEnabled,
    thread: (threadId) => bb.sdk.threads.get({ threadId }),
    classify: async (row, thread, signal) => {
      const settingsNow = await config();
      const state = await situation(row.threadId, rowText(row), thread);
      return classify(
        {
          jev: (s) => askJev(settingsNow, state, s),
          model: async (s) =>
            askModel(
              bb,
              await fallback(),
              await modelTarget(thread, row.id),
              state,
              s,
              sessions,
            ),
          warn: (message) => bb.log.warn(message),
        },
        signal,
      );
    },
    steer: async (row) => {
      await bb.sdk.threads.queuedMessages.send({ threadId: row.threadId, queuedMessageId: row.id, mode: "steer" });
    },
    route: async (row) => {
      const message = {
        threadId: row.threadId,
        input: row.content,
        ...(row.model ? { model: row.model } : {}),
        ...(row.reasoningLevel ? { reasoningLevel: row.reasoningLevel } : {}),
        ...(row.permissionMode ? { permissionMode: row.permissionMode } : {}),
        serviceTier: row.serviceTier,
      };
      // Deleting first means a row core already claimed is never sent twice.
      await bb.sdk.threads.queuedMessages.delete({ threadId: row.threadId, queuedMessageId: row.id });
      try {
        // Sent the way the composer steers, so the dispatch hook sees it.
        await bb.sdk.threads.send({ ...message, mode: "steer-if-active" });
      } catch (error) {
        await bb.sdk.threads.queuedMessages.create(message);
        throw error;
      }
    },
    list: (threadId) => bb.sdk.threads.queuedMessages.list({ threadId }),
    batch: async (head, candidates, thread, signal) => {
      const settingsNow = await config();
      if ((settingsNow.batchConfidence ?? 0.5) >= 1) return [];
      const { ids, via } = await askBatch(
        settingsNow,
        {
          title: thread.title ?? thread.titleFallback,
          next: rowText(head),
          messages: candidates.map((row) => ({ id: row.id, text: rowText(row) })),
        },
        signal,
      );
      bb.log.info(`Smart Queue grouped ${ids.length} of ${candidates.length} follow-ups with ${head.id} in ${head.threadId} (Jev via ${via}).`);
      return ids;
    },
    group: async (threadId, ids) => {
      let rows = await bb.sdk.threads.queuedMessages.list({ threadId });
      for (const [index, id] of ids.entries()) {
        if (index === 0) continue;
        const previous = rows.findIndex((row) => row.id === ids[index - 1]);
        if (rows[previous + 1]?.id === id) continue;
        const next = rows[previous + 1]?.id ?? null;
        rows = await bb.sdk.threads.queuedMessages.reorder({
          threadId,
          queuedMessageId: id,
          previousQueuedMessageId: ids[index - 1]!,
          nextQueuedMessageId: next,
        });
      }
      await bb.sdk.threads.queuedMessages.setGroupBoundary({
        threadId,
        groupBoundaryQueuedMessageId: ids.at(-1)!,
        expectedGroupedPrefixQueuedMessageIds: ids,
      });
    },
    recheck: () => bb.experimental_hooks.recheck("message.dispatch"),
    record,
    warn: (message) => bb.log.warn(message),
  });

  bb.experimental_hooks.on("message.dispatch", (context) => queue.dispatch(context));
  bb.events.on("message.queued", ({ entry }) => queue.queued(entry));
  bb.events.on("message.dispatched", ({ entry }) => queue.gone(entry));
  bb.events.on("message.cancelled", ({ entry }) => queue.gone(entry));
  bb.events.on("thread.idle", ({ thread }) => queue.settled(thread.id));
  bb.events.on("thread.failed", ({ thread }) => queue.settled(thread.id));
  bb.events.on("thread.archived", ({ thread }) => queue.forget(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => queue.forget(thread.id));
  bb.onDispose(() => queue.dispose());

  bb.background.service("queue-watch", {
    async start(signal) {
      while (!signal.aborted) {
        const listedAt = Date.now();
        try {
          if (await queueEnabled()) queue.sync(await bb.sdk.threads.queue.list({ signal }), listedAt);
        } catch (error) {
          if (!signal.aborted) bb.log.warn(`Studio Decisions could not read queued messages: ${String(error)}`);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, watchIntervalMs);
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
      }
    },
  });

  bb.background.service("recovery", {
    async start() {
      // Remove model sessions a previous load left behind.
      for (let offset = 0; ; offset += 100) {
        const threads = await bb.sdk.threads.list({
          originPluginId: bb.pluginId,
          includeHidden: true,
          limit: 100,
          offset,
        });
        for (const thread of threads)
          if (thread.title?.startsWith(sessionTitlePrefix) && !sessions.has(thread.id))
            await discardSession(bb, thread.id, new Set());
        if (threads.length < 100) break;
      }
      // Rows this plugin held before a reload lost their decisions: release or re-hold them.
      await bb.experimental_hooks.recheck("message.dispatch");
    },
  });

  const usage = [
    "Usage:",
    "  bb studio smart-decisions status [--json]",
    "  bb studio smart-decisions recent [--limit <n>] [--json]",
    "  bb studio smart-decisions classify <thread-id> <message> [--json]",
    "  bb studio smart-decisions check [--json]",
    "  bb studio smart-decisions fallback [thread | off | <provider-id> <model> [<reasoning-level>]] [--json]",
  ].join("\n");
  bb.cli.register({
    name: "smart-decisions",
    summary: "Inspect Studio Decisions' Jev providers, fallback model, and Smart Queue decisions",
    commands: [
      { name: "status", summary: "Show the Jev providers, the fallback model, and whether Smart Queue is on", usage: "bb studio smart-decisions status [--json]" },
      {
        name: "recent",
        summary: "List recent Smart Queue steer and follow-up decisions",
        usage: "bb studio smart-decisions recent [--limit <n>] [--json]",
      },
      {
        name: "classify",
        summary: "Dry-run Smart Queue for a message to a thread without sending it",
        usage: "bb studio smart-decisions classify <thread-id> <message> [--json]",
      },
      {
        name: "check",
        summary: "Test the Jev connection with a fixed sample message",
        usage: "bb studio smart-decisions check [--json]",
      },
      {
        name: "fallback",
        summary: "Show or set the model used when no Jev provider answers",
        usage: "bb studio smart-decisions fallback [thread | off | <provider-id> <model> [<reasoning-level>]] [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const [command, ...rest] = args;
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value) : text,
      });
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "status": {
          const current = await config();
          const jev = await jevStatus();
          const fallbackNow = await fallback();
          const standalone = await standaloneQueueOn();
          const status = {
            enabled: current.enabled,
            pausedForSmartQueuePlugin: current.enabled && standalone,
            jevProvider: jev.provider,
            jev: jev.routes,
            problems: jev.problems,
            fallback: fallbackNow,
            holding: [...queue.entries.values()].filter((entry) => entry.state === "pending").length,
          };
          return reply(
            status,
            [
              `Smart Queue: ${!status.enabled ? "off" : status.pausedForSmartQueuePlugin ? "paused while the Smart Queue plugin is on" : "on"}`,
              `Jev provider: ${status.jevProvider}`,
              status.jev.length
                ? `Jev routes: ${status.jev.map((route) => `${route.name} (${route.model})`).join(" → ")}`
                : "Jev routes: none (add a TypeSafe key, another provider key, or a custom endpoint)",
              ...status.problems.map((problem) => `Problem: ${problem}`),
              `Fallback model: ${describeFallback(fallbackNow)}`,
              `Deciding now: ${status.holding}`,
            ].join("\n"),
          );
        }
        case "check": {
          const result = await checkJev();
          return result.ok
            ? reply(result, `Jev answered through ${result.via} in ${result.ms} ms (${result.action}, ${Math.round(result.confidence * 100)}%).`)
            : { exitCode: 1, stdout: json ? JSON.stringify(result) : "", stderr: json ? "" : `Jev check failed: ${result.error}` };
        }
        case "fallback": {
          const [mode, model, reasoningLevel] = rest;
          if (mode === undefined) {
            const current = await fallback();
            return reply(current, `Fallback model: ${describeFallback(current)}`);
          }
          let next: Fallback;
          if (mode === "thread" || mode === "off") {
            if (model !== undefined) break;
            next = { mode };
          } else {
            if (!model) break;
            const providers = await bb.sdk.providers.list();
            if (!providers.some((provider) => provider.id === mode))
              return { exitCode: 1, stderr: `Unknown provider ${mode}. Known: ${providers.map((provider) => provider.id).join(", ")}.` };
            const parsed = fallbackSchema.safeParse({ mode: "model", providerId: mode, model, reasoningLevel: reasoningLevel ?? null });
            if (!parsed.success) return { exitCode: 1, stderr: parsed.error.issues[0]?.message ?? "Invalid fallback." };
            next = parsed.data;
          }
          const saved = await setFallback(next);
          return reply(saved, `Fallback model: ${describeFallback(saved)}`);
        }
        case "recent": {
          const limitIndex = rest.indexOf("--limit");
          const limit = z.coerce
            .number()
            .int()
            .min(1)
            .max(recentLimit)
            .catch(10)
            .parse(limitIndex >= 0 ? rest[limitIndex + 1] : 10);
          const recent = ((await bb.storage.kv.get<DecisionRecord[]>(recentKey)) ?? []).slice(0, limit);
          return reply(
            recent,
            recent.length
              ? recent
                  .map(
                    (entry) =>
                      `${new Date(entry.at).toISOString()}  ${entry.verdict.action.padEnd(8)}  ${describeVerdict(entry.verdict)}  ${entry.threadId}  ${entry.preview}`,
                  )
                  .join("\n")
              : "No decisions yet.",
          );
        }
        case "classify": {
          const [threadId, ...words] = rest;
          const message = words.join(" ").trim();
          if (!threadId || !message) break;
          const thread = await bb.sdk.threads.get({ threadId });
          const settingsNow = await config();
          const state = await situation(threadId, message.slice(0, 16000), thread);
          const verdict = await classify(
            {
              jev: (s) => askJev(settingsNow, state, s),
              model: async (s) =>
                askModel(
                  bb,
                  await fallback(),
                  await modelTarget(thread, "dry-run"),
                  state,
                  s,
                  sessions,
                ),
              warn: (text) => bb.log.warn(text),
            },
            AbortSignal.timeout(60_000),
          );
          return reply(
            verdict,
            [`${verdict.action} (${describeVerdict(verdict)})`, verdict.note].filter(Boolean).join("\n"),
          );
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}

export async function registerServer(ctx: import("../runtime").ModuleContext) { await plugin(ctx.bb); }
