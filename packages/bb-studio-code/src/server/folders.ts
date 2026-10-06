// Folders a workspace may not open: the whole disk, the home folder, and
// where secrets live, or any folder that contains them. The read-only file
// browser serves a workspace's folders to any BB client, so these would hand
// out keys and tokens.
import { posix } from "node:path";

const SECRETS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".netrc", ".npmrc", ".pypirc", ".password-store", ".config/gh", ".config/gcloud", "Library/Keychains"];

/** Why `path` can't be a workspace folder, or null when it can. */
export function sensitiveFolder(path: string, home: string): string | null {
  const folder = posix.normalize(path).replace(/\/+$/, "") || "/";
  const base = posix.normalize(home).replace(/\/+$/, "");
  if (folder === "/") return "the whole disk";
  if (folder === base) return "your home folder";
  for (const secret of SECRETS) {
    const full = `${base}/${secret}`;
    if (folder === full || folder.startsWith(`${full}/`) || full.startsWith(`${folder}/`)) return `${secret}, where secrets live`;
  }
  return null;
}
