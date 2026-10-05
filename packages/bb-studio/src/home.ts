import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { StudioHub } from "./hub";
import type { StudioServices } from "./services";
import type { ProviderComments } from "./provider-comments";
import { needsYouData } from "./needs-you";
import { backgroundKinds } from "./query";

const automation = z.object({ id: z.string(), name: z.string(), projectId: z.string(), enabled: z.boolean(), nextRunAt: z.number().nullable() });

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
  const needsYou = await needsYouData(sdk, services, providerComments, overview.items, projectId);
  const activeThreads = threadList.filter((thread) => ["active", "starting", "pending", "stopping"].includes(thread.status));
  const working = {
    threads: activeThreads.map((thread) => ({ id: thread.id, title: thread.title ?? thread.titleFallback ?? "Untitled thread", status: thread.status, projectId: thread.projectId })).slice(0, 12),
  };
  const background = backgroundKinds(overview.providers);
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
  return { needsYou, working, recent, automations, activity, dashboard: { periodDays, threads } };
}
