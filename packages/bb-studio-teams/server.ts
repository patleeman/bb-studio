import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./client-contract";
import { profileInput, botSchema, type Bot, type BotCreateRequest, type Conversation } from "./contract";
import { Store, newId, document } from "./store";
import { MIGRATIONS } from "./migrations";
import { Runtime, missingThread } from "./mission-runtime";
import { isExecuting } from "./job-state";
import { broadcastHandles } from "./mentions";
import { ThreadProfiles } from "./thread-profiles";
import { ThreadViews } from "./thread-views";
import { botHandlers } from "./rpc-bots";
import { directThreadIndicator } from "./direct-status";
import { personalProjectId, createStudioNotifier } from "@bb-studio/kit/server";
import { studioSchemas } from "@bb-studio/kit/contract";
import { PLUGIN_ID as STUDIO_PROVIDER_ID, botsSignature, registerStudio } from "./studio-provider";
import { registerViewMentions } from "./view-mentions";
import { registerTeamsCli } from "./teams-cli";
import { migrateViews } from "./view-migration";
export { rpcContract } from "./client-contract";

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new Store(db), runtime = new Runtime(bb, store);
  const profiles = new ThreadProfiles(bb, store, runtime, id => !store.routingSession(id));
  const views = new ThreadViews(bb, store, profiles);
  const project = () => personalProjectId(bb);
  const activeConversations = (id: string) => store.conversations(id).filter(c => c.kind === "mission" && !c.archivedAt);
  const assertConversationIdle = async (c: Conversation) => {
    const t = await bb.sdk.threads.get({ threadId: c.threadId });
    if (["active", "starting", "stopping"].includes(t.status) || (await bb.sdk.threads.queuedMessages.list({ threadId: c.threadId })).length)
      throw new Error("Wait for this bot's work before changing its model.");
  };
  async function create(
    input: z.infer<typeof profileInput> & { mission: string },
    requestId?: string,
  ) {
    return runtime.locked("create", async () => {
      const config = await bb.sdk.system.config();
      if (!config.primaryHostId)
        throw new Error(
          "BB needs a connected primary machine to create bot workspaces.",
        );
      const now = Date.now(),
        id = newId();
      const { mission, ...profile } = input;
      const slug =
        input.name
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "bot";
      const reserved = new Set([
        ...broadcastHandles,
        "user",
        ...store.all().map((b) => b.handle),
      ]);
      const handle = reserved.has(slug) ? `${slug}-${id.slice(-6)}` : slug;
      const bot: Bot = {
        ...profile,
        id,
        handle,
        home: join(store.root, id),
        hostId: config.primaryHostId,
        projectId: "",
        createdAt: now,
        updatedAt: now,
        lastWakeAt: now,
        error: null,
      };
      await store.initialize(bot, mission);
      bot.projectId = await project();
      store.db.transaction(() => {
        store.put(bot);
        if (requestId) {
          const saved = store.markBotCreateRequestCreated(requestId, bot.id);
          if (!saved || saved.status !== "created")
            throw new Error(
              "Bot creation finished without recording its request.",
            );
        }
      })();
      runtime.changed();
      return bot;
    });
  }
  const materializingBotCreates = new Map<string, Promise<Bot | null>>();
  async function materializeBotCreateRequest(
    requestId: string,
  ): Promise<Bot | null> {
    const existing = materializingBotCreates.get(requestId);
    if (existing) return existing;
    const work = (async () => {
      const current = store.botCreateRequest(requestId);
      if (!current) return null;
      if (current.status === "created")
        return current.createdBotId ? store.get(current.createdBotId) : null;
      const claimed = store.claimBotCreateRequest(requestId);
      if (!claimed || claimed.status !== "creating") return null;
      try {
        const bot = await create(claimed.input, requestId);
        runtime.changed();
        return bot;
      } catch (cause) {
        store.resetBotCreateRequest(requestId);
        runtime.changed();
        throw cause;
      }
    })();
    materializingBotCreates.set(requestId, work);
    try {
      return await work;
    } finally {
      if (materializingBotCreates.get(requestId) === work)
        materializingBotCreates.delete(requestId);
    }
  }
  async function recoverApprovedBotCreates(signal?: AbortSignal) {
    for (const request of store.approvedBotCreateRequests()) {
      if (signal?.aborted) return;
      try {
        await materializeBotCreateRequest(request.id);
      } catch (cause) {
        bb.log.warn(
          `Approved bot creation recovery failed for ${request.id}: ${String(cause)}`,
        );
      }
    }
  }
  async function approveBotCreate(
    input: z.output<typeof rpcContract.create.input>,
    threadId: string,
    signal?: AbortSignal,
  ): Promise<{ approved: boolean; bot: Bot | null }> {
    const conversation = store.byThread(threadId);
    const author = { botId: conversation?.botId ?? null, speaker: conversation ? store.get(conversation.botId).name : "BB agent" };
    if (!author.botId) return { approved: true, bot: null };
    const now = Date.now();
    const request: BotCreateRequest = {
      id: randomUUID(),
      requesterBotId: author.botId,
      requesterThreadId: threadId,
      requesterName: author.speaker,
      channelName: null,
      input,
      status: "pending",
      createdAt: now,
      expiresAt: now + 300_000,
      resolvedAt: null,
      createdBotId: null,
    };
    store.putBotCreateRequest(request);
    runtime.changed();
    while (!signal?.aborted && Date.now() < request.expiresAt) {
      const current = store.botCreateRequest(request.id);
      if (!current) return { approved: false, bot: null };
      if (current.status === "created")
        return {
          approved: true,
          bot: current.createdBotId ? store.get(current.createdBotId) : null,
        };
      if (["denied", "expired", "cancelled"].includes(current.status))
        return { approved: false, bot: null };
      const waitMs = Math.min(1000, request.expiresAt - Date.now());
      try {
        if (signal) await delay(waitMs, undefined, { signal });
        else await delay(waitMs);
      } catch (cause) {
        if (!signal?.aborted) throw cause;
        break;
      }
    }
    if (signal?.aborted) {
      const current = store.botCreateRequest(request.id);
      if (current?.status === "pending") {
        store.resolveBotCreateRequest(request.id, "cancelled");
        runtime.changed();
      }
      return { approved: false, bot: null };
    }
    const current = store.botCreateRequest(request.id);
    if (current?.status === "pending") {
      store.resolveBotCreateRequest(request.id, "expired");
      runtime.changed();
    }
    return { approved: false, bot: null };
  }
  const updateBot = (
    id: string,
    expectedUpdatedAt: number | undefined,
    patch: Partial<Bot>,
  ) => runtime.locked(id, () => updateBotUnlocked(id, expectedUpdatedAt, patch));
  const updateBotUnlocked = async (
    id: string,
    expectedUpdatedAt: number | undefined,
    patch: Partial<Bot>,
  ): Promise<Bot> => {
    const previous = botSchema.parse(store.get(id));
    if (
      expectedUpdatedAt !== undefined &&
      expectedUpdatedAt !== previous.updatedAt
    )
      throw new Error(
        "This profile changed elsewhere. Reload the latest profile before saving.",
      );
    const profile = { ...previous, ...patch };
    const bot = {
      ...previous,
      ...profile,
      updatedAt: Math.max(Date.now(), previous.updatedAt + 1),
    };
    const changedModel = bot.providerId !== previous.providerId ||
      bot.model !== previous.model ||
      bot.fallbackProviderId !== previous.fallbackProviderId ||
      bot.fallbackModel !== previous.fallbackModel ||
      bot.fallbackReasoningLevel !== previous.fallbackReasoningLevel;
    if (changedModel) {
      if (store.work(id).some(isExecuting))
        throw new Error("Wait for this bot's current work before changing its provider or model.");
      const conversations = activeConversations(id);
      for (const conversation of conversations)
        await assertConversationIdle(conversation);
      const present = conversations.filter((c) => !!store.byThread(c.threadId));
      store.db.transaction(() => {
        for (const conversation of present) store.archiveConversation(conversation);
        store.put(bot);
      })();
    } else {
      if (bot.reasoningLevel !== previous.reasoningLevel)
        for (const c of activeConversations(id)) {
          try {
            await bb.sdk.threads.update({
              threadId: c.threadId,
              reasoningLevel: bot.reasoningLevel,
            });
          } catch (cause) {
            if (!missingThread(cause)) throw cause;
            store.deleteConversation(c.threadId);
          }
        }
      store.put(bot);
    }
    runtime.changed();
    return bot;
  };
  const handlers: PluginRpcHandlers<typeof rpcContract> = {
    ...views.handlers(),
    createBotSetupThread: async request => ({ threadId: (await bb.sdk.threads.spawn({ ...request, origin: "app", title: "Create a bot" })).id }),
    create: input => create(input),
    usage: ({ id }) => runtime.data.usage(undefined, id),
    saveLimits: ({ id, limits }) => runtime.locked(id, async () => {
      const bot = store.get(id);
      store.put({ ...bot, limits, updatedAt: Math.max(Date.now(), bot.updatedAt + 1) });
      runtime.changed(); return runtime.data.usage(undefined, id);
    }),
    resolveBotCreateRequest: async ({ id, approved }) => {
      const request = store.botCreateRequest(id);
      if (!request) throw new Error("Bot creation request not found.");
      if (request.status !== "pending")
        throw new Error("This bot creation request has already been resolved.");
      const resolved = store.resolveBotCreateRequest(
        id,
        approved ? "approved" : "denied",
      );
      if (!resolved || resolved.status === "pending")
        throw new Error(
          "This bot creation request changed before it was resolved.",
        );
      if (approved) await materializeBotCreateRequest(id);
      runtime.changed();
      return { ok: true as const };
    },
    retire: ({ id, retired }) => runtime.retire(id, retired),
    retryJob: ({ id }) => runtime.retryJob(id),
    update: ({ id, expectedUpdatedAt, ...patch }) =>
      updateBot(id, expectedUpdatedAt, patch),
    swapModel: ({ id, expectedUpdatedAt }) =>
      runtime.locked(id, async () => {
        const bot = botSchema.parse(store.get(id));
        if (!bot.fallbackProviderId)
          throw new Error("Set a fallback model before swapping.");
        return updateBotUnlocked(id, expectedUpdatedAt, {
          providerId: bot.fallbackProviderId,
          model: bot.fallbackModel,
          reasoningLevel: bot.fallbackReasoningLevel,
          fallbackProviderId: bot.providerId,
          fallbackModel: bot.model,
          fallbackReasoningLevel: bot.reasoningLevel,
        });
      }),
    ...botHandlers(bb, store, runtime, profiles),
    profiles: () =>
      store.all().filter((bot) => !bot.retired)
        .sort((a, b) => a.name.localeCompare(b.name)),
    threadProfile: ({ threadId }) => profiles.profile(threadId),
    threadBots: () => {
      const active = new Set(store.all().filter((bot) => !bot.retired).map((bot) => bot.id));
      return store.threadBots().filter((row) => active.has(row.botId));
    },
    setThreadProfile: ({ threadId, botId }) =>
      runtime.locked(`thread:${threadId}`, () => profiles.set(threadId, botId)),
    pendingThreadProfile: ({ projectId, botId }) => {
      profiles.setPending(projectId, botId);
      return { ok: true as const };
    },
    profileThreads: async ({ id }) => {
      const threads = await Promise.all(store.conversations(id)
        .filter((c) => c.kind === "admin")
        .map(async (c) => {
          try {
            const thread = await bb.sdk.threads.get({ threadId: c.threadId });
            return [{
              threadId: thread.id,
              title: thread.title?.trim() || thread.titleFallback?.trim() || c.title,
              archived: thread.archivedAt !== null,
              updatedAt: thread.updatedAt,
            }];
          } catch (cause) {
            if (!missingThread(cause)) throw cause;
            return [];
          }
        }));
      return threads.flat().sort((a, b) => b.updatedAt - a.updatedAt);
    },
    spaceConversations: () => ({ direct: store.threadBots().map(row => ({ threadId: row.threadId, botName: store.get(row.botId).name })) }),
    list: async () => {
      const bots = store.all(), activity = store.botActivitySummary();
      const directConversations = Object.fromEntries(bots.map(bot => [bot.id, store.conversations(bot.id).filter(c => c.kind === "admin")]));
      const directThreads: z.infer<typeof rpcContract.list.output>["directThreads"] = {};
      const directThreadInfo: z.infer<typeof rpcContract.list.output>["directThreadInfo"] = {};
      const listed = new Map<string, Awaited<ReturnType<typeof bb.sdk.threads.list>>[number]>();
      const wanted = new Set(Object.values(directConversations).flat().map(c => c.threadId));
      for (let offset = 0; wanted.size; offset += 100) {
        const rows = await bb.sdk.threads.list({ limit: 100, offset });
        for (const row of rows) { listed.set(row.id, row); wanted.delete(row.id); }
        if (rows.length < 100) break;
      }
      for (const c of Object.values(directConversations).flat()) {
        try {
          const thread = listed.get(c.threadId) ?? await bb.sdk.threads.get({ threadId: c.threadId });
          directThreadInfo[c.threadId] = { title: thread.title || thread.titleFallback || c.title, projectId: thread.projectId, archivedAt: thread.archivedAt, pinned: thread.pinnedAt !== null, unread: thread.latestAttentionAt > (thread.lastReadAt ?? 0), sectionId: thread.sectionId, updatedAt: thread.updatedAt };
          if (store.currentDirectConversation(c.botId)?.threadId === c.threadId) directThreads[c.botId] = { threadId: c.threadId, status: thread.status, indicator: listed.has(c.threadId) ? directThreadIndicator(listed.get(c.threadId)!) : ["active", "starting"].includes(thread.status) ? "runtime" : thread.status === "error" ? "unread-error" : "none" };
        } catch (cause) { if (!missingThread(cause)) bb.log.warn(String(cause)); }
      }
      return { bots: bots.map(bot => ({ ...bot, working: activity.get(bot.id)?.working ?? false, lastActivityAt: activity.get(bot.id)?.lastActivityAt ?? null })), views: views.all(), directConversations, directThreads, directThreadInfo,
        botCreateRequests: store.botCreateRequests().map(r => ({ ...r.input, id: r.id, requesterBotId: r.requesterBotId, requesterName: r.requesterName, channelName: null, mission: r.input.mission.slice(0,4000), missionTruncated: r.input.mission.length > 4000, createdAt: r.createdAt, expiresAt: r.expiresAt })) };
    },
    cancelJob: ({ id }) => runtime.locked("cancel", async () => {
      const job = store.job(id);
      if (!job) throw new Error("Work item not found.");
      if (!["queued", "dispatching", "running"].includes(job.status)) return { cancelled: false };
      await runtime.cancel(job, "Cancelled by the owner."); return { cancelled: true };
    }),
  };
  bb.rpc.register(rpcContract, handlers);
  // Bots and saved views in the Studio collection. Studio hears about a change only when
  // something it shows does, not on every message.
  const studio = studioSchemas(z);
  const studioNotifier = createStudioNotifier({ plugins: bb.sdk.plugins, pluginId: STUDIO_PROVIDER_ID, schemas: studio });
  registerStudio(bb, studio, {
    bots: () => store.all(),
    activity: () => store.botActivitySummary(),
    views: () => views.all(),
    createView: () => views.create("New view", []),
    archiveView: async (id, archived) => {
      const view = views.get(id);
      return views.handlers().viewUpdate({ ...view, archived, expectedUpdatedAt: view.updatedAt });
    },
    deleteView: async (id) => views.handlers().viewDelete({ id }),
    readView: async (id) => {
      const page = await views.page(id);
      return [`# ${page.view.name}`, ...page.entries.map(entry => `${entry.role === "user" ? "You" : "Reply"}: ${entry.text}`)].join("\n\n");
    },
    retire: (id, retired) => runtime.retire(id, retired),
  });
  const itemSignature = () => botsSignature(store.all(), store.botActivitySummary()) + JSON.stringify(views.all());
  let studioSignature = itemSignature();
  let studioCheck: ReturnType<typeof setTimeout> | undefined;
  const notifyStudio = () => {
    // Changes come in bursts; compare once per burst.
    studioCheck ??= setTimeout(() => {
      studioCheck = undefined;
      const next = itemSignature();
      if (next === studioSignature) return;
      studioSignature = next;
      studioNotifier.changed();
    }, 500);
  };
  runtime.onChanged.add(notifyStudio);
  views.onChanged.add(notifyStudio);
  bb.onDispose(() => {
    runtime.onChanged.delete(notifyStudio);
    views.onChanged.delete(notifyStudio);
    clearTimeout(studioCheck);
    studioNotifier.dispose();
  });
  const tools = registerTeamsCli(bb, store, handlers, approveBotCreate);
  registerViewMentions(bb, store, views);
  bb.agents.configure(context => {
    const conversation = store.byThread(context.thread.id);
    const bot = conversation ? store.get(conversation.botId) : null;
    return { tools, skills: ["bots"], ...(bot && !bot.retired ? { instructions: [
      `This thread works as the persistent bot ${JSON.stringify(bot.name)} (@${bot.handle}). Work as this bot. Your persistent bot home is ${JSON.stringify(bot.home)}. Read AGENTS.md in this bot home as well as MISSION.md and MEMORY.md, using that absolute path. Do the work itself in this thread's initial working directory: it is the thread's project, not your bot home.`,
      "Read MISSION.md and MEMORY.md at the beginning of every turn, including follow-ups. Keep durable memory up to date.",
      "MISSION.md belongs to the owner. Change it only on an explicit owner request. Keep private conversation details out of shared memory.",
      "Collaboration uses normal BB threads. A Studio view message includes the owner's request and a roster of addressed thread IDs; that authorizes coordination with those threads for that request. Scheduled reports go to Studio Feed with stable story keys. Post nothing for [PASS].",
      `Profile: ${JSON.stringify(bot.description)}`,
    ].join("\n") } : {}) };
  });
  bb.experimental_hooks.on("message.dispatch", context => {
    if (context.thread.status === "pending" && context.initiator === "user" && context.senderThreadId === null && !context.thread.originPluginId)
      profiles.attachPending(context.project.id, context.thread.id);
    return { action: "proceed" };
  });
  for (const event of ["thread.created", "thread.active", "thread.idle", "thread.failed", "thread.archived", "thread.unarchived"] as const)
    bb.events.on(event, () => views.changed());
  bb.events.on("thread.deleted", ({ thread }) => { store.deleteConversation(thread.id); runtime.changed(); views.changed(); });
  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    const c = store.byThread(thread.id);
    if (!c) return;
    if (c.kind === "mission") await runtime.settleFromEvent(thread.id, lastAssistantText);
    try { runtime.data.snapshot(`${c.botId}:MEMORY.md`, (await document(store.get(c.botId).home, "MEMORY.md")).text, store.get(c.botId).name); }
    catch (cause) { bb.log.debug(String(cause)); }
    runtime.changed();
  });
  bb.events.on("thread.failed", async ({ thread, error }) => {
    const c = store.byThread(thread.id);
    if (c?.kind === "mission") await runtime.settleFromEvent(thread.id, null, error);
    runtime.changed();
  });
  bb.background.service("bots", { async start(signal) {
    await profiles.showMigrated();
    let migrationRetryAt = 0;
    while (!signal.aborted) {
      if (Date.now() >= migrationRetryAt) {
        try { await migrateViews(bb, store, runtime, profiles, views); migrationRetryAt = Date.now() + 60_000; }
        catch (cause) { migrationRetryAt = Date.now() + 60_000; bb.log.warn(`View migration will retry: ${String(cause)}`); }
      }
      try { await recoverApprovedBotCreates(signal); await runtime.tickMissions(); }
      catch (cause) { bb.log.warn(`Bot maintenance failed: ${String(cause)}`); }
      try { await delay(1500, undefined, { signal }); } catch { break; }
    }
  } });
  bb.onDispose(() => runtime.dispose());
}
