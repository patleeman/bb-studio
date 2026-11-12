import { parseCliArgs, type CliSpec } from "../cli-args";
import { colorFrom } from "./agent-tools";
import { formatReport } from "./checks";
import { MAX_MOTION } from "./schema";
import { formatListing, formatPresence, type PresenceOutcome, type PresenceService } from "./service";
import type { PresenceCreator } from "./store";
import { PRESENCE_FORMAT_GUIDE, presenceTemplateJson } from "./template";

export const PRESENCE_CLI_USAGE = "bb studio presence <list|show|create|update|apply|check|delete|template> …";

const USAGE = {
  list: "bb studio presence list [--json]",
  show: "bb studio presence show <id>",
  create: "bb studio presence create --file <presence.json> [--code <draw.js>]",
  update: "bb studio presence update <id> [--file <patch.json>] [--code <draw.js>] [--new-id <id>]",
  apply: "bb studio presence apply <id> [--bot <id|name>] [--color theme|#rrggbb] [--motion 0-2]",
  check: "bb studio presence check --file <presence.json> [--code <draw.js>] [--json]",
  delete: "bb studio presence delete <id>",
  template: "bb studio presence template [--guide]",
} as const;
type Command = keyof typeof USAGE;

const SPECS: Record<Command, CliSpec & { positional: number }> = {
  list: { flags: ["--json"], positional: 0 },
  show: { positional: 1 },
  create: { options: ["--file", "--code"], positional: 0 },
  update: { options: ["--file", "--code", "--new-id"], positional: 1 },
  apply: { options: ["--bot", "--color", "--motion"], positional: 1 },
  check: { options: ["--file", "--code"], flags: ["--json"], positional: 0 },
  delete: { positional: 1 },
  template: { flags: ["--guide"], positional: 0 },
};

export type PresenceCliCommand =
  | { command: "list"; json: boolean }
  | { command: "show"; id: string }
  | { command: "create"; file: string; code: string | null }
  | { command: "update"; id: string; file: string | null; code: string | null; newId: string | null }
  | { command: "apply"; form: string; bot: string | null; color?: string; motion?: number }
  | { command: "check"; file: string; code: string | null; json: boolean }
  | { command: "delete"; id: string }
  | { command: "template"; guide: boolean };

export type ParsedPresenceCli = { ok: true; value: PresenceCliCommand } | { ok: false; usage: string };

export function parsePresenceCli(argv: readonly string[]): ParsedPresenceCli {
  const name = argv[0];
  if (!name || !(name in USAGE)) return { ok: false, usage: PRESENCE_CLI_USAGE };
  const command = name as Command, usage = USAGE[command], spec = SPECS[command];
  const args = parseCliArgs(argv.slice(1), spec);
  if (!args.ok) return { ok: false, usage: `${usage}\n${args.error}` };
  if (args.positional.length !== spec.positional) return { ok: false, usage };
  const first = args.positional[0]!;
  const option = (key: string) => args.options.get(key) ?? null;
  switch (command) {
    case "list": return { ok: true, value: { command, json: args.flags.has("--json") } };
    case "show": return { ok: true, value: { command, id: first } };
    case "delete": return { ok: true, value: { command, id: first } };
    case "template": return { ok: true, value: { command, guide: args.flags.has("--guide") } };
    case "create": {
      const file = option("--file");
      return file ? { ok: true, value: { command, file, code: option("--code") } } : { ok: false, usage };
    }
    case "check": {
      const file = option("--file");
      return file ? { ok: true, value: { command, file, code: option("--code"), json: args.flags.has("--json") } } : { ok: false, usage };
    }
    case "update": {
      const file = option("--file"), code = option("--code");
      return file || code ? { ok: true, value: { command, id: first, file, code, newId: option("--new-id") } } : { ok: false, usage };
    }
    case "apply": {
      const color = option("--color"), motionText = option("--motion");
      if (color !== null && !/^(theme|#[0-9a-fA-F]{6})$/.test(color)) return { ok: false, usage: `${usage}\n--color is theme or #rrggbb.` };
      const motion = motionText === null ? undefined : Number(motionText);
      if (motion !== undefined && !(motionText!.trim() !== "" && Number.isFinite(motion) && motion >= 0 && motion <= MAX_MOTION)) return { ok: false, usage: `${usage}\n--motion is a number from 0 to ${MAX_MOTION}.` };
      return { ok: true, value: { command, form: first, bot: option("--bot"), ...(color !== null ? { color } : {}), ...(motion !== undefined ? { motion } : {}) } };
    }
  }
}

export interface PresenceCliDeps {
  service: PresenceService;
  readFile(path: string): Promise<string>;
  resolveBot(ref: string | null): Promise<{ id: string; name: string } | string>;
}

export type CliResult = { exitCode: number; stdout?: string; stderr?: string };

const CLI_CREATOR: PresenceCreator = { name: "CLI", botId: null };

async function readPackage(deps: PresenceCliDeps, file: string | null, code: string | null): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  let value: Record<string, unknown> = {};
  if (file) {
    let text: string;
    try { text = await deps.readFile(file); } catch (error) { return { ok: false, error: `Couldn't read ${file}: ${error instanceof Error ? error.message : String(error)}` }; }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, error: `${file} isn't a JSON object.` };
      value = parsed as Record<string, unknown>;
    } catch (error) { return { ok: false, error: `${file} isn't JSON: ${error instanceof Error ? error.message : String(error)}` }; }
  }
  if (code) {
    try { value = { ...value, code: await deps.readFile(code) }; } catch (error) { return { ok: false, error: `Couldn't read ${code}: ${error instanceof Error ? error.message : String(error)}` }; }
  }
  return { ok: true, value };
}

function outcomeResult(outcome: PresenceOutcome, verb: string): CliResult {
  if (outcome.ok) return { exitCode: 0, stdout: `${verb} ${outcome.presence.id} (${outcome.presence.name}).\n${formatReport(outcome.report)}\n` };
  return { exitCode: 1, stderr: `Not saved.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}${outcome.report ? `\n${formatReport(outcome.report)}` : ""}\n` };
}

export async function runPresenceCli(argv: readonly string[], deps: PresenceCliDeps): Promise<CliResult> {
  const parsed = parsePresenceCli(argv);
  if (!parsed.ok) return { exitCode: 1, stderr: `usage: ${parsed.usage}\n` };
  const value = parsed.value;
  const { service } = deps;
  switch (value.command) {
    case "list": {
      const entries = service.list();
      return { exitCode: 0, stdout: value.json ? `${JSON.stringify(entries, null, 2)}\n` : `${entries.map(formatListing).join("\n")}\n` };
    }
    case "show": {
      const listing = service.list().find((entry) => entry.id === value.id);
      if (!listing) return { exitCode: 1, stderr: `No presence ${value.id}.\n` };
      const stored = service.get(value.id);
      return { exitCode: 0, stdout: `${formatListing(listing)}\n${stored ? `${JSON.stringify(stored, null, 2)}\n` : ""}` };
    }
    case "template":
      return { exitCode: 0, stdout: value.guide ? `${PRESENCE_FORMAT_GUIDE}\n\n${presenceTemplateJson()}\n` : `${presenceTemplateJson()}\n` };
    case "check": {
      const input = await readPackage(deps, value.file, value.code);
      if (!input.ok) return { exitCode: 1, stderr: `${input.error}\n` };
      const report = await service.check(input.value);
      return { exitCode: report.pass ? 0 : 1, stdout: value.json ? `${JSON.stringify({ pass: report.pass, results: report.results }, null, 2)}\n` : `${formatReport(report)}\n` };
    }
    case "create": {
      const input = await readPackage(deps, value.file, value.code);
      if (!input.ok) return { exitCode: 1, stderr: `${input.error}\n` };
      return outcomeResult(await service.create(input.value, CLI_CREATOR), "Saved");
    }
    case "update": {
      const input = await readPackage(deps, value.file, value.code);
      if (!input.ok) return { exitCode: 1, stderr: `${input.error}\n` };
      const copying = !!value.newId && value.newId !== value.id;
      return outcomeResult(await service.update(value.id, input.value, { ...(value.newId ? { newId: value.newId } : {}), creator: copying ? CLI_CREATOR : null }), copying ? "Saved a copy as" : "Updated");
    }
    case "apply": {
      const bot = await deps.resolveBot(value.bot);
      if (typeof bot === "string") return { exitCode: 1, stderr: `${bot}\n` };
      const outcome = await service.apply({ botId: bot.id, form: value.form, ...(value.color !== undefined ? { color: colorFrom(value.color) } : {}), ...(value.motion !== undefined ? { motion: value.motion } : {}) });
      if (!outcome.ok) return { exitCode: 1, stderr: `Not applied.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}\n` };
      return { exitCode: 0, stdout: `${outcome.bot.name}: ${formatPresence(outcome.presence)}\n` };
    }
    case "delete": {
      const outcome = service.remove(value.id);
      return outcome.ok ? { exitCode: 0, stdout: `Deleted ${outcome.id}.\n` } : { exitCode: 1, stderr: `Not deleted.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}\n` };
    }
  }
}
