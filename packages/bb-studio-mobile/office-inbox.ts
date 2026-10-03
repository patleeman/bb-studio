import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ExpoMessage, ExpoTicket } from "./apns.js";

const countsSchema = z.object({ bySpace: z.record(z.string(), z.object({ requests: z.number(), unreadReports: z.number() })) });
const pageSchema = z.object({ events: z.array(z.object({
  key: z.string(), spaceId: z.string(), type: z.enum(["request", "report", "comment"]), source: z.string(),
  title: z.string(), body: z.string(), threadId: z.string().nullable(), createdAt: z.number(), urgent: z.boolean().optional(),
})), cursor: z.string().nullable() });

/** The BB notification queue already delivers interaction requests. Other office
 * sources use this relay, with durable per-device acknowledgements for retries. */
export function officeInboxPoller(bb: BbPluginApi, devices: () => Promise<string[]>, deliver: (messages: ExpoMessage[]) => Promise<ExpoTicket[]>) {
  const db = bb.storage.database();
  db.exec("CREATE TABLE IF NOT EXISTS office_push_deliveries (event_key TEXT NOT NULL, device TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(event_key,device))");
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      const recipients = await devices();
      if (!recipients.length) return;
      const installed = (await bb.sdk.plugins.list()).plugins;
      if (!installed.some(p => p.id === "studio" && p.enabled && p.status === "running")) return;
      const call = <T extends z.ZodType>(method: string, input: unknown, outputSchema: T) => bb.sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema, signal: AbortSignal.timeout(10000) }) as Promise<z.output<T>>;
      const counts = await call("inbox_counts", {}, countsSchema);
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await call("inbox_list", { spaceId: "all", ...(cursor ? { cursor } : {}) }, pageSchema);
        for (const event of page.events) {
          if (event.source === "bb-interaction" || !(event.type === "request" || (event.type === "report" && event.urgent))) continue;
          const targets = recipients.filter(device => {
            const row = db.prepare("SELECT revision FROM office_push_deliveries WHERE event_key=? AND device=?").get(event.key,device) as { revision: number } | undefined;
            return !row || row.revision < event.createdAt;
          });
          if (!targets.length) continue;
          const tickets = await deliver(targets.map(to => ({ to, title: event.title.slice(0,200), body: event.body.slice(0,4000), sound: "default",
            data: { inboxKey: event.key, inboxChanged: true, spaceId: event.spaceId, inboxCounts: counts.bySpace, path: "/plugins/studio/office/inbox" },
          })));
          db.transaction(() => {
            for (let i=0;i<targets.length;i++) if (tickets[i]?.status === "ok") {
              db.prepare("INSERT INTO office_push_deliveries VALUES (?,?,?) ON CONFLICT(event_key,device) DO UPDATE SET revision=MAX(revision,excluded.revision)").run(event.key,targets[i]!,event.createdAt);
            }
          })();
        }
        cursor = page.cursor ?? undefined;
        if (cursor && seen.has(cursor)) throw new Error("Inbox returned a repeated cursor.");
        if (cursor) seen.add(cursor);
      } while (cursor);
    } finally { running = false; }
  };
}
