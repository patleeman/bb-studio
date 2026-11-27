// The name of the command that runs Studio's CLI, for text a person reads:
// usage lines, errors and the commands the Setup page shows. BB Studio's
// command is `bbs` (alias `bb-studio`); stock bb's, and BB Studio's before it
// had `bbs`, is `bb`. Text only agents read can keep `bb`: in Studio's agent
// shells `bb` runs Studio's CLI too.
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PluginCliRegistration } from "@get-bb/plugin-sdk";

export type StudioCliName = "bbs" | "bb";

/**
 * BB Studio writes this into the `bbs` file next to its bundled CLI (the
 * desktop fork's scripts/fork/studio-cli-aliases.mjs). BB_CLI points at that
 * CLI in the server, its plugins and agent shells.
 */
export const STUDIO_CLI_ALIAS_MARKER = "Written by BB Studio: runs BB Studio's bb command next to this file.";

function hasStudioAlias(cliPath: string): boolean {
  const alias = join(dirname(cliPath), "bbs");
  try {
    return statSync(alias).size < 4096 && readFileSync(alias, "utf8").includes(STUDIO_CLI_ALIAS_MARKER);
  } catch {
    return false;
  }
}

/** `bbs`, unless BB_CLI is a CLI with no Studio `bbs` beside it (stock bb, or an older BB Studio). */
export function studioCliName(env: NodeJS.ProcessEnv = process.env): StudioCliName {
  const cli = env.BB_CLI?.trim();
  return cli && !hasStudioAlias(cli) ? "bb" : "bbs";
}

// Words after `bb` that always make it a command. Words that also read as
// prose ("the bb server", "a bb thread", "a bb automation") are left out.
const COMMAND = /(^|[\s(|&;:`'"])bb(?= (?:studio|plugin|marketplace|mobile|guide|voice|pool|skill|browser-automation)\b)/gu;

/** Rewrites `bb <command>` in CLI text as `<name> <command>`. */
export function withStudioCli(text: string, name: StudioCliName = studioCliName()): string {
  return name === "bb" ? text : text.replace(COMMAND, `$1${name}`);
}

/**
 * A plugin CLI registration whose usage lines, summaries and error output name
 * the right command. A successful command's stdout is data and is left alone,
 * except a line that starts with "Usage:".
 */
export function studioCliRegistration(registration: PluginCliRegistration, name: StudioCliName = studioCliName()): PluginCliRegistration {
  const text = (value: string) => withStudioCli(value, name);
  return {
    ...registration,
    summary: text(registration.summary),
    ...(registration.commands === undefined
      ? {}
      : { commands: registration.commands.map((command) => ({ ...command, summary: text(command.summary), usage: text(command.usage) })) }),
    async run(argv, ctx) {
      const result = await registration.run(argv, ctx);
      const stdout =
        result.stdout === undefined
          ? undefined
          : result.exitCode === 0
            ? result.stdout.replace(/^Usage:.*$/gmu, (line) => text(line))
            : text(result.stdout);
      return {
        ...result,
        ...(stdout === undefined ? {} : { stdout }),
        ...(result.stderr === undefined ? {} : { stderr: text(result.stderr) }),
      };
    },
  };
}
