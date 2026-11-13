import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORK_LAUNCH_THEME_FILE,
  parseLaunchAppearance,
  type LaunchAppearance,
} from "./fork-launch-theme-ipc.js";

export function readLaunchAppearance(
  userDataPath: string,
): LaunchAppearance | null {
  try {
    return parseLaunchAppearance(
      JSON.parse(readFileSync(join(userDataPath, FORK_LAUNCH_THEME_FILE), "utf8")),
    );
  } catch {
    return null;
  }
}

export function writeLaunchAppearance(
  userDataPath: string,
  value: unknown,
): void {
  const parsed = value === null ? null : parseLaunchAppearance(value);
  if (value !== null && parsed === null) return;
  const path = join(userDataPath, FORK_LAUNCH_THEME_FILE);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(parsed)}\n`);
  renameSync(temporary, path);
}

export function forkWindowBackground(
  userDataPath: string,
  fallback: string,
): string {
  return readLaunchAppearance(userDataPath)?.background ?? fallback;
}
