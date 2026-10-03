import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { StudioHub } from "../hub";
import type { StudioServices } from "../services";
import type { ProviderComments } from "../provider-comments";
import { commentNeeds } from "../needs-you";
import type { InboxSource, SourceEvent } from "./inbox";

/** The shared comment adapter preserves Pages' Yjs ownership. */
export function commentSource(hub: StudioHub, services: StudioServices, pages: ProviderComments): InboxSource {
  return {
    id: "comments", keyPrefix: "comment:",
    async list() {
      const { items } = await hub.overview();
      const events: SourceEvent[] = [];
      for (const item of items.filter(i => !i.archived)) {
        const ref = { pluginId: item.pluginId, id: item.id };
        const comments = await pages.list(ref) ?? services.comments(ref);
        for (const need of commentNeeds(comments, item)) events.push({
          key: need.id, projectId: item.projectId, type: "comment", source: "comments", title: need.title, body: need.body,
          href: item.href, item: { ref: `${item.pluginId}:${item.id}`, title: item.title, href: item.href },
          botId: null, threadId: null, actions: null, createdAt: need.createdAt,
        });
      }
      return events;
    },
    async act() { throw new Error("Open the item to reply to this comment."); },
  };
}

const requestsSchema = z.object({ requests: z.array(z.object({
  id: z.string(), botId: z.string(), botName: z.string(), threadId: z.string().nullable(),
  summary: z.string(), status: z.enum(["queued", "working", "done", "failed"]),
  error: z.string().nullable(), result: z.string().nullable(), createdAt: z.number(), updatedAt: z.number(),
})) });

export function pageRequestSource(sdk: BbPluginApi["sdk"], hub: StudioHub): InboxSource {
  return {
    id: "page-requests", keyPrefix: "page-request:",
    async list() {
      const { items } = await hub.overview();
      const events: SourceEvent[] = [];
      for (const item of items.filter(i => i.pluginId === "pages" && !i.archived)) {
        const { requests } = await sdk.plugins.callRpc({ pluginId: "pages", method: "requests", input: { pageId: item.id } as never, outputSchema: requestsSchema });
        for (const request of requests) {
          if (request.status !== "done" && request.status !== "failed") continue;
          events.push({
            key: `page-request:${request.id}`, projectId: item.projectId, source: "page-requests",
            type: request.status === "failed" ? "request" : "report", title: request.summary,
            body: request.error ?? request.result ?? request.summary, botId: request.botId, threadId: request.threadId,
            item: { ref: `pages:${item.id}`, title: item.title, href: item.href }, href: item.href, actions: null,
            createdAt: request.updatedAt,
          });
        }
      }
      return events;
    },
    async act() { throw new Error("Open the page to review this bot request."); },
  };
}
