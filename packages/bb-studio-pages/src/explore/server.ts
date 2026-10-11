// Explore (experimental): agents end answers that read code with a few things
// they noticed along the way; a click asks the agent about one in the thread.
// With the Next row on (the default), those findings share one end-of-reply
// line with quick replies and actions (src/next.ts).
// The work is in src/register.ts; this wires it into BB.
import { errorMessage } from "@bb-studio/kit/format";
import { usage } from "@bb-studio/kit/cli";
import type { BbPluginApi, PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { rpcContract } from "./src/contract";
import { EXPLORE_USAGE, registerExplore } from "./src/register";
import { repliesForSession, trackReactionReplies } from "./src/reactions";
import { DEFAULT_REPLIES, nextInstructions } from "./src/prompt";

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
        "Agents end answers that involved reading code with a few things they noticed along the way, in the Next row when it's on. Click one to ask the agent about it. Applies to agent sessions started after the change.",
      default: true,
    },
} satisfies Record<string, PluginSettingDescriptor>;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(EXPLORE_SETTINGS);
  // `bb.agents.configure` is synchronous, so keep the latest values in memory.
  const initial = await settings.get();
  let enabled = initial.explore !== false;
  let nextEnabled = initial.next !== false;
  settings.onChange((next) => {
    enabled = next.explore !== false;
    nextEnabled = next.next !== false;
  });
  const explore = registerExplore(bb);

  // The Next row's quick replies follow Studio Reactions' smart reactions
  // setting. Settings are read asynchronously and `configure` is synchronous,
  // so keep the answer fresh.
  const replies = trackReactionReplies(bb.sdk, DEFAULT_REPLIES, undefined, bb.storage.kv);
  bb.onDispose(() => replies.dispose());

  bb.rpc.register(rpcContract, explore.rpc);

  bb.agents.configure(() => {
    // Recheck for the next session; this one uses the latest answer.
    void replies.refresh();
    // Nothing known yet (no successful check and no saved answer): no replies, as Reactions' default.
    return explore.configure(enabled, nextEnabled ? nextInstructions({ explore: enabled, replies: repliesForSession(replies.current()) }) : null);
  });

  bb.cli.register({
    name: "explore",
    summary: "Explore: how often each kind of Next suggestion is clicked",
    commands: [
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
