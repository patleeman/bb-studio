// Explore (experimental): agents end answers that read code with a few things
// they noticed along the way; a click writes a Studio Page explaining one.
// With the Next row on (the default), those findings share one end-of-reply
// line with quick replies and actions (src/next.ts).
// The work is in src/register.ts; this wires it into BB.
import { errorMessage } from "@bb-studio/kit/format";
import { usage } from "@bb-studio/kit/cli";
import type { BbPluginApi, PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./src/contract";
import { EXPLORE_USAGE, registerExplore } from "./src/register";
import { isExploreWorker } from "./src/worker";
import { preferredReplies, REACTIONS_PLUGIN_ID } from "./src/next";
import { DEFAULT_REPLIES, nextInstructions } from "./src/prompt";

/** How often the Next row rereads Studio Reactions' saved replies. */
const REPLIES_REFRESH_MS = 60_000;

/** Explore's settings; Pages defines them under an `explore_` prefix. */
export const EXPLORE_SETTINGS = {
    next: {
      type: "boolean",
      label: "End replies with a Next row",
      description:
        "Agents end replies with one row of next steps: quick replies, things to explore, and actions they can take. Replaces Studio Reactions' smart reactions while it's on. Applies to agent sessions started after the change.",
      default: true,
    },
    explore: {
      type: "boolean",
      label: "Suggest things to explore",
      description:
        "Agents end answers that involved reading code with a few things they noticed along the way, in the Next row when it's on. Click one to get a page explaining it. Applies to agent sessions started after the change.",
      default: true,
    },
    workerTimeoutMinutes: {
      type: "number",
      label: "Explainer time limit (minutes)",
      description: "Stop and archive an unfinished explainer after 1 to 120 minutes. Applies to new explainers; their model follows the source thread.",
      default: 20,
      experimental_schema: z.number().int().min(1).max(120),
    },
} satisfies Record<string, PluginSettingDescriptor>;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(EXPLORE_SETTINGS);
  // `bb.agents.configure` is synchronous, so keep the latest values in memory.
  const initial = await settings.get();
  let enabled = initial.explore !== false;
  let nextEnabled = initial.next !== false;
  let workerTimeoutMinutes = initial.workerTimeoutMinutes;
  settings.onChange((next) => {
    enabled = next.explore !== false;
    nextEnabled = next.next !== false;
    workerTimeoutMinutes = next.workerTimeoutMinutes;
  });
  const explore = registerExplore(bb, {
    workerTimeoutMs: () => workerTimeoutMinutes * 60_000,
  });

  // The Next row prefers the replies saved in Studio Reactions. Settings are
  // read asynchronously and `configure` is synchronous, so keep them fresh.
  let replies = DEFAULT_REPLIES;
  const refreshReplies = () =>
    Promise.resolve().then(() => bb.sdk.plugins.getSettings({ pluginId: REACTIONS_PLUGIN_ID, signal: AbortSignal.timeout(10_000) })).then(
      (result) => { replies = preferredReplies(result.values.emojiItems) ?? DEFAULT_REPLIES; },
      () => { replies = DEFAULT_REPLIES; },
    );
  void refreshReplies();
  const timer = setInterval(() => void refreshReplies(), REPLIES_REFRESH_MS);
  timer.unref?.();
  bb.onDispose(() => clearInterval(timer));

  bb.rpc.register(rpcContract, explore.rpc);

  // Explore workers write a page as their reply: no findings line, no explore tool.
  bb.agents.configure((context) =>
    isExploreWorker(context.pluginMetadata)
      ? { tools: [], skills: [] }
      : explore.configure(enabled, nextEnabled ? nextInstructions({ explore: enabled, replies }) : null),
  );

  bb.cli.register({
    name: "explore",
    summary: "Explore explainers: list, open (link, state, follow-ups), regenerate in place",
    commands: [
      { name: "list", summary: "List explainers, newest first", usage: "bb pages explore list [--thread <thread id>]" },
      { name: "open", summary: "Show an explainer's page link, state and follow-ups", usage: "bb pages explore open <explainer id>" },
      { name: "regenerate", summary: "Write an explainer again, in place", usage: "bb pages explore regenerate <explainer id> [--wait]" },
      { name: "stats", summary: "How often each kind of Next suggestion is clicked", usage: "bb pages explore stats [--days <days>]" },
    ],
    async run(argv, ctx) {
      if (!argv.length) return usage(EXPLORE_USAGE);
      try {
        return await explore.cli(argv, ctx);
      } catch (error) {
        return { exitCode: 1, stderr: `${errorMessage(error)}\n` };
      }
    },
  });
}
