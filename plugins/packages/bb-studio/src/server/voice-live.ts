import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { Automations } from "../automations";
import type { Bots } from "../bot";
import type { BotOwnedThreads } from "../bot-owned";
import { openaiKey } from "../openai-key";
import type { registerPages } from "../pages/server";
import { PERSONAL_PROJECT_ID, type ProjectLeads } from "../project-lead";
import type { Runners } from "../runners";
import { excerpt, tokens, type SearchHit } from "../search-index";
import { CANVAS_PLUGIN_ID, canvasVoiceOutput, canvasVoiceRunOutput } from "../voice/live/canvas-plugin";
import { gatherSeed, type SeedMessage } from "../voice/live/identity";
import { VoiceLive } from "../voice/live/live";
import { registerVoiceLive } from "../voice/live/register";
import { VOICE_LIVE_CHANNEL } from "../voice/live/shared";
import { resolveTarget } from "../voice/live/targets";

export interface VoiceLiveDeps {
  bb: BbPluginApi;
  db: Database.Database;
  bots: Bots;
  pages: ReturnType<typeof registerPages>;
  projectLeads: ProjectLeads;
  runners: Runners;
  automations: Automations;
  ownedThreads: BotOwnedThreads;
  getSettingValues: () => Record<string, unknown>;
  saveSettings: (values: Record<string, unknown>) => Promise<void>;
  botPushIds: (threadId: string) => Record<string, unknown>;
}

/** Wires hands-free VoiceLive to BB Studio's Bots, threads, automations, push, and Canvas. */
export function setupVoiceLive({
  bb,
  db,
  bots,
  pages: _pages,
  projectLeads,
  runners,
  automations,
  ownedThreads,
  getSettingValues,
  saveSettings,
  botPushIds,
}: VoiceLiveDeps): { voiceLive: VoiceLive; voiceSearch: (query: string, limit: number) => SearchHit[] } {
  const voiceLive = new VoiceLive({
    db,
    key: () => openaiKey(getSettingValues()),
    settings: getSettingValues,
    saveSettings,
    cos: () => { const bot = bots.stored(); return bot ? { name: bot.name, threadId: bot.threadId ?? null } : null; },
    // The session's identity seed (src/voice/live/identity.ts): cheap sources only, read once at start.
    seed: async (threadId) => {
      const projectNames = bb.sdk.projects.list({ includePersonal: true }).then((list) => new Map((list as { id: string; name: string }[]).map((project) => [project.id, project.name]))).catch(() => new Map<string, string>());
      return gatherSeed(threadId, {
        bots: () => bots.list().map((bot) => ({ id: bot.id, name: bot.name, role: bot.role ?? null, threadId: bot.threadId, primary: !!bot.primary })),
        memory: (botId) => bots.alwaysOnSkills(botId).map((skill) => skill.body.trim()).join("\n\n") || null,
        leadOf: async (id) => { const lead = projectLeads.list().find((each) => each.leadThreadId === id && each.projectId !== PERSONAL_PROJECT_ID); return lead ? (await projectNames).get(lead.projectId) ?? lead.projectId : null; },
        runnerOf: (id) => { const runner = runners.forThread(id); return runner ? { name: runner.name, job: runner.job } : null; },
        thread: async (id) => {
          const thread = await bb.sdk.threads.get({ threadId: id }) as { title?: string | null; titleFallback?: string | null; projectId?: string | null };
          const projectId = thread.projectId ?? null;
          const project = projectId && projectId !== PERSONAL_PROJECT_ID ? (await projectNames).get(projectId) ?? null : null;
          return { title: thread.title || thread.titleFallback || "this thread", project };
        },
        recent: async (id) => {
          const page = await bb.sdk.threads.timeline({ threadId: id, segmentLimit: "4" } as never) as { rows?: { kind: string; role?: string; text?: string; children?: unknown[] }[] };
          const messages: SeedMessage[] = [];
          const visit = (rows: { kind: string; role?: string; text?: string; children?: unknown[] }[]) => {
            for (const row of rows) {
              if (row.kind === "conversation" && (row.role === "user" || row.role === "assistant") && row.text) messages.push({ role: row.role, text: row.text });
              if (Array.isArray(row.children)) visit(row.children as never);
            }
          };
          visit(page.rows ?? []);
          return messages;
        },
      });
    },
    resolve: async (name) => {
      const bot = bots.stored();
      const projects = new Map(((await bb.sdk.projects.list({ includePersonal: true }).catch(() => [])) as { id: string; name: string }[]).map((project) => [project.id, project.name]));
      const leads = projectLeads.list().filter((lead) => lead.projectId !== PERSONAL_PROJECT_ID && lead.leadThreadId).map((lead) => ({ project: projects.get(lead.projectId) ?? lead.projectId, threadId: lead.leadThreadId! }));
      const threads = ((await bb.sdk.threads.list({ archived: false, limit: 100 }).catch(() => [])) as { id: string; title?: string | null; titleFallback?: string | null; latestAttentionAt?: number }[])
        .sort((a, b) => (b.latestAttentionAt ?? 0) - (a.latestAttentionAt ?? 0)).map((thread) => ({ id: thread.id, title: thread.title || thread.titleFallback || "" })).filter((thread) => thread.title);
      return resolveTarget(name, { cos: bot ? { name: bot.name, threadId: bot.threadId ?? null } : null, leads, threads });
    },
    latestReply: async (threadId) => {
      const [thread, output] = await Promise.all([bb.sdk.threads.get({ threadId }), bb.sdk.threads.output({ threadId })]);
      return { title: (thread as { title?: string | null }).title || threadId, text: output.output ?? "" };
    },
    threads: {
      stop: async (threadId) => { await bb.sdk.threads.stop({ threadId }); },
      archive: async (threadId) => { await bb.sdk.threads.archive({ threadId }); },
    },
    automations: {
      list: async () => (await automations.list()).map((each) => ({ id: each.id, name: each.name, state: each.state })),
      pause: async (id) => { await automations.setState(id, "paused"); },
      remove: async (id) => { await automations.delete(id); },
    },
    openThread: async ({ title, text, note }) => (await bb.sdk.threads.spawn({
      projectId: PERSONAL_PROJECT_ID, title,
      // As the Bot's chat: the personal project's default environment (a host one needs a host id).
      environment: { type: "project-default" },
      pluginMetadata: { voiceLive: true },
      input: [{ type: "text", text, mentions: [] }, { type: "text", text: note, mentions: [], visibility: "agent-only" }],
    } as never)).id,
    // Voice threads live under the Bot, like its other threads: hidden from BB's main list, in its Recent.
    claim: async (threadId) => { const bot = bots.stored(); if (bot) await ownedThreads.claim(threadId, bot.id); },
    send: ({ threadId, senderThreadId, text, note, mode }) => bb.sdk.threads.send({
      threadId, mode, ...(senderThreadId ? { senderThreadId } : {}),
      input: [{ type: "text", text, mentions: [] }, { type: "text", text: note, mentions: [], visibility: "agent-only" }],
    } as never).then(() => undefined),
    push: async ({ title, body, threadId, coalesceKey }) => {
      await bb.sdk.plugins.callRpc({
        pluginId: "mobile", method: "notify", outputSchema: z.unknown(),
        input: { title, body: body.slice(0, 4000), kind: "turn-finished", threadId, projectId: PERSONAL_PROJECT_ID, coalesceKey, ...botPushIds(threadId) } as never,
      });
    },
    publish: (signal) => bb.realtime.publish(VOICE_LIVE_CHANNEL, signal),
    // Started from a Canvas plugin thread, the voice edits that canvas's board while it talks,
    // through the plugin's RPCs (its own data; nothing of it lives in Studio).
    canvas: {
      tools: async (threadId) => {
        const answer = await bb.sdk.plugins.callRpc({ pluginId: CANVAS_PLUGIN_ID, method: "canvas.voice", input: { threadId }, outputSchema: canvasVoiceOutput, signal: AbortSignal.timeout(5000) });
        return { tools: answer.tools, note: answer.instructions };
      },
      run: async (threadId, name, args) => (await bb.sdk.plugins.callRpc({ pluginId: CANVAS_PLUGIN_ID, method: "canvas.voiceRun", input: { threadId, name, args: args as never }, outputSchema: canvasVoiceRunOutput, signal: AbortSignal.timeout(10_000) })).output,
    },
    // Staged BBs only: a scripted mock server stands in for OpenAI (scripts/voice-mock).
    mockUrl: () => process.env.STUDIO_VOICE_MOCK_URL?.trim() || null,
    warn: (message) => bb.log.warn(message),
  });

  registerVoiceLive(bb, voiceLive);

  const voiceSearch = (query: string, limit: number): SearchHit[] => {
    const words = tokens(query);
    return voiceLive.search(query, limit).map((hit) => ({
      ref: { pluginId: "__bb__", id: hit.threadId },
      kind: "thread",
      title: hit.title,
      snippet: excerpt(hit.text, words),
      href: `/threads/${hit.threadId}`,
      projectId: PERSONAL_PROJECT_ID,
      updatedAt: hit.at,
      score: 1,
    }));
  };

  return { voiceLive, voiceSearch };
}
