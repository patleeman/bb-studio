import { parseFlags, subcommand } from "@bb-studio/kit/cli";
// Explore's server: agents end answers with what they noticed along the way
// (`::explore{items="…"}`, or the Next row's `btw` notes). This file adds the
// Next row's click log (RPC), the instructions for `bb.agents.configure`, and
// `bb pages explore stats`.
import type { BbPluginApi, PluginCliContext, PluginCliResult } from "@get-bb/plugin-sdk";
import { exploreInstructions } from "./prompt";
import { ExploreStore, MIGRATIONS, NEXT_LOG_DAYS } from "./store";
import type { NextKind } from "./next";

const USAGE = {
  stats: "bb pages explore stats [--days <days>]",
};
export const EXPLORE_USAGE = `bb pages explore stats …`;

const DAY_MS = 24 * 60 * 60 * 1000;
const percent = (clicked: number, shown: number) => (shown ? `${Math.round((clicked / shown) * 100)}%` : "-");

type CliResult = PluginCliResult;

export function registerExplore(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new ExploreStore(db);

  const rpc = {
    nextShown: (input: { threadId: string; messageId: string; items: { kind: NextKind; emoji: string; label: string }[] }) => {
      store.nextShown(input);
      return { ok: true as const };
    },
    nextClicked: (input: { threadId: string; messageId: string; kind: NextKind; emoji: string; label: string }) => {
      store.nextClicked(input);
      return { ok: true as const };
    },
  };

  const instructions = exploreInstructions();

  async function cli(argv: string[], _ctx: PluginCliContext): Promise<CliResult> {
    const { command, rest } = subcommand(argv);
    const flags = parseFlags(rest, []);
    const fail = (message: string): CliResult => ({ exitCode: 1, stderr: `${message}\n` });
    switch (command) {
      case "stats": {
        const days = flags.values.days === undefined ? 30 : Number(flags.values.days);
        if (!Number.isInteger(days) || days < 1 || days > NEXT_LOG_DAYS) return fail(`usage: ${USAGE.stats} (1 to ${NEXT_LOG_DAYS} days; older suggestions are not kept)`);
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

  return {
    rpc,
    cli,
    /** What `bb.agents.configure` gives a thread: the Next row's or Explore's instructions. */
    configure: (enabled: boolean, next: string | null = null) => {
      const text = next ?? (enabled ? instructions : null);
      return { tools: [], skills: [], ...(text ? { instructions: text } : {}) };
    },
  };
}
