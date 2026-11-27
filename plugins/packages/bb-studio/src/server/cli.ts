import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { readFile as readTextFile, stat as statPath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import { ACCOUNTS_USAGE, accountsCli } from "../accounts/cli";
import type { registerAccounts } from "../accounts/register";
import type { registerArtifacts } from "../artifacts/server";
import { AUTH_USAGE, authCli } from "../auth/cli";
import type { AuthService } from "../auth/service";
import { backupFileName } from "../backup/register";
import { formatBackup, formatRestore, restoreFailed, type BackupService } from "../backup/service";
import { parseCliArgs, type CliSpec } from "../cli-args";
import { studioCliName, studioCliRegistration } from "../cli-name";
import type { StarredItemView } from "../contract";
import type { registerDecisions } from "../decisions/server";
import type { registerDesign } from "../design/server";
import type { registerDraw } from "../draw/server";
import type { registerExploreBuiltin } from "../explore/server";
import type { HealthMonitor } from "../health";
import { errorText, type StudioHub } from "../hub";
import { subcommand, usage } from "../kit/cli";
import { relativeTime } from "../kit/format";
import type { registerMinis } from "../minis/server";
import type { registerPages } from "../pages/server";
import { runPresenceCli } from "../presence/cli";
import type { PresenceService } from "../presence/service";
import type { SearchIndex } from "../search-index";
import { settingsCli, SETTINGS_USAGE } from "../settings/cli";
import { formatSetup, type SetupService } from "../setup";
import { STRANDS_USAGE } from "../strands/cli";
import type { registerStrands } from "../strands/register";
import type { registerTalk } from "../talk/server";
import { runThemeCli } from "../theme/cli";
import type { ForestWeather } from "../theme/forest/weather";
import type { ThemeService } from "../theme/service";
import { readPreview, readView, writePreview, writeView } from "../theme/tonight/contract";
import type { ToolGateway } from "../tool-gateway/server/register";
import { botCli, BOT_USAGE, moveProviderCli, MOVE_USAGE, runnerCli, RUNNER_USAGE, toolDeliveryCli, TOOL_DELIVERY_USAGE } from "../move-provider/cli";
import type { MoveProviderService } from "../move-provider/service";
import type { ToolDeliveryStore } from "../tool-delivery";

const MAX_LISTED = 100;

/** A CLI argument as query text: the shell took the quotes off `project:"Q4 launch"`. */
function queryArg(arg: string): string {
  if (!/\s/.test(arg) || arg.includes('"')) return arg;
  const filter = /^(-?[a-z]+:)(.*)$/i.exec(arg);
  return filter ? `${filter[1]}"${filter[2]}"` : `"${arg}"`;
}

/** A CLI path, relative to where the command ran. */
const cliPath = (path: string, cwd: string | undefined) => (isAbsolute(path) ? path : resolvePath(cwd ?? homedir(), path));

export interface StudioCliDeps {
  bb: BbPluginApi;
  hub: StudioHub;
  moveProvider: MoveProviderService;
  toolDelivery: ToolDeliveryStore;
  studioSettings: Parameters<typeof settingsCli>[1];
  decisions: Awaited<ReturnType<typeof registerDecisions>>;
  auth: AuthService;
  accounts: ReturnType<typeof registerAccounts>;
  artifacts: ReturnType<typeof registerArtifacts>;
  drawings: ReturnType<typeof registerDraw>;
  designs: ReturnType<typeof registerDesign>;
  minis: ReturnType<typeof registerMinis>;
  recordings: Awaited<ReturnType<typeof registerTalk>>;
  presenceService: PresenceService;
  themeService: ThemeService;
  forestWeather: ForestWeather;
  strands: ReturnType<typeof registerStrands>;
  toolGateway: ToolGateway | null;
  explore: ReturnType<typeof registerExploreBuiltin>;
  pages: ReturnType<typeof registerPages>;
  health: HealthMonitor;
  setup: SetupService;
  backups: BackupService;
  searchIndex: SearchIndex;
  selfBot: (threadId: string | undefined) => Promise<string | undefined>;
  themeBot: (ref: string | null | undefined, fallback: string | undefined) => { id: string; name: string } | string;
  listItems: (options: { projectId: string | null; threadId?: string; all: boolean; kind?: string; tag?: string; query?: string }) => Promise<{ picked: unknown[] } & Record<string, unknown>>;
  formatList: (result: never) => string;
  overview: () => Promise<{ items: { tags: string[] }[]; tags: { id: string; name: string }[] }>;
  starredItems: () => Promise<StarredItemView[]>;
  resolveProject: (ref: string) => Promise<string | null>;
  moveItemsReport: (refs: readonly string[], target: { projectId: string | null }, label: string) => Promise<string[]>;
}

/** Registers the `bb studio` / `bbs` CLI command suite. */
export function registerStudioCli({
  bb,
  hub,
  moveProvider,
  toolDelivery,
  studioSettings,
  decisions,
  auth,
  accounts,
  artifacts,
  drawings,
  designs,
  minis,
  recordings,
  presenceService,
  themeService,
  forestWeather,
  strands,
  toolGateway,
  explore,
  pages,
  health,
  setup,
  backups,
  searchIndex,
  selfBot,
  themeBot,
  listItems,
  formatList,
  overview,
  starredItems,
  resolveProject,
  moveItemsReport,
}: StudioCliDeps): void {
  bb.cli.register(studioCliRegistration({
    name: "studio",
    summary: "BB Studio: pages, recordings, drawings, designs, artifacts and other add-ons' items",
    commands: [
      { name: "settings", summary: "List, read and change Studio's settings (API keys: bb plugin config studio)", usage: SETTINGS_USAGE },
      { name: "decisions", summary: "Jev, fallback model and Smart Queue", usage: "bb studio decisions <status|recent|classify|check|fallback>" },
      { name: "list", summary: "List items in the current project and global ones", usage: "bb studio list [query…] [--all] [--json], e.g. bb studio list kind:page -tag:draft pricing, or family:app for every app" },
      { name: "tags", summary: "List tags and how many items have each", usage: "bb studio tags" },
      { name: "starred", summary: "List starred items, newest-starred first", usage: "bb studio starred [--json]" },
      { name: "move", summary: "Move items to a project", usage: "bb studio move <item-link|plugin:id>… --project <name|id|global>" },
      { name: "providers", summary: "Show which Studio add-ons are installed and ready", usage: "bb studio providers" },
      { name: "health", summary: "Check every plugin for setup problems and failures", usage: "bb studio health [--json]" },
      { name: "auth", summary: "Show signed-out providers and Account Pooler accounts, and sign in again", usage: AUTH_USAGE },
      { name: "accounts", summary: "Every Account Pooler account (BB Studio's and bb's) and local login: status, quota, pinned threads and warnings", usage: ACCOUNTS_USAGE },
      { name: "setup", summary: "Show which BB Studio add-ons are installed and working, and the commands to finish setup", usage: "bb studio setup [--json]" },
      { name: "reindex", summary: "Rebuild the Studio search index", usage: "bb studio reindex" },
      { name: "backup", summary: "Save every Studio item, from every add-on, into one .zip file", usage: "bb studio backup [--out <file|folder>]" },
      { name: "restore", summary: "Restore a Studio backup; shows what would change first", usage: "bb studio restore <file> [--dry-run | --yes]" },
      { name: "artifacts", summary: "Save and read artifacts: save, list, show, export, delete", usage: "bb studio artifacts <save|list|show|export|delete> …" },
      { name: "whiteboards", summary: "Create, read and edit whiteboards (old name: drawings)", usage: "bb studio whiteboards <list|create|show|rename|delete|merge|remove-elements> …" },
      { name: "designs", summary: "List and read designs: list, show, html, rename, delete", usage: "bb studio designs <list|show|html|rename|delete> …" },
      { name: "recordings", summary: "Read Talk recordings and their transcripts: list, show, transcript, notes", usage: "bb studio recordings <list|show|transcript|notes> …" },
      { name: "pages", summary: "Read and write pages: list, show, create, append; explore stats for the Next row", usage: "bb studio pages <list|show|create|append|explore> …" },
      { name: "minis", summary: "List mini apps, read their records and state, and run their actions", usage: "bb studio minis <list|show|data|state|watch|actions|do> …" },
      { name: "theme", summary: "List, show, check, create, update, apply and delete Bot themes", usage: "bb studio theme <list|show|create|update|apply|check|delete|template> …" },
      { name: "presence", summary: "List, show, check, create, update, apply and delete Bot presences", usage: "bb studio presence <list|show|create|update|apply|check|delete|template> …" },
      { name: "tool-gateway", summary: "Your MCP servers: list them, search and run their tools, and ask the user to add one", usage: "bb studio tool-gateway <list|tools|describe|call|request|status> …" },
      { name: "move-provider", summary: "Move threads to another provider with their history; status and verify", usage: MOVE_USAGE },
      { name: "bot", summary: "A Bot's default model for new conversations", usage: BOT_USAGE },
      { name: "runner", summary: "Move runners' threads to another provider", usage: RUNNER_USAGE },
      { name: "tool-delivery", summary: "How each provider's sessions get Studio's on-demand tools", usage: TOOL_DELIVERY_USAGE },
      { name: "strands", summary: "A conversation's strands (its lines of work), their live states, and how its newest messages were sorted", usage: STRANDS_USAGE },
    ],
    async run(argv, ctx) {
      // Built-in kinds' commands (`bb artifacts …` before the merge).
      if (argv[0] === "settings") return settingsCli(argv.slice(1), studioSettings);
      if (argv[0] === "decisions") return decisions.cli(argv.slice(1));
      if (argv[0] === "auth") return authCli(argv.slice(1), auth, { signal: ctx.signal });
      if (argv[0] === "accounts") return accountsCli(argv.slice(1), { accounts: accounts.service, auth }, { signal: ctx.signal });
      if (argv[0] === "artifacts") return artifacts.cli(argv.slice(1), ctx);
      // `drawings` is the old name of `whiteboards`; both stay.
      if (argv[0] === "whiteboards" || argv[0] === "drawings") return drawings.cli(argv.slice(1), ctx);
      if (argv[0] === "designs") return designs.cli(argv.slice(1), ctx);
      if (argv[0] === "minis") return minis.cli(argv.slice(1));
      if (argv[0] === "recordings") return recordings.cli(argv.slice(1));
      if (argv[0] === "presence") return runPresenceCli(argv.slice(1), { service: presenceService, readFile: (path) => readTextFile(cliPath(path, ctx.cwd), "utf8"), resolveBot: async (ref) => themeBot(ref, await selfBot(ctx.threadId ?? undefined)) });
      if (argv[0] === "theme") return runThemeCli(argv.slice(1), { service: themeService, readFile: (path) => readTextFile(cliPath(path, ctx.cwd), "utf8"), resolveBot: async (ref) => themeBot(ref, await selfBot(ctx.threadId ?? undefined)), weather: { sky: () => forestWeather.sky(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null), setCity: (city) => forestWeather.setCity(city) }, sky: { place: () => forestWeather.place(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null), preview: () => readPreview(bb.storage.kv), setPreview: (at) => writePreview(bb.storage.kv, at), view: () => readView(bb.storage.kv), setView: (view) => writeView(bb.storage.kv, view), now: () => Date.now(), zoneOffsetMinutes: () => -new Date().getTimezoneOffset() } });
      if (argv[0] === "strands") return strands.cli(argv.slice(1), ctx);
      if (argv[0] === "move-provider" || argv[0] === "bot" || argv[0] === "runner" || argv[0] === "tool-delivery") {
        const moveDeps = { service: moveProvider, toolDelivery, callerThreadId: ctx.threadId ?? null };
        if (argv[0] === "move-provider") return moveProviderCli(argv.slice(1), moveDeps);
        if (argv[0] === "bot") return botCli(argv.slice(1), moveDeps);
        if (argv[0] === "tool-delivery") return toolDeliveryCli(argv.slice(1), moveDeps);
        return runnerCli(argv.slice(1), { ...moveDeps, runners: (botRef) => moveProvider.runners(botRef) });
      }
      if (argv[0] === "tool-gateway") return toolGateway ? toolGateway.cli(argv.slice(1), { threadId: ctx.threadId ?? null }) : { exitCode: 1, stderr: "Tool Gateway isn't loaded.\n" };
      if (argv[0] === "pages") return argv[1] === "explore" ? explore.cli(argv.slice(2), ctx) : pages.cli(argv.slice(1), ctx);
      const { command, rest: raw } = subcommand(argv);
      const USAGE: Record<string, string> = {
        list: "bb studio list [query…] [--all] [--json] [--kind <kind>] [--tag <tag>] [--query <text>]",
        move: "bb studio move <item-link|plugin:id>… --project <name|id|global>",
        backup: "bb studio backup [--out <file|folder>]",
        restore: "bb studio restore <file> [--dry-run | --yes]",
      };
      const SPECS: Record<string, CliSpec> = {
        list: { flags: ["--json", "--all"], options: ["--kind", "--tag", "--query"] },
        starred: { flags: ["--json"] },
        health: { flags: ["--json"] },
        setup: { flags: ["--json"] },
        move: { options: ["--project"] },
        backup: { options: ["--out"] },
        restore: { flags: ["--dry-run", "--yes"] },
      };
      const parsed = parseCliArgs(raw, SPECS[command ?? ""] ?? {});
      const known = ["list", "tags", "starred", "move", "providers", "health", "setup", "reindex", "backup", "restore"].includes(command ?? "");
      if (!parsed.ok && known) return usage(`${USAGE[command!] ?? `bb studio ${command}`}\n${parsed.error}`);
      const rest = parsed.ok ? parsed.positional : [];
      const flag = (name: string) => parsed.ok && parsed.flags.has(name);
      const option = (name: string) => (parsed.ok ? parsed.options.get(name) : undefined);
      try {
        switch (command) {
          case "list": {
            const json = flag("--json");
            const options = { all: flag("--all"), kind: option("--kind"), tag: option("--tag"), query: option("--query") };
            const query = [options.query, ...rest.map(queryArg)].filter(Boolean).join(" ");
            const result = await listItems({ projectId: ctx.projectId ?? null, threadId: ctx.threadId ?? undefined, ...options, query });
            if (json) return { exitCode: 0, stdout: `${JSON.stringify(result.picked.slice(0, MAX_LISTED), null, 2)}\n` };
            return { exitCode: 0, stdout: `${formatList(result as never)}\n` };
          }
          case "tags": {
            const { items, tags: allTags } = await overview();
            if (!allTags.length) return { exitCode: 0, stdout: "No tags yet.\n" };
            const lines = allTags.map((tag) => `#${tag.name}\t${items.filter((item) => item.tags.includes(tag.id)).length}`);
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "starred": {
            const starred = await starredItems();
            if (flag("--json")) return { exitCode: 0, stdout: `${JSON.stringify(starred, null, 2)}\n` };
            if (!starred.length) return { exitCode: 0, stdout: "No starred items. Star one from its header or its row's menu.\n" };
            return { exitCode: 0, stdout: `${starred.map((item) => `${item.icon ? `${item.icon} ` : ""}${item.title} (${item.kind}, starred ${relativeTime(item.starredAt)}) ${item.href}`).join("\n")}\n` };
          }
          case "move": {
            const project = option("--project");
            if (!rest.length || !project) return usage(USAGE.move!);
            const projectId = await resolveProject(project);
            const lines = await moveItemsReport(rest, { projectId }, projectId ? `Project ${project}` : "Global");
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "providers": {
            const providers = await hub.providers();
            if (!providers.length) return { exitCode: 0, stdout: `No Studio kinds are ready. Reload Studio: ${studioCliName()} plugin reload studio\n` };
            const lines = providers.map(
              (provider) =>
                `${provider.pluginId}\t${provider.state}\t${provider.kinds.map((kind) => kind.id).join(",") || "-"}${provider.detail ? `\t${provider.detail}` : ""}`,
            );
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "health": {
            const summary = await health.check();
            if (flag("--json")) return { exitCode: 0, stdout: `${JSON.stringify(summary, null, 2)}\n` };
            const lines = [
              ...summary.problems.map((problem) => `${problem.status}\t${problem.pluginId}\t${problem.title}${problem.hidden ? " (hidden)" : ""}${problem.detail ? `\n\t\t${problem.detail}` : ""}`),
              ...summary.unanswered.map((entry) => `unknown\t${entry.pluginId}\tIts health check didn't answer: ${entry.error}`),
              ...summary.healthy.map((entry) => `ok\t${entry.pluginId}\t${entry.titles.join("; ")}`),
            ];
            return { exitCode: summary.problems.some((problem) => !problem.hidden) ? 1 : 0, stdout: `${lines.join("\n") || "No problems found."}\n` };
          }
          case "setup": {
            const summary = await setup.summary(0);
            return { exitCode: 0, stdout: flag("--json") ? `${JSON.stringify(summary, null, 2)}\n` : formatSetup(summary) };
          }
          case "backup": {
            if (rest.length) return usage(USAGE.backup!);
            const requested = option("--out");
            let out = cliPath(requested ?? backupFileName(), ctx.cwd);
            if (requested && (await statPath(out).catch(() => null))?.isDirectory()) out = join(out, backupFileName());
            if (await statPath(out).catch(() => null)) return { exitCode: 1, stderr: `${out} already exists; choose another --out.\n` };
            const summary = await backups.backup(out);
            const failed = summary.manifest.sections.some((section) => section.status === "failed");
            return { exitCode: failed ? 1 : 0, stdout: formatBackup(summary) };
          }
          case "restore": {
            if (rest.length !== 1 || (flag("--dry-run") && flag("--yes"))) return usage(USAGE.restore!);
            // Without --yes it only shows what would change.
            const dryRun = !flag("--yes");
            const summary = await backups.restore(cliPath(rest[0]!, ctx.cwd), { dryRun });
            const text = formatRestore(summary) + (dryRun ? "Run again with --yes to restore.\n" : "");
            return { exitCode: restoreFailed(summary) ? 1 : 0, stdout: text };
          }
          case "reindex": {
            const count = await searchIndex.rebuild();
            return { exitCode: 0, stdout: `Indexed ${count} Studio items.\n` };
          }
          default:
            return usage("bb studio <list|tags|starred|move|providers|health|setup|reindex|backup|restore|pages|artifacts|whiteboards|designs|recordings|minis|theme|presence|decisions|tool-gateway> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  }));
}
