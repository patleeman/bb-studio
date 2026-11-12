// Where automatic filing puts a new thing: beside the work it came from.
// Pure, so the rules are tested directly (auto-file.test.ts):
// - an item an agent made goes to the folder of the thread that made it;
// - an item made under another item (a sub-page) goes to that item's folder;
// - a thread started by another thread goes to its parent's folder.
// A folder belongs to one project, so nothing is filed across projects, and
// what the user placed by hand is never moved.
import type { Filing, Folder } from "./store";

export interface AutoFileInput {
  /** The new thing's own filing, if it has one already. */
  current: Pick<Filing, "filedBy"> | null;
  /** The new thing's project; null = No project. */
  projectId: string | null;
  /** Where the thing it came from is filed, most telling first (the thread that made it, then the item above it). */
  sources: readonly (Pick<Filing, "folderId"> | null)[];
  folder(id: string): Pick<Folder, "id" | "projectId"> | null;
}

/** The folder to file into, or null to leave the thing where it is. */
export function autoFileFolder(input: AutoFileInput): string | null {
  if (input.current) return null;
  for (const source of input.sources) {
    if (!source?.folderId) continue;
    const folder = input.folder(source.folderId);
    if (folder && folder.projectId === input.projectId) return folder.id;
  }
  return null;
}

/** "Project/Sub/Folder" as its parts: the project's name, then folder names. Empty parts are dropped. */
export function splitFolderPath(path: string): string[] {
  return path.split("/").map((part) => part.trim()).filter(Boolean);
}

export const NO_PROJECT_NAME = "No project";

/**
 * The project a path starts with, by name or id, without case. "No project"
 * (or "global") is the folder of things with no project. Null when no project
 * matches.
 */
export function pathProject(first: string, projects: readonly { id: string; name: string }[]): { projectId: string | null } | null {
  const wanted = first.trim().toLowerCase();
  if (wanted === NO_PROJECT_NAME.toLowerCase() || wanted === "global") return { projectId: null };
  const found = projects.find((project) => project.id === first.trim()) ?? projects.find((project) => project.name.trim().toLowerCase() === wanted);
  return found ? { projectId: found.id } : null;
}
