// Explore (experimental), built into Studio: agents end answers that read code
// with a few things they noticed along the way; a click asks the agent about
// one in the thread. With the Next row on (the default), those findings share
// one end-of-reply line with quick replies and actions (next.ts).
//
// Explore ran inside the Studio Pages plugin until Pages was built into
// Studio. Its settings keep their keys (`explore_next`, `explore_explore`,
// `explore_quickReplies`, `explore_replyItems`) on Studio's settings page, its
// click log (`next_suggestions`) moved from Pages' explore.db into Studio's
// database, and `bb pages explore stats` is `bb studio pages explore stats`.
// The work is in register.ts; this wires it into Studio.
import { errorMessage } from "../kit/format";
import { usage } from "../kit/cli";
import type { BbPluginApi, PluginCliContext, PluginCliResult } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { rpcContract } from "./contract";
import { EXPLORE_USAGE, registerExplore } from "./register";
import { preferredReplies } from "./next";
import { DEFAULT_REPLIES, nextInstructions } from "./prompt";

/** Explore's settings as Studio defines them (kit PAGES_SETTINGS). */
export interface ExploreSettingValues {
  explore_next?: unknown;
  explore_explore?: unknown;
  explore_quickReplies?: unknown;
  explore_replyItems?: unknown;
}

export interface BuiltinExplore {
  /** What every agent session is told: the Next row's or Explore's instructions, or nothing. */
  instructions(): string | null;
  /** `bb studio pages explore …` */
  cli(argv: string[], ctx: PluginCliContext): Promise<PluginCliResult>;
}

/** Registers Explore's RPC on Studio. Studio has run NEXT_LOG_MIGRATIONS on `db`. */
export function registerExploreBuiltin(bb: BbPluginApi, db: Database.Database, initial: ExploreSettingValues): BuiltinExplore & { update(values: ExploreSettingValues): void } {
  // `bb.agents.configure` is synchronous, so keep the latest values in memory.
  let enabled = initial.explore_explore !== false;
  let nextEnabled = initial.explore_next !== false;
  let replies = repliesFrom(initial);
  const explore = registerExplore(db);
  bb.rpc.register(rpcContract, explore.rpc);
  return {
    update(next) {
      enabled = next.explore_explore !== false;
      nextEnabled = next.explore_next !== false;
      replies = repliesFrom(next);
    },
    instructions() {
      return explore.configure(enabled, nextEnabled ? nextInstructions({ explore: enabled, replies }) : null).instructions ?? null;
    },
    async cli(argv, ctx) {
      if (!argv.length) return usage(EXPLORE_USAGE);
      try {
        return await explore.cli(argv, ctx);
      } catch (error) {
        return { exitCode: 1, stderr: `${errorMessage(error)}\n` };
      }
    },
  };
}

/** The Next row's quick replies: null when they're off, else the preferred ones (empty for none). */
export function repliesFrom(values: { explore_quickReplies?: unknown; explore_replyItems?: unknown }): readonly string[] | null {
  if (values.explore_quickReplies === false) return null;
  return preferredReplies(values.explore_replyItems) ?? DEFAULT_REPLIES;
}
