// The first message of a handed-off thread: the task, and its links as real
// mentions, so each add-on's mention provider hands the agent the item's
// contents.
import { formatDue } from "../shared";
import type { LinkRow, TaskRow } from "./store";

/** Each Studio add-on's mention provider id; a mention's item id is `<provider>:<id>`. */
export const MENTION_PROVIDERS: Record<string, string> = {
  pages: "page",
  talk: "recordings",
  excalidraw: "drawing",
  artifacts: "artifact",
  tasks: "task",
};

export type MentionResource =
  | { kind: "thread"; threadId: string; label: string }
  | { kind: "plugin"; pluginId: string; itemId: string; label: string };

export interface Mention {
  start: number;
  end: number;
  resource: MentionResource;
}

export interface PromptInput {
  type: "text";
  text: string;
  mentions: Mention[];
}

export function handoffInput(
  task: Pick<TaskRow, "id" | "title" | "description" | "due">,
  links: readonly Pick<LinkRow, "target" | "plugin_id" | "item_id" | "label" | "href">[],
  note: string | null,
  now = new Date(),
): PromptInput {
  let text = "";
  const mentions: Mention[] = [];
  const add = (part: string) => {
    text += part;
  };
  const mention = (label: string, resource: MentionResource) => {
    const shown = `@${label.replace(/\s+/g, " ").trim() || "Untitled"}`;
    mentions.push({ start: text.length, end: text.length + shown.length, resource: { ...resource, label: shown.slice(1) } });
    add(shown);
  };

  add(`Work on this task from Studio Tasks: "${task.title || "Untitled"}"\n`);
  if (task.description.trim()) add(`\n${task.description.trim()}\n`);
  if (task.due) add(`\nDue: ${formatDue(task.due, now)} (${task.due})\n`);
  if (links.length) {
    add("\nLinked: ");
    links.forEach((link, index) => {
      if (index) add(", ");
      const provider = link.plugin_id ? MENTION_PROVIDERS[link.plugin_id] : undefined;
      if (link.target === "thread") mention(link.label, { kind: "thread", threadId: link.item_id, label: link.label });
      else if (link.plugin_id && provider) mention(link.label, { kind: "plugin", pluginId: link.plugin_id, itemId: `${provider}:${link.item_id}`, label: link.label });
      else add(link.href ? `[${link.label.replace(/[[\]]/g, "")}](${link.href})` : link.label);
    });
    add("\n");
  }
  if (note?.trim()) add(`\n${note.trim()}\n`);
  add(
    `\nThis thread follows the task (id ${task.id}). When the work is ready for review, call tasks_update with ` +
      `status "review" and a one-line note saying what you did. Link what you make for it (artifacts, pages) with ` +
      `tasks_update's addLinks. Don't mark the task done: the user does that after reviewing.`,
  );
  return { type: "text", text, mentions };
}
