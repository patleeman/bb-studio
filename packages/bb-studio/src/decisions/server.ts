import { rpcContract, decisionMethods } from "./contract";
import { decisionsDefaults } from "./settings";
import { setTimeout as sleep } from "node:timers/promises";
import { errorMessage } from "../kit/format";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { personalProjectId } from "../kit/server/index";
import { healthSchemas, pluginSettingsPath, registerHealth, type HealthCheck } from "../kit/health";
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
} from "./server/classifier";
import { defaultFallback, fallbackSchema, type Fallback } from "./contract";
import { jevRoutes } from "./server/jev-providers";
import { askSystemOne } from "./server/system-one";
import { RouteFailed, SmartQueue, describeVerdict, rowText, type DecisionRecord, type ThreadInfo } from "./server/queue";

const recentKey = "decisions:recent-decisions";
const fallbackKey = "decisions:fallback";
/** A fixed, harmless sample for connection checks, so a check never reads a thread. */
const sampleSituation: Situation = {
  title: "Connection check",
  requests: ["Rename the config loader and update its tests."],
  latestOutput: "Renaming the loader now.",
  message: "Stop, keep the old name. Only update the tests.",
};

const recentLimit = 30;
const watchIntervalMs = 1000;
/** The standalone Smart Queue plugin decides the same messages; only one may. */
const standaloneQueueId = "smart-queue";
const standaloneCheckMs = 30_000;
/** A Jev failure this recent still counts against its health. */
const jevFailureWindowMs = 30 * 60_000;

/** `before` runs first on every dispatch; a result from it wins (BB allows one hook per plugin). */
export async function registerDecisions(bb: BbPluginApi, settings: { get(): Promise<Record<string, unknown>> }, before?: (context: { thread: { id: string } }) => Promise<{ action: "reject"; message: string } | null>) {
  const config = async (): Promise<ClassifierSettings & { enabled: boolean }> => ({ ...decisionsDefaults, ...Object.fromEntries(Object.entries(await settings.get()).filter(([key]) => key.startsWith("decisions_")).map(([key, value]) => [key.slice(10), value])) }) as ClassifierSettings & { enabled: boolean };
  const sessions = new Set<string>();
  const lifetime = new AbortController();
  bb.onDispose(async () => {
    lifetime.abort();
    await Promise.all([...sessions].map((threadId) => discardSession(bb, threadId, sessions)));
  });

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
  // The latest Smart Queue Jev outcome, for the health check.
  let jevFailure: { at: number; message: string } | null = null;
  async function tracked<T>(attempt: Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      const verdict = await attempt;
      jevFailure = null;
      return verdict;
    } catch (error) {
      // A decision cancelled because its row was sent or edited says nothing about Jev.
      if (!(error instanceof UnavailableError) && !signal?.aborted) jevFailure = { at: Date.now(), message: errorMessage(error) };
      throw error;
    }
  }
  async function health(): Promise<HealthCheck[]> {
    const { routes, problems } = await jevStatus();
    const current = await fallback();
    const checks: HealthCheck[] = [];
    if (problems.length) {
      checks.push({ id: "jev-settings", status: "degraded", title: "A Jev provider setting is invalid", detail: problems.join(" ") });
    }
    if (!routes.length) {
      checks.push({
        id: "jev-route",
        status: current.mode === "off" ? "broken" : "degraded",
        title: "No Jev provider is set up",
        detail: current.mode === "off"
          ? "The fallback model is off too, so Smart Queue queues every message as a follow-up and other plugins' decisions fail. Add a TypeSafe, Vercel AI Gateway, OpenRouter or OpenCode Zen key."
          : "Every decision goes to the fallback model, which starts a full agent thread and takes seconds instead of milliseconds. Add a TypeSafe, Vercel AI Gateway, OpenRouter or OpenCode Zen key.",
        fix: { label: "Add a key", path: pluginSettingsPath(bb.pluginId) },
      });
    } else if (jevFailure && Date.now() - jevFailure.at < jevFailureWindowMs) {
      checks.push({
        id: "jev-failing",
        status: "degraded",
        title: "Jev is failing",
        detail: `Decisions are falling back to the slower model. Last error: ${jevFailure.message}`,
      });
    }
    if (current.mode === "model") {
      const provider = (await bb.sdk.providers.list()).find((candidate) => candidate.id === current.providerId);
      if (!provider?.available) {
        checks.push({
          id: "fallback-provider",
          status: routes.length ? "degraded" : "broken",
          title: `The fallback model's provider, ${current.providerId}, is unavailable`,
          detail: "Choose another fallback model, or sign in to that provider.",
        });
      }
    }
    return checks.length ? checks : [{ id: "jev-route", status: "ok", title: `Jev answers through ${routes.map((route) => route.name).join(", ")}` }];
  }
  async function checkJev() {
    const started = Date.now();
    try {
      const verdict = await askJev(await config(), sampleSituation, AbortSignal.timeout(20_000));
      jevFailure = null;
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
  bb.rpc.register(decisionMethods, {
    "decisions.systemOne.ask": ({ caller, state, questions }) =>
      answer(caller, "Jev", async () => {
        return tracked(askSystemOne(await config(), { state, questions }, AbortSignal.any([lifetime.signal, AbortSignal.timeout(60_000)])));
      }),
    "decisions.model.ask": ({ caller, requestId, hostId, prompt, providerId, modelSelection }) =>
      answer(caller, "Fallback model", async () => {
        return runModel(
          bb,
          modelSelection ? { mode: "model", ...modelSelection } : await fallback(),
          { projectId: await personalProjectId(bb), hostId, requestId: `${caller} ${requestId}`, defaultProviderId: providerId },
          prompt,
          AbortSignal.any([lifetime.signal, AbortSignal.timeout(60_000)]),
          sessions,
        );
      }),
    "decisions.fallback.get": () => fallback(),
    "decisions.fallback.set": (value) => setFallback(value),
    "decisions.fallback.suggest": () => suggestFallback(),
    "decisions.jev.status": () => jevStatus(),
    "decisions.jev.check": () => checkJev(),
  });
  registerHealth(bb, healthSchemas(z), health);
  bb.rpc.register({ "decisions.studio_health": { input: z.object({}).strict(), output: healthSchemas(z).contract.studio_health.output } }, { "decisions.studio_health": async () => ({ checks: await health() }) });

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

  // Read the standalone queue outside dispatch. The dispatch hook only reads
  // this cached flag; the background watcher refreshes it after startup.
  let standaloneQueue = { on: false, checkedAt: 0 };
  async function refreshStandaloneQueue() {
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
  await refreshStandaloneQueue();
  const queueEnabled = async () => (await config()).enabled && !standaloneQueue.on;

  // One read-modify-write at a time, so concurrent decisions don't drop each other.
  let recording: Promise<unknown> = Promise.resolve();
  async function record(entry: DecisionRecord) {
    const write = recording.then(async () => {
      const recent = (await bb.storage.kv.get<DecisionRecord[]>(recentKey)) ?? [];
      await bb.storage.kv.set(recentKey, [entry, ...recent].slice(0, recentLimit));
    });
    recording = write.catch(() => {});
    await write;
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
          jev: (s) => tracked(askJev(settingsNow, state, s), s),
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
        let restoredId: string | null = null;
        try {
          restoredId = (await bb.sdk.threads.queuedMessages.create(message)).id;
        } catch (restoreError) {
          bb.log.error(
            `Smart Queue lost a message in ${row.threadId}: sending failed (${String(error)}) and re-queueing failed (${String(restoreError)}). Message: ${rowText(row)}`,
          );
        }
        throw new RouteFailed(String(error), restoredId, { cause: error });
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

  bb.experimental_hooks.on("message.dispatch", async (context) => (await before?.(context)) ?? queue.dispatch(context));
  bb.events.on("message.queued", ({ entry }) => queue.queued(entry));
  bb.events.on("message.dispatched", ({ entry }) => queue.gone(entry));
  bb.events.on("message.cancelled", ({ entry }) => queue.gone(entry));
  bb.events.on("thread.idle", ({ thread }) => queue.settled(thread.id));
  bb.events.on("thread.failed", ({ thread }) => queue.settled(thread.id));
  bb.events.on("thread.archived", ({ thread }) => queue.forget(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => queue.forget(thread.id));
  bb.onDispose(() => queue.dispose());

  bb.background.service("decisions-queue-watch", {
    async start(signal) {
      while (!signal.aborted) {
        const listedAt = Date.now();
        try {
          await refreshStandaloneQueue();
          if (await queueEnabled()) queue.sync(await bb.sdk.threads.queue.list({ signal }), listedAt);
        } catch (error) {
          if (!signal.aborted) bb.log.warn(`Studio Decisions could not read queued messages: ${String(error)}`);
        }
        await sleep(watchIntervalMs, undefined, { signal }).catch(() => {});
      }
    },
  });

  bb.background.service("decisions-recovery", {
    async start(signal) {
      // Remove model sessions a previous load left behind. List every page
      // first: deleting while paging by offset would skip threads.
      if (signal.aborted) return;
      const stale: string[] = [];
      for (const owner of ["studio"]) {
        for (let offset = 0, page = 0; page < 100; offset += 100, page++) {
          const threads = await bb.sdk.threads.list({
            originPluginId: owner,
            includeHidden: true,
            limit: 100,
            offset,
          });
          for (const thread of threads)
            if (thread.visibility === "hidden" && thread.title?.startsWith(sessionTitlePrefix) && !sessions.has(thread.id)) stale.push(thread.id);
          if (threads.length < 100) break;
        }
      }
      for (const threadId of stale) await discardSession(bb, threadId, new Set());
      // Rows this plugin held before a reload lost their decisions: release or re-hold them.
      await bb.experimental_hooks.recheck("message.dispatch");
    },
  });

  const usage = [
    "Usage:",
    "  bb studio decisions status [--json]",
    "  bb studio decisions recent [--limit <n>] [--json]",
    "  bb studio decisions classify <thread-id> <message> [--json]",
    "  bb studio decisions check [--json]",
    "  bb studio decisions fallback [thread | off | <provider-id> <model> [<reasoning-level>]] [--json]",
  ].join("\n");
  const cli = async (argv: string[]) => {
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
          const standalone = standaloneQueue.on;
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
            AbortSignal.any([lifetime.signal, AbortSignal.timeout(60_000)]),
          );
          return reply(
            verdict,
            [`${verdict.action} (${describeVerdict(verdict)})`, verdict.note].filter(Boolean).join("\n"),
          );
        }
      }
      return { exitCode: 1, stderr: usage };
  };
  bb.rpc.register({ "decisions.cli": rpcContract["decisions.cli"] }, { "decisions.cli": ({ argv }) => cli(argv) });
  return { cli };
}
