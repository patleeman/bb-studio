import { readlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * BB Studio and stock bb write the same kind of `bb` launcher, with the same
 * marker. A `bb` link counts as this app's only when it points at this app's
 * own launcher; another app's link is left where it is and reads as the `bb`
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
