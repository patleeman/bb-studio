import { subcommand, takeFlag, takeOption, usage } from "../kit/cli";
import { untitled } from "../kit/format";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { actorColor } from "./actors";
import { HUMAN_USER_ID } from "./constants";
import { readMarkdown } from "./doc";
import { threadImageReader } from "./local-image-reader";
import { skippedNote } from "./local-images";
import { errorText, type PagesService } from "./service";

/** `bb studio pages` (`bb pages` before Pages was built into Studio). `created` tells Studio an agent made a page. */
export function pagesCli(service: PagesService, created: (pageId: string, threadId: string) => void, bb?: Pick<BbPluginApi, "sdk">): Parameters<BbPluginApi["cli"]["register"]>[0] {
  return {
    name: "pages",
    summary: "Read and write BB Pages (collaborative documents)",
    commands: [
      { name: "list", summary: "List pages in the current project and global pages", usage: "bb studio pages list [--all]" },
      { name: "show", summary: "Print a page (id or title) as Markdown", usage: "bb studio pages show <page-id> [--ids]" },
      { name: "create", summary: "Create a page from a title and optional Markdown", usage: "bb studio pages create <title> [--global] [--markdown <text>]" },
      { name: "append", summary: "Append Markdown to a page", usage: "bb studio pages append <page-id> <markdown…>" },
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
            if (!ref) return usage("bb studio pages show <page-id> [--ids]");
            const meta = service.requirePage(ref, ctx.projectId);
            return { exitCode: 0, stdout: readMarkdown(service.hub.open(meta.id).doc, { ids }) };
          }
          case "create": {
            const global = flag("--global") === true;
            const markdown = option("--markdown")?.replace(/\\n/g, "\n");
            const title = rest.join(" ").trim();
            if (!title) return { exitCode: 1, stderr: "usage: bb studio pages create <title> [--global] [--markdown <text>]\n" };
            const input = {
              projectId: global ? null : (ctx.projectId ?? null),
              parentId: null,
              title,
              markdown,
              actor: ctx.threadId ? `agent:${ctx.threadId}` : HUMAN_USER_ID,
            };
            // From a thread, its local images go into the page, as with pages_create.
            const { page, skipped } = ctx.threadId && bb
              ? await service.createPageImporting(input, threadImageReader(bb, ctx.threadId))
              : { page: service.createPage(input), skipped: [] };
            if (ctx.threadId) created(page.id, ctx.threadId);
            const note = skippedNote(skipped);
            return { exitCode: 0, stdout: `${page.id}\n`, ...(note ? { stderr: `${note}\n` } : {}) };
          }
          case "append": {
            const [ref, ...words] = rest;
            const markdown = words.join(" ").replace(/\\n/g, "\n");
            if (!ref || !markdown.trim()) return { exitCode: 1, stderr: "usage: bb studio pages append <page-id> <markdown…>\n" };
            const meta = service.requirePage(ref, ctx.projectId);
            // Like pages_edit: a version before the actor's first edit in a while, and its cursor.
            const actor = ctx.threadId ? (await service.actorForThread(ctx.threadId)).actor : { key: "cli", name: "CLI", color: actorColor("cli") };
            const ops = [{ op: "append" as const, markdown }];
            const { skipped } = ctx.threadId && bb
              ? await service.editImporting(meta.id, ops, actor, threadImageReader(bb, ctx.threadId))
              : { ...service.edit(meta.id, ops, actor), skipped: [] };
            const note = skippedNote(skipped);
            return { exitCode: 0, stdout: `Appended to ${meta.id}.\n`, ...(note ? { stderr: `${note}\n` } : {}) };
          }
          default:
            return usage("bb studio pages <list|show|create|append|explore> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  };
}
