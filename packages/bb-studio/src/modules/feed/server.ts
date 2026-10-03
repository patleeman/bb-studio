// Studio Feed: one feed of what agents report. A reply that ends with a
// `::post{…}` line is published, from any thread, channel or automation.
// The work is in src/register.ts; this wires it into BB.
import { usage } from "@bb-studio/kit/cli";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./src/contract";
import { FEED_USAGE, registerFeed } from "./src/register";
import type { NotifyMode } from "./src/service";

const NOTIFY_MODES = ["urgent", "all", "off"] as const;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    instructions: {
      type: "boolean",
      label: "Tell agents how to post",
      description:
        "Agents get the feed_post tool and post when their task or automation asks them to, or a run has a result worth reading later. Turn off to stop agents posting. Applies to agent sessions started after the change.",
      default: true,
    },
    notify: {
      type: "select",
      label: "Phone notifications",
      options: [...NOTIFY_MODES],
      default: "urgent",
      description: "Notify your phone (with Studio Mobile) for \"urgent\" posts only, \"all\" posts and story updates, or \"off\".",
    },
  });
  // `bb.agents.configure` is synchronous, so keep the latest values in memory.
  const read = (values: Record<string, unknown>) => ({
    enabled: values.instructions !== false,
    notify: (NOTIFY_MODES as readonly unknown[]).includes(values.notify) ? (values.notify as NotifyMode) : "urgent",
  });
  let current = read(await settings.get());
  settings.onChange((next) => {
    current = read(next);
  });

  const feed = registerFeed(bb, { notifyMode: () => current.notify });
  bb.rpc.register(rpcContract, feed.rpc);
  bb.agents.configure(() => feed.configure(current.enabled));

  bb.cli.register({
    name: "feed",
    summary: "Studio Feed: list, show, post, edit and remove posts",
    commands: [
      { name: "list", summary: "List posts, newest first (a story once)", usage: "bb studio feed list [--topic <topic>] [--limit <n>] [--all]" },
      { name: "show", summary: "Show a post, or every post in a story", usage: "bb studio feed show <post id | story>" },
      { name: "post", summary: "Publish a post", usage: 'bb studio feed post --title "<title>" [--body "<markdown>"] [--topic <topic>] [--story <story>] [--urgent] [--author <name>]' },
      { name: "edit", summary: "Edit a post, or mark it resolved", usage: "bb studio feed edit <post id> [--title <title>] [--body <markdown>] [--topic <topic>] [--resolve | --reopen]" },
      { name: "remove", summary: "Remove a post", usage: "bb studio feed remove <post id>" },
    ],
    async run(argv, ctx) {
      if (!argv.length) return usage(FEED_USAGE);
      try {
        return await feed.cli(argv, ctx);
      } catch (error) {
        return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
      }
    },
  });
}

export async function registerServer(ctx: import("../runtime").ModuleContext) { await plugin(ctx.bb); }
