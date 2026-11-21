// <dataDir>/AGENTS.md once, not twice. bb adds it to every session's
// instructions. A provider that reads AGENTS.md from the workspace and every
// folder above it (Pi) finds the same file on its own when the workspace sits
// inside the data dir (the personal workspace does), so the session got it
// twice. In that case bb leaves its copy out.
import path from "node:path";

/** Providers that read AGENTS.md from the workspace's parent folders themselves. */
const READS_PARENT_AGENTS_MD = new Set(["pi"]);

export function forkProviderReadsDataDirAgentsMd(args: {
  providerId: string;
  workspacePath: string;
  dataDir: string;
}): boolean {
  if (!READS_PARENT_AGENTS_MD.has(args.providerId)) return false;
  const relative = path.relative(path.resolve(args.dataDir), path.resolve(args.workspacePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
