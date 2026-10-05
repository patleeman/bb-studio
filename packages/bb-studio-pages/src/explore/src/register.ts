import { parseFlags, subcommand } from "@bb-studio/kit/cli";
// Explore's server: agents end answers with what they noticed along the way
// (`::explore{items="…"}`); a click writes a page explaining it.
//
//   - ExploreService (service.ts) runs each explainer's job; workers are
//     hidden forks of the thread (worker.ts); pages are written in Pages over
//     RPC, under the project's "Explore" page, and tagged in Studio (pages.ts).
//   - This file adds the RPC handlers, the `explore_explain` tool, the
//     instructions for `bb.agents.configure`, and `bb pages explore …`.
import type { BbPluginApi, PluginCliContext, PluginCliResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { explainerHtml } from "./markdown";
import { explorePages } from "./pages";
import { exploreInstructions } from "./prompt";
import { ExploreService } from "./service";
import { REALTIME_CHANNEL, type RealtimeEvent } from "./constants";
import { MAX_LABEL_LENGTH, STAGES } from "./shared";
import { ExploreStore, MIGRATIONS, type ExplainerRow } from "./store";
import { walk } from "./timeline";
import { exploreWorkers } from "./worker";
import type { NextKind } from "./next";

export const EXPLORE_TOOL = "explore_explain";

const USAGE = {
  list: "bb pages explore list [--thread <thread id>]",
  open: "bb pages explore open <explainer id>",
  regenerate: "bb pages explore regenerate <explainer id> [--wait]",
  stats: "bb pages explore stats [--days <days>]",
};
export const EXPLORE_USAGE = `bb pages explore <list|open|regenerate|stats> …`;

const DAY_MS = 24 * 60 * 60 * 1000;
const percent = (clicked: number, shown: number) => (shown ? `${Math.round((clicked / shown) * 100)}%` : "-");

type CliResult = PluginCliResult;

export function registerExplore(bb: BbPluginApi, options: {
  workerTimeoutMs?: () => number;
} = {}) {
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
    explore: ({ threadId, messageId, turnId, emoji, label, parentId }: { threadId: string; messageId: string; turnId?: string | null; emoji?: string; label: string; parentId?: string | null }) => {
      const result = service.explore({ threadId, messageId, turnId, emoji, label, parentId });
      return { explainer: service.view(result.explainer), started: result.started };
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
    nextShown: (input: { threadId: string; messageId: string; items: { kind: NextKind; emoji: string; label: string }[] }) => {
      store.nextShown(input);
      return { ok: true as const };
    },
    nextClicked: (input: { threadId: string; messageId: string; kind: NextKind; emoji: string; label: string }) => {
      store.nextClicked(input);
      return { ok: true as const };
    },
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

  // CLI: `bb pages explore …` -----------------------------------------------------------

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
      case "stats": {
        const days = flags.values.days === undefined ? 30 : Number(flags.values.days);
        if (!Number.isInteger(days) || days < 1) return fail(`usage: ${USAGE.stats}`);
        const stats = store.nextStats(Date.now() - days * DAY_MS);
        const kinds = stats.kinds.map((row) => [row.kind, row.shown, row.clicked, percent(row.clicked, row.shown)].join("\t"));
        const top = stats.top.map((row) => [row.kind, `${row.emoji} ${row.label}`, `${row.clicked}/${row.shown}`].join("\t"));
        const lines = [`Next row, last ${days} day${days === 1 ? "" : "s"}`, ["kind", "shown", "clicked", "rate"].join("\t"), ...kinds];
        if (top.length) lines.push("", "Most clicked", ...top);
        return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
      }
      default:
        return fail(`usage: ${EXPLORE_USAGE}\n  ${Object.values(USAGE).join("\n  ")}`);
    }
  }

  bb.onDispose(() => {
    service.dispose();
    workers.dispose();
  });

  return {
    service,
    rpc,
    cli,
    /** What `bb.agents.configure` gives a thread: the tool, and the Next row's or Explore's instructions. */
    configure: (enabled: boolean, next: string | null = null) => {
      const text = next ?? (enabled ? instructions : null);
      return { tools: [EXPLORE_TOOL], skills: [], ...(text ? { instructions: text } : {}) };
    },
  };
}
