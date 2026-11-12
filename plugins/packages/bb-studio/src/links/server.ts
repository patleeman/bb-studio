import { isTabKindId, itemKindOfId, tabKindEntry } from "../tab-kinds";
import type { LinkResolution } from "./router";
import type { OpenSpec } from "../workbench-agent/shared";

type FileTarget = Extract<OpenSpec, { kind: "file" }>["target"];

export interface LinkResolveDeps {
  threadTitle(threadId: string): Promise<string | null>;
  itemTitle(id: string): string | null;
  botName(id: string): string | null;
  entryTitle(kind: "automation" | "todo" | "record", id: string): Promise<string | null>;
  fileTarget(threadId: string, path: string): Promise<FileTarget | null>;
  workspacePath(threadId: string, path: string): Promise<string>;
}

const missing: LinkResolution = { found: false, title: null, spec: null };
const present = (title: string | null, spec: OpenSpec | null = null): LinkResolution => ({ found: true, title, spec });

export async function resolveLink(input: { kind: string; id: string | null; threadId: string | null }, deps: LinkResolveDeps): Promise<LinkResolution> {
  if (!isTabKindId(input.kind)) return missing;
  const entry = tabKindEntry(input.kind);
  const { id, threadId } = input;
  switch (entry.ref) {
    case "thread": {
      if (!id) return missing;
      const title = await deps.threadTitle(id);
      return title === null ? missing : present(title);
    }
    case "item": {
      if (!id || itemKindOfId(id) !== entry.id) return missing;
      const title = deps.itemTitle(id);
      return title === null ? missing : present(title.trim() || "Untitled");
    }
    case "bot": {
      if (!id) return entry.id === "bot" ? missing : present(entry.name);
      const name = deps.botName(id);
      return name === null ? missing : present(entry.id === "bot" ? name : entry.name);
    }
    case "entry": {
      if (!id || (entry.id !== "automation" && entry.id !== "todo" && entry.id !== "record")) return missing;
      const title = await deps.entryTitle(entry.id, id);
      return title === null ? missing : present(title.trim() || entry.name);
    }
    case "none": return present(entry.name);
    case "run": return id && /^wfr_[0-9a-f-]+$/i.test(id) ? present(entry.name) : missing;
    case "url": return id && /^https?:\/\//i.test(id) ? present(id, { kind: "url", url: id }) : missing;
    case "path": {
      if (!id || !threadId) return missing;
      if (entry.id === "diff") return present(`Diff of ${await deps.workspacePath(threadId, id)}`, { kind: "diff", path: await deps.workspacePath(threadId, id) });
      const target = await deps.fileTarget(threadId, id);
      return target ? present(id, { kind: "file", target, location: null }) : missing;
    }
  }
}

export function linkHandlers(deps: LinkResolveDeps) {
  return {
    "links.resolve": (input: { kind: string; id: string | null; threadId: string | null }) => resolveLink(input, deps),
  };
}
