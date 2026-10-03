import { parseFlags, subcommand } from "@bb-studio/kit/cli";
// Explore's server: agents end answers with what they noticed along the way
// (`::explore{items="…"}`); a click writes a page explaining it.
//
//   - ExploreService (service.ts) runs each explainer's job; workers are
//     hidden forks of the thread (worker.ts); pages are written in Pages over
//     RPC, under the project's "Explore" page, and tagged in Studio (pages.ts).
//   - This file adds the RPC handlers, the `explore_explain` tool, the
//     instructions for `bb.agents.configure`, and `bb explore …`.
import type { BbPluginApi, PluginCliContext, PluginCliResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { exploreFeed, replyFindings } from "./feed";
import { explainerHtml } from "./markdown";
import { explorePages } from "./pages";
import { exploreInstructions } from "./prompt";
import { ExploreService } from "./service";
import { PLUGIN_ID, REALTIME_CHANNEL, type RealtimeEvent } from "./constants";
import { MAX_LABEL_LENGTH, STAGES, parseExploreItem } from "./shared";
import { ExploreStore, MIGRATIONS, type ExplainerRow } from "./store";
import { walk } from "./timeline";
import { exploreWorkers } from "./worker";
import { exploreTasks } from "./tasks";

export const EXPLORE_TOOL = "explore_explain";

const USAGE = {
  list: "bb explore list [--thread <thread id>]",
  open: "bb explore open <explainer id>",
  regenerate: "bb explore regenerate <explainer id> [--wait]",
};
export const EXPLORE_USAGE = `bb explore <list|open|regenerate> …`;

type CliResult = PluginCliResult;

/** How often the daily digest checks whether it's time. */
const DIGEST_CHECK_MS = 10 * 60_000;
const RPC_TIMEOUT_MS = 15_000;

export function registerExplore(bb: BbPluginApi, options: {
  feedDigest: () => boolean;
  digestHour?: () => number;
  workerTimeoutMs?: () => number;
} = { feedDigest: () => true }) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new ExploreStore(db);
  const workers = exploreWorkers(bb, { timeoutMs: options.workerTimeoutMs });
  const explainerPages = explorePages(bb.sdk.plugins);
  const publish = (explainer: ExplainerRow) => {
    const event: RealtimeEvent = {
      type: "explainer",
      explainerId: explainer.id,
      threadId: explainer.thread_id,
      messageId: explainer.message_id,
      parentId: explainer.parent_id,
    };
    bb.realtime.publish(REALTIME_CHANNEL, event);
    // A written explainer is linked from the Feed post its finding was saved as.
    if (explainer.page_id && !explainer.parent_id) {
      feed.explainerChanged(explainer.key).catch((error: unknown) => bb.log.warn(`Could not link the explainer from the Feed: ${String(error)}`));
    }
  };
  const service = new ExploreService({
    store,
    pages: explainerPages,
    collect: workers.collect,
    startWorker: (explainer, prompt, context) => workers.startWorker(explainer, prompt, context),
    awaitWorker: workers.awaitWorker,
    disposeWorker: workers.disposeWorker,
    changed: publish,
    log: bb.log,
  });
  const feed = exploreFeed({
    store,
    digestHour: options.digestHour,
    callRpc: (pluginId, method, input, schema) =>
      bb.sdk.plugins.callRpc({ pluginId, method, input: input as never, outputSchema: schema, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }),
    explainerPage: (finding) => {
      const row = store.byKey(finding.key);
      const href = row?.page_id ? service.view(row).href : null;
      return row?.page_id && href ? { pageId: row.page_id, href } : null;
    },
    projectName: async (projectId) => {
      const project = (await bb.sdk.projects.get({ projectId })) as { name?: unknown; project?: { name?: unknown } };
      const name = project.name ?? project.project?.name;
      return typeof name === "string" && name.trim() ? name.trim() : null;
    },
  });

  // Every reply's findings are kept, for saving to the Feed and its daily digest.
  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    const items = replyFindings(lastAssistantText);
    if (!items.length || thread.originPluginId === PLUGIN_ID || thread.visibility === "hidden") return;
    try {
      const message = await latestAssistantMessage(thread.id, AbortSignal.timeout(RPC_TIMEOUT_MS));
      if (!message) return;
      const threadTitle = thread.title?.trim() || thread.titleFallback?.trim() || "";
      for (const item of items) {
        store.addFinding({ threadId: thread.id, messageId: message.id, turnId: message.turnId, emoji: item.emoji, label: item.label, projectId: thread.projectId ?? null, threadTitle });
      }
    } catch (error) {
      bb.log.warn(`Could not keep the findings from ${thread.id}: ${String(error)}`);
    }
  });
  const digestTimer = setInterval(() => {
    if (!options.feedDigest()) return;
    feed.digest().catch((error: unknown) => bb.log.warn(`Could not post the Explore digest to the Feed: ${String(error)}`));
  }, DIGEST_CHECK_MS);

  /** A finding from a reply, kept now if the idle event missed it. */
  async function finding(input: { threadId: string; messageId: string; turnId?: string | null; emoji?: string; label: string }) {
    const parsed = parseExploreItem(`${input.emoji ?? ""} ${input.label}`);
    if (!parsed) throw new Error("Nothing to save.");
    const thread = await bb.sdk.threads.get({ threadId: input.threadId }).catch(() => null);
    return store.addFinding({
      threadId: input.threadId,
      messageId: input.messageId,
      turnId: input.turnId ?? null,
      emoji: parsed.emoji,
      label: parsed.label,
      projectId: thread?.projectId ?? null,
      threadTitle: thread?.title?.trim() || thread?.titleFallback?.trim() || "",
    });
  }

  const interrupted = service.recover();
  if (interrupted.length) bb.log.info(`Marked ${interrupted.length} Explore job(s) interrupted by the restart.`);

  const view = (row: ExplainerRow | null | undefined) => (row ? service.view(row) : null);
  const mustGet = (id: string): ExplainerRow => {
    const row = store.explainer(id);
    if (!row) throw new Error(`Explainer ${id} not found.`);
    return row;
  };

  // RPC ------------------------------------------------------------------------

  const rpc = {
    taskForFinding: exploreTasks({
      callRpc: (pluginId, method, input, schema) => bb.sdk.plugins.callRpc({ pluginId, method, input: input as never, outputSchema: schema, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }),
      pageId: (key, parentId) => store.byKey(key)?.page_id ?? (parentId ? store.explainer(parentId)?.page_id : null) ?? null,
    }),
    explore: ({ threadId, messageId, turnId, emoji, label, parentId }: { threadId: string; messageId: string; turnId?: string | null; emoji?: string; label: string; parentId?: string | null }) => {
      const result = service.explore({ threadId, messageId, turnId, emoji, label, parentId });
      return { explainer: service.view(result.explainer), started: result.started };
    },
    saveToFeed: async (input: { threadId: string; messageId: string; turnId?: string | null; emoji?: string; label: string }) => ({
      postId: await feed.save(await finding(input)),
    }),
    savedForMessage: ({ threadId, messageId }: { threadId: string; messageId: string }) => ({
      labels: store
        .findingsForMessage(threadId, messageId)
        .filter((row) => row.post_id)
        .map((row) => row.label),
    }),
    exploreFeedPost: async ({ postId }: { postId: string }) => {
      const saved = store.findingByPost(postId);
      if (!saved) return { status: "unavailable" as const, href: null };
      const { explainer } = service.explore({
        threadId: saved.thread_id,
        messageId: saved.message_id,
        turnId: saved.turn_id,
        emoji: saved.emoji,
        label: saved.label,
        projectId: saved.project_id,
      });
      if (!explainer.page_id) return { status: "started" as const, href: null };
      await feed.linkExplainer(saved).catch(() => undefined);
      return { status: "ready" as const, href: service.view(explainer).href };
    },
    exploreRegenerate: ({ explainerId }: { explainerId: string }) => ({ explainer: service.view(service.regenerate(explainerId)) }),
    exploreStop: ({ explainerId }: { explainerId: string }) => ({ explainer: view(service.stop(explainerId)) }),
    explainer: async ({ explainerId }: { explainerId: string }) => ({ explainer: view(await service.checkPage(explainerId)) }),
    explainerDocument: async ({ explainerId }: { explainerId: string }) => {
      const pageId = store.explainer(explainerId)?.page_id;
      const markdown = pageId ? await explainerPages.markdown(pageId).catch(() => null) : null;
      return { html: markdown ? explainerHtml(markdown) : null };
    },
    explainersForMessage: ({ threadId, messageId, parentId }: { threadId: string; messageId: string; parentId?: string | null }) => ({
      explainers: store.forMessage(threadId, messageId, parentId ?? null).map((row) => service.view(row)),
    }),
    explainers: ({ threadId, limit }: { threadId?: string; limit?: number }) => ({
      explainers: store.list({ threadId, limit }).map((row) => service.view(row)),
    }),
  };

  // Agents ---------------------------------------------------------------------

  /** The newest assistant message in a thread, for a tool call without one. */
  async function latestAssistantMessage(threadId: string, signal: AbortSignal): Promise<{ id: string; turnId: string | null } | null> {
    const timeline = await bb.sdk.threads.timeline({ threadId, includeNestedRows: "true", segmentLimit: "20", signal });
    let found: { id: string; turnId: string | null } | null = null;
    for (const { row, turnId } of walk(timeline.rows)) {
      if (row.kind === "conversation" && row.role === "assistant" && typeof row.id === "string") found = { id: row.id, turnId };
    }
    return found;
  }

  function describe(row: ExplainerRow): string {
    const explainer = service.view(row);
    const title = `${explainer.emoji} ${explainer.label}`;
    if (explainer.job && service.isRunning(explainer.id)) {
      return `${title}: ${explainer.job.label} (${Math.round(explainer.job.progress)}%). Explainer id ${explainer.id}; it will be saved in Pages under Explore.`;
    }
    if (explainer.href) {
      const followUps = explainer.followUps.length ? `\nIt suggests exploring next: ${explainer.followUps.map((item) => `${item.emoji} ${item.label}`).join(" | ")}` : "";
      return `Explainer ready: [${explainer.label}](${explainer.href}) (id ${explainer.id}, page ${explainer.pageId}).${followUps}`;
    }
    return `${title}: ${explainer.error ?? "not written yet"} (id ${explainer.id}).`;
  }

  bb.agents.registerTool({
    name: EXPLORE_TOOL,
    description:
      'Write (or find) an Explore explainer: a Studio Page that investigates one finding in the repository, like "How the job queue works". ' +
      "Returns the page link. Use it when the user asks you to explore or explain something you noticed. Waits for the page unless wait is false.",
    presentation: { label: { pending: "Exploring", completed: "Explored" } },
    parameters: z.object({
      label: z.string().trim().min(1).max(MAX_LABEL_LENGTH * 2).describe('An emoji and a specific label, e.g. "🏗️ How the job queue works".'),
      messageId: z.string().min(1).max(200).optional().describe("The assistant message the finding came from. Defaults to the newest one in this thread."),
      wait: z.boolean().optional(),
    }),
    async execute({ label, messageId, wait }, context) {
      const anchor = messageId ? { id: messageId, turnId: null } : await latestAssistantMessage(context.threadId, context.signal);
      if (!anchor) return { content: [{ type: "text", text: "There's no answer in this thread to explore from yet." }], isError: true };
      const { explainer } = service.explore({ threadId: context.threadId, messageId: anchor.id, turnId: anchor.turnId, projectId: context.projectId, label });
      const settled = wait === false ? explainer : ((await service.settled(explainer.id, context.signal)) ?? explainer);
      const failed = !settled.page_id && settled.status === "error";
      return failed ? { content: [{ type: "text", text: describe(settled) }], isError: true } : describe(settled);
    },
  });

  const instructions = exploreInstructions();

  // CLI: `bb explore …` -----------------------------------------------------------

  const line = (row: ExplainerRow) => {
    const explainer = service.view(row);
    const state = service.isRunning(row.id) ? `${STAGES[explainer.job?.status ?? "queued"].label} ${Math.round(explainer.job?.progress ?? 0)}%` : explainer.status;
    return [explainer.id, state, `${explainer.emoji} ${explainer.label}`, explainer.href ?? "", explainer.threadId].join("\t");
  };

  async function cli(argv: string[], ctx: PluginCliContext): Promise<CliResult> {
    const { command, rest } = subcommand(argv);
    const flags = parseFlags(rest, ["wait"]);
    const positional = rest.filter((arg) => !arg.startsWith("--"));
    const fail = (message: string): CliResult => ({ exitCode: 1, stderr: `${message}\n` });
    switch (command) {
      case "list": {
        const threadId = flags.values.thread;
        if (threadId === "") return fail(`usage: ${USAGE.list}`);
        const rows = store.list({ threadId, limit: 200 });
        return { exitCode: 0, stdout: rows.length ? `${rows.map(line).join("\n")}\n` : "No explainers.\n" };
      }
      case "open": {
        const row = await service.checkPage(positional[0] ?? "");
        if (!row) return fail(`usage: ${USAGE.open}`);
        return { exitCode: 0, stdout: `${describe(row)}\n` };
      }
      case "regenerate": {
        const id = positional[0] ?? "";
        if (!store.explainer(id)) return fail(`usage: ${USAGE.regenerate}`);
        service.regenerate(id);
        if (flags.values.wait === undefined) return { exitCode: 0, stdout: `${line(mustGet(id))}\n` };
        const settled = (await service.settled(id, ctx.signal)) ?? mustGet(id);
        return { exitCode: settled.status === "error" || !settled.page_id ? 1 : 0, stdout: `${describe(settled)}\n` };
      }
      default:
        return fail(`usage: ${EXPLORE_USAGE}\n  ${USAGE.list}\n  ${USAGE.open}\n  ${USAGE.regenerate}`);
    }
  }

  bb.onDispose(() => {
    clearInterval(digestTimer);
    service.dispose();
    workers.dispose();
  });

  return {
    service,
    rpc,
    cli,
    /** What `bb.agents.configure` gives a thread: the tool, and the instructions when the setting is on. */
    configure: (enabled: boolean) => ({ tools: [EXPLORE_TOOL], skills: [], ...(enabled ? { instructions } : {}) }),
  };
}
