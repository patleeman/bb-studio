// Explore (experimental): agents end answers that read code with a few things
// they noticed along the way; a click writes a Studio Page explaining one.
// The work is in src/register.ts; this wires it into BB.
import { usage } from "@bb-studio/kit/cli";
import type { BbPluginApi, PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./src/contract";
import { EXPLORE_USAGE, registerExplore } from "./src/register";
import { isExploreWorker } from "./src/worker";

/** Explore's settings; Pages defines them under an `explore_` prefix. */
export const EXPLORE_SETTINGS = {
    explore: {
      type: "boolean",
      label: "Suggest things to explore",
      description:
        "Agents end answers that involved reading code with a few things they noticed along the way. Click one to get a page explaining it. Applies to agent sessions started after the change.",
      default: true,
    },
    feedDigest: {
      type: "boolean",
      label: "Daily digest in Studio Feed",
      description: "Each evening, post what agents noticed that day and nobody explored or saved: one post per project. Needs Studio Feed.",
      default: true,
    },
    digestHour: {
      type: "number",
      label: "Daily digest hour",
      description: "Hour from 0 to 23 in the BB server's local time. When the daily digest is on, Explore checks every 10 minutes after this hour.",
      default: 18,
      experimental_schema: z.number().int().min(0).max(23),
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
  let feedDigest = initial.feedDigest !== false;
  let digestHour = initial.digestHour;
  let workerTimeoutMinutes = initial.workerTimeoutMinutes;
  settings.onChange((next) => {
    enabled = next.explore !== false;
    feedDigest = next.feedDigest !== false;
    digestHour = next.digestHour;
    workerTimeoutMinutes = next.workerTimeoutMinutes;
  });
  const explore = registerExplore(bb, {
    feedDigest: () => feedDigest,
    digestHour: () => digestHour,
    workerTimeoutMs: () => workerTimeoutMinutes * 60_000,
  });

  bb.rpc.register(rpcContract, explore.rpc);

  // Explore workers write a page as their reply: no findings line, no explore tool.
  bb.agents.configure((context) =>
    isExploreWorker(context.pluginMetadata) ? { tools: [], skills: [] } : explore.configure(enabled),
  );

  bb.cli.register({
    name: "explore",
    summary: "Explore explainers: list, open (link, state, follow-ups), regenerate in place",
    commands: [
      { name: "list", summary: "List explainers, newest first", usage: "bb pages explore list [--thread <thread id>]" },
      { name: "open", summary: "Show an explainer's page link, state and follow-ups", usage: "bb pages explore open <explainer id>" },
      { name: "regenerate", summary: "Write an explainer again, in place", usage: "bb pages explore regenerate <explainer id> [--wait]" },
    ],
    async run(argv, ctx) {
      if (!argv.length) return usage(EXPLORE_USAGE);
      try {
        return await explore.cli(argv, ctx);
      } catch (error) {
        return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
      }
    },
  });
}
