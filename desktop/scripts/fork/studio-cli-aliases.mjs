import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

// BB Studio's CLI is `bbs` (alias `bb-studio`). These small files sit next to
// the bundled `bb` in the host daemon's bin folder, which agent shells put
// first on PATH, so `bbs`, `bb-studio` and `bb` all run Studio's CLI there.
// The marker must match STUDIO_CLI_ALIAS_MARKER in
// packages/config/src/studio-cli.fork.ts: Studio's CLI follows a BB_CLI only
// when these files sit next to it.
export const STUDIO_CLI_ALIAS_MARKER =
  "Written by BB Studio: runs BB Studio's bb command next to this file.";
export const STUDIO_CLI_ALIAS_NAMES = ["bbs", "bb-studio"];

export function renderStudioCliAlias() {
  return [
    "#!/bin/sh",
    `# ${STUDIO_CLI_ALIAS_MARKER}`,
    'exec "$(dirname "$0")/bb" "$@"',
    "",
  ].join("\n");
}

export function renderStudioCliAliasCmd() {
  return [
    "@echo off",
    `rem ${STUDIO_CLI_ALIAS_MARKER}`,
    'node "%~dp0bb" %*',
    "",
  ].join("\r\n");
}

/** The file names written next to `bb`, for copy and package lists. */
export function studioCliAliasFiles() {
  return STUDIO_CLI_ALIAS_NAMES.flatMap((name) => [name, `${name}.cmd`]);
}

/** @param {string} directory */
export async function writeStudioCliAliases(directory) {
  for (const name of STUDIO_CLI_ALIAS_NAMES) {
    const path = join(directory, name);
    await writeFile(path, renderStudioCliAlias());
    await chmod(path, 0o755);
    await writeFile(join(directory, `${name}.cmd`), renderStudioCliAliasCmd());
  }
}
