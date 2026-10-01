import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { StudioHub } from "./hub";
import type { StudioServices } from "./services";
import type { ProviderComments } from "./provider-comments";
import { needsYouData } from "./needs-you";

const task = z.object({ id: z.string(), title: z.string(), status: z.string(), due: z.string().nullable(), boardId: z.string().optional(), projectId: z.string().nullable(), archived: z.boolean(), priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(), updatedAt: z.number().optional() });
const statuses = z.object({ columns: z.array(z.object({ id: z.string(), label: z.string() })) });
const teams = z.object({
  bots: z.array(z.object({ id: z.string(), name: z.string(), projectId: z.string(), working: z.boolean() })),
  rooms: z.array(z.object({ id: z.string(), name: z.string(), projectId: z.string() })),
  roomWork: z.record(z.string(), z.object({ running: z.number() })),
  directConversations: z.record(z.string(), z.array(z.object({ botId: z.string(), threadId: z.string() }))),
});
const roomJobs = z.object({ jobs: z.array(z.object({ botId: z.string(), startedAt: z.number().nullable(), updatedAt: z.number(), status: z.string(), threadId: z.string().nullable() })) });
const automation = z.object({ id: z.string(), name: z.string(), projectId: z.string(), enabled: z.boolean(), nextRunAt: z.number().nullable() });
const usage = z.object({ turns: z.number(), forks: z.number(), active: z.number(), errors: z.number(), routingMilliseconds: z.number(), limits: z.object({ turnsPerHour: z.number(), turnsPerDay: z.number(), minutesPerTurn: z.number(), concurrentForks: z.number() }) });

type Sdk = Pick<BbPluginApi["sdk"], "plugins" | "threads" | "projects">;
const day = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const sameProject = (item: { projectId: string | null }, projectId?: string) => !projectId || item.projectId === projectId || item.projectId === null;

export function summarizeTurns(events: readonly { type: string; createdAt: number; data?: { status?: string } }[], since: number) {
  let turns = 0, failures = 0, durationMs = 0;
  let started: number | null = null;
  for (const event of [...events].sort((a, b) => a.createdAt - b.createdAt)) {
    if (event.type === "turn/started") started = event.createdAt;
    if (event.type === "turn/completed") {
      if (event.createdAt < since) { started = null; continue; }
      turns++;
      if (event.data?.status === "failed") failures++;
      if (started !== null) durationMs += Math.max(0, event.createdAt - started);
      started = null;
    }
  }
  return { turns, failures, durationMs };
}

export function summarizeBotJobs(jobs: readonly { startedAt: number | null; updatedAt: number; status: string }[], since: number) {
  const completed = jobs.filter((job) => job.startedAt !== null && job.updatedAt >= since);
  return { turns: completed.length, failures: completed.filter((job) => job.status === "error").length,
    durationMs: completed.reduce((total, job) => total + Math.max(0, job.updatedAt - job.startedAt!), 0) };
}

export async function homeData(sdk: Sdk, hub: StudioHub, services: StudioServices, providerComments: ProviderComments, projectId?: string, periodDays = 7) {
  const now = Date.now();
  const today = day(new Date(now));
  const since = now - periodDays * 86_400_000;
  const [overview, installed, threadList, projects] = await Promise.all([
    hub.overview(), sdk.plugins.list(), sdk.threads.list({ ...(projectId ? { projectId } : {}), archived: false, limit: 200 }), sdk.projects.list(),
  ]);
  const available = new Set(installed.plugins.filter((plugin) => plugin.enabled && ["running", "degraded", "starting"].includes(plugin.status)).map((plugin) => plugin.id));
  const call = <T>(pluginId: string, method: string, input: unknown, outputSchema: z.ZodType<T>) =>
    sdk.plugins.callRpc({ pluginId, method, input: input as never, outputSchema, signal: AbortSignal.timeout(5000) });
  const [board, roster] = await Promise.all([
    available.has("studio-tasks") ? call("studio-tasks", "board", {}, z.object({ tasks: z.array(task) })).catch(() => null) : null,
    available.has("bot-teams") ? call("bot-teams", "list", null, teams).catch(() => null) : null,
  ]);
  // Each board has its own columns; a Tasks from before boards has them per project.
  const columnsOf = (item: { boardId?: string; projectId: string | null }) => item.boardId ?? item.projectId;
  const statusSets = new Map(await Promise.all([...new Set(board?.tasks.map(columnsOf) ?? [])].map(async (key) => {
    const input = key?.startsWith("brd_") ? { boardId: key } : { projectId: key };
    const result = await call("studio-tasks", "statuses", input, statuses).catch(() => null);
    return [key, new Set(result?.columns.filter((column) => column.id === "review" || /\breview\b/i.test(column.label)).map((column) => column.id) ?? ["review"])] as const;
  })));
  const inReview = (item: { boardId?: string; projectId: string | null; status: string }) => (statusSets.get(columnsOf(item)) ?? new Set(["review"])).has(item.status);
  const due = board?.tasks.filter((item) => !item.archived && item.status !== "done" && item.due && item.due <= today && sameProject(item, projectId)).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")).slice(0, 8) ?? null;
  const review = board?.tasks.filter((item) => !item.archived && inReview(item) && sameProject(item, projectId)).slice(0, 8) ?? null;
  const needsYou = await needsYouData(sdk, services, providerComments, overview.items,
    board?.tasks ?? null, roster?.rooms ?? null, projectId, inReview);
  const activeThreads = threadList.filter((thread) => ["active", "starting", "pending", "stopping"].includes(thread.status));
  const working = {
    threads: activeThreads.map((thread) => ({ id: thread.id, title: thread.title ?? thread.titleFallback ?? "Untitled thread", status: thread.status, projectId: thread.projectId })).slice(0, 12),
    bots: roster?.bots.filter((bot) => bot.working && (!projectId || bot.projectId === projectId)).map((bot) => ({ id: bot.id, name: bot.name, projectId: bot.projectId })) ?? null,
  };
  const background = new Set(overview.providers.flatMap((provider) => provider.kinds.filter((kind) => kind.background).map((kind) => `${provider.pluginId}:${kind.id}`)));
  const recent = overview.items.filter((item) => !item.archived && !background.has(`${item.pluginId}:${item.kind}`) && sameProject(item, projectId)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map((item) => ({ pluginId: item.pluginId, id: item.id, title: item.title, href: item.href, kind: item.kind, updatedAt: item.updatedAt }));
  const automationLists = available.has("automations") ? await Promise.all((projectId ? [projectId] : projects.map((project) => project.id)).map((id) =>
    call("automations", "automations_list", { projectId: id }, z.array(automation)).catch(() => null))) : null;
  const automations = automationLists?.some((list) => list !== null)
    ? automationLists.flatMap((list) => list ?? []).filter((item) => item.enabled && item.nextRunAt !== null && day(new Date(item.nextRunAt)) === today).sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0)).slice(0, 8)
    : null;
  // Only items an add-on still lists, so deleted items drop out of Home.
  const listed = new Map(overview.items.map((item) => [`${item.pluginId}:${item.id}`, item]));
  const activity = services.activity(null, 0, 50).flatMap((event) => {
    const item = listed.get(`${event.ref.pluginId}:${event.ref.id}`);
    return item && sameProject(item, projectId) ? [{ ...event, href: item.href }] : [];
  }).slice(0, 12);
  const threads = await Promise.all(threadList.filter((thread) => thread.updatedAt >= since).slice(0, 40).map(async (thread) => {
    const events = await sdk.threads.events.list({ threadId: thread.id, order: "desc", limit: "500", types: ["turn/started", "turn/completed"] }).catch(() => []);
    return { id: thread.id, title: thread.title ?? thread.titleFallback ?? "Untitled thread", status: thread.status, ...summarizeTurns(events.map((event) => ({ type: event.type, createdAt: event.createdAt, data: { status: event.type === "turn/completed" ? event.data.status : undefined } })), since) };
  }));
  const jobs = roster ? (await Promise.all(roster.rooms.filter((room) => !projectId || room.projectId === projectId).map((room) =>
    call("bot-teams", "room", { id: room.id, limit: 1 }, roomJobs).then((result) => result.jobs, () => [])))).flat() : [];
  const direct = roster ? Object.values(roster.directConversations).flat() : [];
  const roomThreadIds = new Set(jobs.map((job) => job.threadId));
  const directStats = await Promise.all(direct.filter((entry) => !roomThreadIds.has(entry.threadId)).map(async (entry) => {
    const events = await sdk.threads.events.list({ threadId: entry.threadId, order: "desc", limit: "500", types: ["turn/started", "turn/completed"] }).catch(() => []);
    return { botId: entry.botId, ...summarizeTurns(events.map((event) => ({ type: event.type, createdAt: event.createdAt, data: { status: event.type === "turn/completed" ? event.data.status : undefined } })), since) };
  }));
  const bots = roster ? await Promise.all(roster.bots.filter((bot) => !projectId || bot.projectId === projectId).map(async (bot) => {
    const summary = await call("bot-teams", "usage", { id: bot.id, kind: "bot" }, usage).catch(() => null);
    const botJobs = summarizeBotJobs(jobs.filter((job) => job.botId === bot.id), since);
    const botDirect = directStats.filter((entry) => entry.botId === bot.id);
    return { id: bot.id, name: bot.name,
      turns: botJobs.turns + botDirect.reduce((total, entry) => total + entry.turns, 0),
      failures: botJobs.failures + botDirect.reduce((total, entry) => total + entry.failures, 0),
      durationMs: botJobs.durationMs + botDirect.reduce((total, entry) => total + entry.durationMs, 0),
      active: summary?.active ?? 0, limits: summary?.limits ?? null };
  })) : null;
  return { needsYou, due, review, working, recent, automations, activity, dashboard: { periodDays, threads, bots } };
}
