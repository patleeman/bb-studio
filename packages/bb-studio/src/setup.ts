// BB Studio setup: which add-ons from this repository's marketplace are
// installed and working, what to run to finish, and which retired plugins can
// go. Studio's Setup page and `bb studio setup` both show this. Installs,
// enables and removes use BB's plugin SDK; every action also has the CLI
// command that does the same, for when the SDK call fails.
import { ARTIFACTS_BRIDGE_VERSION, bridgeStatusContract } from "@bb-studio/kit/artifacts-contract";
import { DRAW_BRIDGE_VERSION } from "@bb-studio/kit/draw-contract";
import { DESIGN_BRIDGE_VERSION } from "@bb-studio/kit/design-contract";
import { TALK_BRIDGE_VERSION } from "@bb-studio/kit/talk-contract";
import { PAGES_BRIDGE_VERSION } from "@bb-studio/kit/pages-contract";
import type { z } from "zod";
import type { HealthSummary, Problem } from "./health-contract";
import { ADDONS, MARKETPLACE_NAME, MARKETPLACE_SOURCE } from "./setup-addons";
import type { AddOnEntry, AddOnStatus, RetiredEntry, SetupActionResult, SetupSummary } from "./setup-contract";

export interface SetupPluginEntry {
  id: string;
  name: string | null;
  enabled: boolean;
  status: string;
  version: string;
}

interface InstallPlan {
  kind: string;
  compatible: boolean;
  incompatibleReason: string | null;
  resolvedSource?: unknown;
}

export interface SetupSdk {
  plugins: {
    list(): Promise<{ plugins: readonly SetupPluginEntry[] }>;
    enable(args: { pluginId: string }): Promise<unknown>;
    remove(args: { pluginId: string }): Promise<unknown>;
    callRpc<T>(args: { pluginId: string; method: string; input?: unknown; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T>;
    catalog: {
      installPlan(args: { entryId: string; marketplace?: string }): Promise<InstallPlan>;
      install(args: { entryId: string; marketplace?: string; confirmedSource?: never }): Promise<unknown>;
    };
    marketplaces: { list(): Promise<readonly { name: string }[]> };
  };
}

/** Add-ons left out of "Install all", and why. */
const OPTIONAL: Record<string, string> = {
  mobile: "Only needed for the BB Studio iOS app.",
};

export const installCommand = (id: string) => `bb plugin install ${id}@${MARKETPLACE_NAME} --yes`;
export const enableCommand = (id: string) => `bb plugin enable ${id}`;
export const removeCommand = (id: string) => `bb plugin remove ${id}`;
export const marketplaceCommand = `bb marketplace add ${MARKETPLACE_SOURCE}`;

/** The marketplace description's first sentence, without the "Part of BB Studio." lead-in. */
export function oneLine(description: string): string {
  const text = description.replace(/^Part of BB Studio\.\s*/, "");
  const end = text.search(/\.(\s|$)/);
  return end < 0 ? text : text.slice(0, end + 1);
}

/** Where an add-on stands: BB's own status and its health problems decide. */
export function classify(plugin: SetupPluginEntry | undefined, problems: readonly Pick<Problem, "status">[]): AddOnStatus {
  if (!plugin) return "not-installed";
  if (!plugin.enabled) return "disabled";
  if (problems.some((problem) => problem.status === "broken")) return "broken";
  if (problems.some((problem) => problem.status === "degraded")) return "needs-setup";
  return "installed";
}

/** -1, 0 or 1, comparing dotted version numbers; pre-release tags are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split(/[-+]/)[0]!.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const step = (text: string, command: string | null = null) => ({ text, command });
const REMOVED = "Its settings, secrets and schedules, and its installed files.";

interface RetiredPlugin {
  id: string;
  name: string;
  why: string;
  kept: string;
  deleted: string;
  before: RetiredEntry["before"];
  /** Why it can't be removed yet, or null. */
  blocker(plugin: SetupPluginEntry, ctx: { sdk: SetupSdk; plugins: ReadonlyMap<string, SetupPluginEntry> }): Promise<string | null>;
}

/**
 * Has an upgrade bridge copied every item into Studio? Older releases can't
 * copy, a turned-off one can't run, and the bridge itself says how far its
 * copy got. Every bridge answers `migrationStatus` in the same shape.
 */
function bridgeBlocker(noun: string, bridgeVersion: string) {
  return async (plugin: SetupPluginEntry, { sdk }: { sdk: SetupSdk }): Promise<string | null> => {
    const migrate = `Run \`bb ${plugin.id} migrate\` and wait for Migration complete.`;
    if (compareVersions(plugin.version, bridgeVersion) < 0) return `It's version ${plugin.version}, from before the upgrade bridge. Update it so it can copy your ${noun} into Studio (\`bb plugin update ${plugin.id} --yes\`), then: ${migrate}`;
    if (!plugin.enabled) return `It's turned off, so it can't copy your ${noun} into Studio. Turn it on with \`${enableCommand(plugin.id)}\`, then: ${migrate}`;
    const status = await sdk.plugins.callRpc({ pluginId: plugin.id, method: "migrationStatus", input: null, outputSchema: bridgeStatusContract.migrationStatus.output, signal: AbortSignal.timeout(30_000) });
    if (status.complete) return null;
    const why = status.error ? ` The last try failed: ${status.error}` : "";
    return `${status.copied} of ${status.total} ${noun} are in Studio so far.${why} ${migrate}`;
  };
}

/** The one ordered procedure for moving from the separate add-ons to unified Studio. */
export const UPGRADE_GUIDE_URL = "https://github.com/patleeman/bb-studio/blob/main/docs/upgrade-unified-studio.md";
/** Ids of the add-ons built into Studio whose last release is an upgrade bridge. */
export const BRIDGE_IDS: ReadonlySet<string> = new Set(["pages", "talk", "excalidraw", "artifacts", "design"]);

export const RETIRED: readonly RetiredPlugin[] = [
  {
    id: "pages",
    name: "Studio Pages",
    why: "Pages are built into Studio now, with Explore's Next row. This last release is only an upgrade bridge: it copies your pages, their versions, files and comments, the Next row's click stats and your Pages settings into Studio, and forwards older clients.",
    kept: "Every page it copied into Studio, with its content, comments, versions, uploaded files, chats, tags and links, the Next row's click stats, and your Pages and Explore settings. Links to /plugins/pages/pages/<id> still open them in Studio.",
    deleted: `${REMOVED} Any pages \`bb pages migrate\` listed as skipped are lost; copy what you need from them first. iOS app builds from before the merge stop opening pages.`,
    before: [
      step("Close pages you're editing, so their last changes are saved.", null),
      step("Update Studio Pages, then Studio, so Studio can take over its agent tools. (Updated Studio first? Reload it: bb plugin reload studio.)", "bb plugin update pages --yes && bb plugin update studio --yes"),
      step("Copy its pages, versions, files, click stats and settings into Studio, and wait for Migration complete.", "bb pages migrate"),
    ],
    blocker: bridgeBlocker("pages", PAGES_BRIDGE_VERSION),
  },
  {
    id: "artifacts",
    name: "Studio Artifacts",
    why: "Artifacts are built into Studio now. This last release is only an upgrade bridge: it copies your artifacts into Studio and forwards older clients.",
    kept: "Every artifact it copied into Studio, with its versions, files, tags, links and chats. Links to /plugins/artifacts/artifacts/<id> still open them in Studio.",
    deleted: `${REMOVED} Any rows \`bb artifacts migrate\` listed as skipped (malformed) are lost; copy what you need from them first. iOS app builds from before the merge stop opening artifacts.`,
    before: [
      step("Update Studio Artifacts, then Studio, so Studio can take over its agent tools. (Updated Studio first? Reload it: bb plugin reload studio.)", "bb plugin update artifacts --yes && bb plugin update studio --yes"),
      step("Copy its artifacts into Studio, and wait for Migration complete.", "bb artifacts migrate"),
    ],
    blocker: bridgeBlocker("artifacts", ARTIFACTS_BRIDGE_VERSION),
  },
  {
    id: "excalidraw",
    name: "Studio Draw",
    why: "Drawings are built into Studio now. This last release is only an upgrade bridge: it copies your drawings into Studio and forwards older clients.",
    kept: "Every drawing it copied into Studio, with its scene, images, tags, links and chats. Links to /plugins/excalidraw/drawings/<id> still open them in Studio.",
    deleted: `${REMOVED} Any rows \`bb excalidraw migrate\` listed as skipped (malformed) are lost; copy what you need from them first. iOS app builds from before the merge stop opening drawings.`,
    before: [
      step("Update Studio Draw, then Studio, so Studio can take over its agent tools. (Updated Studio first? Reload it: bb plugin reload studio.)", "bb plugin update excalidraw --yes && bb plugin update studio --yes"),
      step("Copy its drawings into Studio, and wait for Migration complete.", "bb excalidraw migrate"),
    ],
    blocker: bridgeBlocker("drawings", DRAW_BRIDGE_VERSION),
  },
  {
    id: "design",
    name: "Studio Design",
    why: "Designs are built into Studio now. This last release is only an upgrade bridge: it copies your designs and saved styles into Studio and forwards older clients.",
    kept: "Every design it copied into Studio, with its rounds, screens, comments, conversation, tags and links, and your saved styles. Links to /plugins/design/designs/<id> still open them in Studio.",
    deleted: `${REMOVED} Any rows \`bb design migrate\` listed as skipped are lost; copy what you need from them first. iOS app builds from before the merge stop opening designs.`,
    before: [
      step("Update Studio Design, then Studio, so Studio can take over its agent tools. (Updated Studio first? Reload it: bb plugin reload studio.)", "bb plugin update design --yes && bb plugin update studio --yes"),
      step("Copy its designs into Studio, and wait for Migration complete.", "bb design migrate"),
    ],
    blocker: bridgeBlocker("designs", DESIGN_BRIDGE_VERSION),
  },
  {
    id: "talk",
    name: "Studio Talk",
    why: "Recording and dictation are built into Studio now. This last release is only an upgrade bridge: it copies your recordings, their audio and your Talk settings into Studio and forwards older clients.",
    kept: "Every recording and dictation it copied into Studio, with its audio, transcripts, summaries, tags, links and chats, and your Talk settings and models. Links to /plugins/talk/recordings/<id> still open them in Studio.",
    deleted: `${REMOVED} That includes its copy of the audio under its data folder (Studio has its own copy). Any recordings \`bb talk migrate\` listed as skipped are lost; copy what you need from them first. A keyboard shortcut you set on a Talk command has to be set again on Studio's. iOS app builds from before the merge stop opening recordings.`,
    before: [
      step("Finish or stop any recording or dictation in progress, and let its audio upload (the pill disappears).", null),
      step("Update Studio Talk, then Studio, so Studio can take over Talk's agent tools. (Updated Studio first? Reload it: bb plugin reload studio.)", "bb plugin update talk --yes && bb plugin update studio --yes"),
      step("Copy its recordings, audio and settings into Studio, and wait for Migration complete.", "bb talk migrate"),
    ],
    blocker: bridgeBlocker("recordings", TALK_BRIDGE_VERSION),
  },
  {
    id: "studio-navigation",
    name: "Studio Navigation",
    why: "BB's own navigation replaces it; Studio's ⋯ menu can hide the add-ons' rows.",
    kept: "Navigation visibility and order (kept in BB's own preferences), saved drafts, quotes, page history and historical bot authors.",
    deleted: REMOVED,
    before: [step("In Settings → Appearance, pick BB's own navigation provider.")],
    blocker: async () => null,
  },
  {
    id: "thread-list-plus",
    name: "Studio Sidebar",
    why: "Studio no longer has Spaces, so there is nothing for it to organize by. BB's own sidebar lists threads by project, and a project's lead and heartbeat are set in Studio's settings.",
    kept: "Your threads, and each Space's lead and heartbeat, now on the Space's main project.",
    deleted: REMOVED,
    before: [],
    blocker: async () => null,
  },
  {
    id: "float",
    name: "Float",
    why: "Threads and Studio items open in the main view, or in a split with ⌘-click, and the sidebar lists what you open.",
    kept: "Your threads and Studio items.",
    deleted: REMOVED,
    before: [step("Update every Studio plugin.", "bb plugin update --all --yes")],
    blocker: async () => null,
  },
  {
    id: "bot-teams",
    name: "Studio Teams",
    why: "Studio Teams is retired and gets no more updates. An installed copy keeps running until you remove it.",
    kept: "Threads that worked as a bot stay ordinary BB threads.",
    deleted: `${REMOVED} Copy any bot home, MISSION.md or MEMORY.md you still need first.`,
    before: [
      step("List every bot.", "bb bots list --json"),
      step("Print a bot's profile and its bot home.", "bb bots show <bot> --json"),
      step("Print its MISSION.md and MEMORY.md.", "bb bots mission <bot> && bb bots memory <bot>"),
    ],
    blocker: async () => null,
  },
  {
    id: "studio-tables",
    name: "Studio Tables",
    why: "Studio Tables is retired and gets no more updates. Studio and Pages no longer list, link or embed tables.",
    kept: "Nothing: tables have no replacement.",
    deleted: `${REMOVED} Export any table you still need as CSV from its menu first.`,
    before: [],
    blocker: async () => null,
  },
];

const RETIRED_IDS = new Set(RETIRED.map((plugin) => plugin.id));

const ADDON_IDS = new Set(ADDONS.map((addOn) => addOn.id));

/** One pass: BB's plugin list and marketplaces, joined with a health result. */
export async function buildSetup(sdk: SetupSdk, health: HealthSummary): Promise<SetupSummary> {
  const [{ plugins }, marketplaces] = await Promise.all([
    sdk.plugins.list(),
    sdk.plugins.marketplaces.list().catch(() => null),
  ]);
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  // When BB can't say, assume it's there: the install itself will tell.
  const marketplaceAdded = marketplaces ? marketplaces.some((marketplace) => marketplace.name === MARKETPLACE_NAME) : true;

  const addOns: AddOnEntry[] = ADDONS.map((addOn) => {
    const plugin = byId.get(addOn.id);
    const problems = plugin?.enabled ? health.problems.filter((problem) => problem.pluginId === addOn.id) : [];
    const status = classify(plugin, problems);
    return {
      id: addOn.id,
      name: addOn.displayName,
      summary: oneLine(addOn.description),
      status,
      optional: OPTIONAL[addOn.id] ?? null,
      problems,
      passed: status === "installed" ? health.healthy.find((entry) => entry.pluginId === addOn.id)?.titles ?? [] : [],
      unanswered: plugin?.enabled ? health.unanswered.find((entry) => entry.pluginId === addOn.id)?.error ?? null : null,
      command: status === "not-installed" ? installCommand(addOn.id) : status === "disabled" ? enableCommand(addOn.id) : null,
    };
  });

  const retired = await Promise.all(RETIRED.filter((plugin) => byId.has(plugin.id)).map(async (def): Promise<RetiredEntry> => {
    const plugin = byId.get(def.id)!;
    return {
      id: def.id, name: plugin.name ?? def.name, enabled: plugin.enabled, why: def.why, kept: def.kept, deleted: def.deleted, before: def.before,
      blocker: await def.blocker(plugin, { sdk, plugins: byId }).catch((error) => `Couldn't check: ${message(error)}`),
      removeCommand: removeCommand(def.id),
    };
  }));

  const missing = addOns.filter((addOn) => addOn.status === "not-installed" && !addOn.optional);
  const installs = missing.map((addOn) => installCommand(addOn.id));
  const enables = addOns.filter((addOn) => addOn.status === "disabled").map((addOn) => enableCommand(addOn.id));
  const needsMarketplace = !marketplaceAdded && addOns.some((addOn) => addOn.status === "not-installed");
  return {
    checkedAt: health.checkedAt,
    marketplaceAdded,
    marketplaceCommand,
    addOns,
    retired,
    commands: [...(needsMarketplace ? [marketplaceCommand] : []), ...installs, ...enables],
    installAll: installs.length ? installs.join(" && ") : null,
    otherProblems: health.problems.filter((problem) => !ADDON_IDS.has(problem.pluginId) && !RETIRED_IDS.has(problem.pluginId)),
  };
}

/** Installs one add-on from the bb-studio marketplace, the way `bb plugin install <id>@bb-studio --yes` does. */
export async function installAddOn(sdk: SetupSdk, pluginId: string): Promise<void> {
  if (!ADDON_IDS.has(pluginId)) throw new Error(`${pluginId} isn't a BB Studio add-on.`);
  const plan = await sdk.plugins.catalog.installPlan({ entryId: pluginId, marketplace: MARKETPLACE_NAME });
  if (!plan.compatible) throw new Error(plan.incompatibleReason ?? "It doesn't work with this version of BB.");
  // A third-party marketplace entry installs only with the source BB resolved
  // for it; clicking Install is the confirmation `--yes` gives on the CLI.
  const confirmedSource = plan.kind === "marketplace" ? plan.resolvedSource : undefined;
  await sdk.plugins.catalog.install({ entryId: pluginId, marketplace: MARKETPLACE_NAME, ...(confirmedSource ? { confirmedSource: confirmedSource as never } : {}) });
}

/** Runs the Setup page's actions, then reports the new state. */
export class SetupService {
  /** Installs, turn-ons and removes run one at a time, so two clicks (or two windows) can't race BB. */
  private queue: Promise<unknown> = Promise.resolve();

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  constructor(private readonly deps: {
    sdk: SetupSdk;
    /** A health result at most this old, or a fresh check with 0. */
    health(maxAgeMs: number): Promise<HealthSummary>;
  }) {}

  async summary(maxAgeMs: number): Promise<SetupSummary> {
    return buildSetup(this.deps.sdk, await this.deps.health(maxAgeMs));
  }

  private async after(failures: SetupActionResult["failures"]): Promise<SetupActionResult> {
    return { summary: await this.summary(0), failures };
  }

  install(pluginIds: readonly string[]): Promise<SetupActionResult> {
    return this.serial(async () => {
      const failures: SetupActionResult["failures"] = [];
      // One at a time: BB installs from the same repository for each.
      for (const id of new Set(pluginIds)) {
        try {
          // Installed meanwhile (another window, the CLI): nothing left to do.
          if (ADDON_IDS.has(id) && (await this.deps.sdk.plugins.list()).plugins.some((plugin) => plugin.id === id)) continue;
          await installAddOn(this.deps.sdk, id);
        } catch (error) {
          failures.push({ id, error: message(error) });
        }
      }
      return this.after(failures);
    });
  }

  async enable(pluginId: string): Promise<SetupActionResult> {
    if (!ADDON_IDS.has(pluginId)) throw new Error(`${pluginId} isn't a BB Studio add-on.`);
    return this.serial(async () => {
      try {
        await this.deps.sdk.plugins.enable({ pluginId });
        return this.after([]);
      } catch (error) {
        return this.after([{ id: pluginId, error: message(error) }]);
      }
    });
  }

  /** Removes a retired plugin, only once nothing blocks it. */
  async remove(pluginId: string): Promise<SetupActionResult> {
    if (!RETIRED_IDS.has(pluginId)) throw new Error(`${pluginId} isn't a retired BB Studio plugin.`);
    return this.serial(() => this.removeNow(pluginId));
  }

  private async removeNow(pluginId: string): Promise<SetupActionResult> {
    const current = (await this.summary(60_000)).retired.find((entry) => entry.id === pluginId);
    if (!current) return this.after([]);
    if (current.blocker) return this.after([{ id: pluginId, error: current.blocker }]);
    try {
      await this.deps.sdk.plugins.remove({ pluginId });
      return this.after([]);
    } catch (error) {
      return this.after([{ id: pluginId, error: message(error) }]);
    }
  }
}

const LABEL: Record<AddOnStatus, string> = {
  installed: "ok",
  "not-installed": "not installed",
  disabled: "disabled",
  "needs-setup": "needs setup",
  broken: "broken",
};

/** `bb studio setup`: the same status as the Setup page, then the commands to run. */
export function formatSetup(summary: SetupSummary): string {
  const pad = (text: string, width: number) => text.padEnd(width);
  const idWidth = Math.max(...summary.addOns.map((addOn) => addOn.id.length), ...summary.retired.map((entry) => entry.id.length)) + 2;
  const lines = ["BB Studio add-ons"];
  for (const addOn of summary.addOns) {
    lines.push(`  ${pad(LABEL[addOn.status], 15)}${pad(addOn.id, idWidth)}${addOn.name}: ${addOn.summary}`);
    for (const problem of addOn.problems) lines.push(`  ${pad("", 15)}${pad("", idWidth)}${problem.status}: ${problem.title}${problem.detail ? `. ${problem.detail}` : ""}`);
    if (addOn.unanswered) lines.push(`  ${pad("", 15)}${pad("", idWidth)}Its health check didn't answer: ${addOn.unanswered}`);
    if (addOn.optional && addOn.status === "not-installed") lines.push(`  ${pad("", 15)}${pad("", idWidth)}Optional. ${addOn.optional} ${addOn.command}`);
  }
  if (summary.otherProblems.length) {
    lines.push("", "Other plugins");
    for (const problem of summary.otherProblems) lines.push(`  ${pad(problem.status, 15)}${pad(problem.pluginId, idWidth)}${problem.title}${problem.detail ? `. ${problem.detail}` : ""}`);
  }
  if (summary.retired.length) {
    lines.push("", "Retired plugins still installed");
    if (summary.retired.some((entry) => BRIDGE_IDS.has(entry.id))) lines.push(`  Moving from the separate add-ons? Follow ${UPGRADE_GUIDE_URL}`);
    for (const entry of summary.retired) {
      lines.push(`  ${pad(entry.id, idWidth)}${entry.why}`);
      lines.push(`    Kept: ${entry.kept}`, `    Deleted: ${entry.deleted}`);
      entry.before.forEach((each, index) => lines.push(`    ${index + 1}. ${each.text}${each.command ? `  ${each.command}` : ""}`));
      lines.push(entry.blocker ? `    Not yet: ${entry.blocker}` : `    Then remove it: ${entry.removeCommand}`);
    }
  }
  lines.push("");
  if (summary.commands.length) lines.push("To finish setup, run:", ...summary.commands.map((command) => `  ${command}`));
  else lines.push("Every BB Studio add-on is installed and on.");
  if (!summary.marketplaceAdded && !summary.commands.includes(summary.marketplaceCommand)) lines.push(`The bb-studio marketplace isn't added. To install add-ons from it: ${summary.marketplaceCommand}`);
  return `${lines.join("\n")}\n`;
}
