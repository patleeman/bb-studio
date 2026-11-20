import { lstat, readlink, realpath, rm, symlink } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import {
  isStudioCliPath,
  STUDIO_CLI_ALIASES,
  STUDIO_CLI_NAME,
} from "@bb/config/cli-command";

export { STUDIO_CLI_NAME };

const STOCK_CLI_NAME = "bb";

/**
 * BB Studio and stock bb write the same kind of `bb` launcher, with the same
 * marker. A link counts as this app's only when it points at this app's own
 * launcher; another app's link is left where it is and reads as a command
 * already on the PATH, so neither app replaces or removes the other's.
 */
export async function pointsAtOwnLauncher(
  link: string,
  launcherPath: string,
): Promise<boolean> {
  try {
    return (
      resolve(dirname(link), await readlink(link)) === resolve(launcherPath)
    );
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Studio's CLI is installed as `bbs`; `bb-studio` is linked beside it. An
 * alias name already taken by something else is left alone.
 */
export async function linkStudioCliAliases(
  directory: string,
  launcherPath: string,
): Promise<void> {
  for (const name of STUDIO_CLI_ALIASES) {
    const link = join(directory, name);
    if (await exists(link)) {
      continue;
    }
    await symlink(launcherPath, link).catch(() => undefined);
  }
}

export async function removeStudioCliAliases(
  directory: string,
  launcherPath: string,
): Promise<void> {
  for (const name of STUDIO_CLI_ALIASES) {
    const link = join(directory, name);
    if (await pointsAtOwnLauncher(link, launcherPath)) {
      await rm(link).catch(() => undefined);
    }
  }
}

function linkDirectories(homeDir: string, platform: NodeJS.Platform): string[] {
  const user = [join(homeDir, ".local", "bin"), join(homeDir, "bin")];
  return platform === "darwin"
    ? ["/opt/homebrew/bin", "/usr/local/bin", ...user]
    : user;
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** The first `bb` on PATH that is not this app's (stock bb, npm, a machine). */
async function otherBbOnPath(args: {
  env: NodeJS.ProcessEnv;
  launcherPath: string;
}): Promise<string | null> {
  const ownLauncher = await realpathOrNull(args.launcherPath);
  const entries = (args.env.PATH ?? "")
    .split(delimiter)
    .filter(
      (entry) =>
        entry.length > 0 && !/(?:^|\/)node_modules\/\.bin\/?$/u.test(entry),
    );
  for (const entry of entries) {
    const candidate = join(entry, STOCK_CLI_NAME);
    const target = await realpathOrNull(candidate);
    if (target === null || target === ownLauncher || isStudioCliPath(target)) {
      continue;
    }
    return candidate;
  }
  return null;
}

export interface LegacyBbLinkMigration {
  directory: string;
  /** The `bb` a terminal runs after the old link was removed. */
  otherBb: string | null;
  removed: boolean;
}

/**
 * BB Studio before 1.0.8 installed its CLI as `bb`. On start, each `bb` link
 * that points at this app's launcher gets `bbs` and `bb-studio` beside it.
 * The old link is removed only when another `bb` (stock bb's) is on PATH, so
 * the user always keeps a `bb`; otherwise it stays. A `bb` link that points
 * anywhere else is never touched.
 */
export async function migrateLegacyStudioBbLink(args: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  launcherPath: string | null;
  log: (message: string) => void;
  platform: NodeJS.Platform;
}): Promise<LegacyBbLinkMigration[]> {
  const { launcherPath } = args;
  if (launcherPath === null || args.platform === "win32") {
    return [];
  }
  const results: LegacyBbLinkMigration[] = [];
  for (const directory of linkDirectories(args.homeDir, args.platform)) {
    const legacy = join(directory, STOCK_CLI_NAME);
    if (!(await pointsAtOwnLauncher(legacy, launcherPath))) {
      continue;
    }
    const studioLink = join(directory, STUDIO_CLI_NAME);
    if (!(await exists(studioLink))) {
      await symlink(launcherPath, studioLink).catch(() => undefined);
    }
    await linkStudioCliAliases(directory, launcherPath);
    const otherBb = await otherBbOnPath({ env: args.env, launcherPath });
    const removed =
      otherBb !== null &&
      (await rm(legacy).then(
        () => true,
        () => false,
      ));
    args.log(
      removed
        ? `BB Studio's command is now ${STUDIO_CLI_NAME} (${studioLink}). Removed its old bb link at ${legacy}; bb in a terminal now runs ${otherBb}.`
        : `BB Studio's command is now ${STUDIO_CLI_NAME} (${studioLink}). Kept its old bb link at ${legacy}: no other bb is on PATH.`,
    );
    results.push({ directory, otherBb, removed });
  }
  return results;
}
