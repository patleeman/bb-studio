import { subcommand, takeFlag, takeOption, usage } from "@bb-studio/kit/cli";
import { untitled } from "@bb-studio/kit/format";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { actorColor } from "./actors";
import { HUMAN_USER_ID } from "./constants";
import { readMarkdown } from "./doc";
import { errorText, type PagesService } from "./service";

/** The `bb pages` CLI. `created` tells Studio an agent made a page. */
export function pagesCli(service: PagesService, created: (pageId: string, threadId: string) => void): Parameters<BbPluginApi["cli"]["register"]>[0] {
  return {
    name: "pages",
    summary: "Read and write BB Pages (collaborative documents)",
    commands: [
      { name: "list", summary: "List pages in the current project and global pages", usage: "bb pages list [--all]" },
      { name: "show", summary: "Print a page (id or title) as Markdown", usage: "bb pages show <page-id> [--ids]" },
      { name: "create", summary: "Create a page from a title and optional Markdown", usage: "bb pages create <title> [--global] [--markdown <text>]" },
      { name: "append", summary: "Append Markdown to a page", usage: "bb pages append <page-id> <markdown…>" },
    ],
    async run(argv, ctx) {
      const { command, rest } = subcommand(argv);
      const flag = (name: string) => takeFlag(rest, name);
      const option = (name: string) => takeOption(rest, name);
      try {
        switch (command) {
          case "list": {
            const pages = service.store.list(flag("--all") ? {} : { projectId: ctx.projectId ?? null });
            if (!pages.length) return { exitCode: 0, stdout: "No pages.\n" };
            const lines = pages.map(
              (page) => `${page.id}\t${untitled(page.title)}\t${page.project_id ?? "global"}\t${new Date(page.updated_at).toISOString()}`,
            );
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "show": {
            const ids = flag("--ids") === true;
            const ref = rest.join(" ").trim();
            if (!ref) return usage("bb pages show <page-id> [--ids]");
            const meta = service.requirePage(ref, ctx.projectId);
            return { exitCode: 0, stdout: readMarkdown(service.hub.open(meta.id).doc, { ids }) };
          }
          case "create": {
            const global = flag("--global") === true;
            const markdown = option("--markdown")?.replace(/\\n/g, "\n");
            const title = rest.join(" ").trim();
            if (!title) return { exitCode: 1, stderr: "usage: bb pages create <title> [--global] [--markdown <text>]\n" };
            const page = service.createPage({
              projectId: global ? null : (ctx.projectId ?? null),
              parentId: null,
              title,
              markdown,
              actor: ctx.threadId ? `agent:${ctx.threadId}` : HUMAN_USER_ID,
            });
            if (ctx.threadId) created(page.id, ctx.threadId);
            return { exitCode: 0, stdout: `${page.id}\n` };
          }
          case "append": {
            const [ref, ...words] = rest;
            const markdown = words.join(" ").replace(/\\n/g, "\n");
            if (!ref || !markdown.trim()) return { exitCode: 1, stderr: "usage: bb pages append <page-id> <markdown…>\n" };
            const meta = service.requirePage(ref, ctx.projectId);
            // Like pages_edit: a version before the actor's first edit in a while, and its cursor.
            const actor = ctx.threadId ? (await service.actorForThread(ctx.threadId)).actor : { key: "cli", name: "CLI", color: actorColor("cli") };
            service.edit(meta.id, [{ op: "append", markdown }], actor);
            return { exitCode: 0, stdout: `Appended to ${meta.id}.\n` };
          }
          default:
            return usage("bb pages <list|show|create|append> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  };
}
