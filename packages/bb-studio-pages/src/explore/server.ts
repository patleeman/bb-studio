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
import { preferredReplies } from "./src/next";
import { DEFAULT_REPLIES, nextInstructions } from "./src/prompt";

/** Explore's settings; Pages defines them under an `explore_` prefix. */
export const EXPLORE_SETTINGS = {
    next: {
      type: "boolean",
      label: "End replies with a Next row",
      description:
        "Agents end replies with one row of next steps: quick replies, things to explore, and actions they can take. Applies to agent sessions started after the change.",
      default: true,
    },
    explore: {
      type: "boolean",
      label: "Suggest things to explore",
      description:
        "Agents end answers that involved reading code with a few things they noticed along the way, in the Next row when it's on. Click one to ask the agent about it. Applies to agent sessions started after the change.",
      default: true,
    },
    quickReplies: {
      type: "boolean",
      label: "Offer quick replies",
      description:
        "When a reply asks you something, the Next row offers quick answers to it. Applies to agent sessions started after the change.",
      default: true,
    },
    replyItems: {
      type: "string",
      label: "Preferred quick replies",
      description:
        "Emoji and label pairs, such as \"👍 Looks good\", separated by commas or lines. Agents use these when they fit and write specific ones otherwise. Applies to agent sessions started after the change.",
      default: DEFAULT_REPLIES.join(", "),
    },
} satisfies Record<string, PluginSettingDescriptor>;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(EXPLORE_SETTINGS);
  // `bb.agents.configure` is synchronous, so keep the latest values in memory.
  const initial = await settings.get();
  let enabled = initial.explore !== false;
  let nextEnabled = initial.next !== false;
  let replies = repliesFrom(initial);
  settings.onChange((next) => {
    enabled = next.explore !== false;
    nextEnabled = next.next !== false;
    replies = repliesFrom(next);
  });
  const explore = registerExplore(bb);

  bb.rpc.register(rpcContract, explore.rpc);

  bb.agents.configure(() => {
    return explore.configure(enabled, nextEnabled ? nextInstructions({ explore: enabled, replies }) : null);
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

/** The Next row's quick replies: null when they're off, else the preferred ones (empty for none). */
export function repliesFrom(values: { quickReplies?: unknown; replyItems?: unknown }): readonly string[] | null {
  if (values.quickReplies === false) return null;
  return preferredReplies(values.replyItems) ?? DEFAULT_REPLIES;
}
