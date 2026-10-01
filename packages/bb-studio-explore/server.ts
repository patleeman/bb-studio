// Explore (experimental): agents end answers that read code with a few things
// they noticed along the way; a click writes a Studio Page explaining one.
// The work is in src/register.ts; this wires it into BB.
import { usage } from "@bb-studio/kit/cli";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./src/contract";
import { EXPLORE_USAGE, registerExplore } from "./src/register";
import { isExploreWorker } from "./src/worker";

export default async function plugin(bb: BbPluginApi) {
  const explore = registerExplore(bb);

  const settings = bb.settings.define({
    explore: {
      type: "boolean",
      label: "Suggest things to explore",
      description:
        "Agents end answers that involved reading code with a few things they noticed along the way. Click one to get a page explaining it. Applies to agent sessions started after the change.",
      default: true,
    },
  });
  // `bb.agents.configure` is synchronous, so keep the latest value in memory.
  let enabled = (await settings.get()).explore !== false;
  settings.onChange((next) => {
    enabled = next.explore !== false;
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
      { name: "list", summary: "List explainers, newest first", usage: "bb explore list [--thread <thread id>]" },
      { name: "open", summary: "Show an explainer's page link, state and follow-ups", usage: "bb explore open <explainer id>" },
      { name: "regenerate", summary: "Write an explainer again, in place", usage: "bb explore regenerate <explainer id> [--wait]" },
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
