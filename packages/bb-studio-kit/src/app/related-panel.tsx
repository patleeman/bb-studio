import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { Icon } from "../ui/icon";
import { useStudioPresent } from "./presence";

export interface RelatedRef { pluginId: string; id: string }
const refSchema = z.object({ pluginId: z.string(), id: z.string() });
const linkSchema = z.object({ from: refSchema, to: refSchema, kind: z.string(), source: z.string() });
const linksSchema = z.object({ outgoing: z.array(linkSchema), backlinks: z.array(linkSchema) });
const threadsSchema = z.object({ threads: z.array(z.object({ threadId: z.string(), state: z.string(), role: z.string() }).passthrough()) });
const itemSchema = z.object({ item: z.object({ title: z.string(), href: z.string() }).passthrough().nullable(), kind: z.unknown().nullable() });
const commentsSchema = z.object({ comments: z.array(z.object({ id: z.string(), body: z.string(), resolvedAt: z.number().nullable() }).passthrough()) });
const versionsSchema = z.object({ versions: z.array(z.object({ id: z.string(), label: z.string(), createdAt: z.number() }).passthrough()) });

/** Related items and threads from Studio. Hidden when the hub is absent. */
export function RelatedPanel({ ref: item }: { ref: RelatedRef }) {
  const sdk = useSdk();
  const studio = useStudioPresent();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<{ title: string; href: string; detail: string }[]>([]);
  const [threads, setThreads] = useState<{ threadId: string; role: string; state: string }[]>([]);
  const [comments, setComments] = useState<{ id: string; body: string; resolvedAt: number | null }[]>([]);
  const [versions, setVersions] = useState<{ id: string; label: string; createdAt: number }[]>([]);
  const [commentText, setCommentText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const call = <T,>(method: string, input: object, outputSchema: z.ZodType<T>) =>
      sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema });
    Promise.all([call("links", { ref: item }, linksSchema), call("itemThreads", { ref: item }, threadsSchema),
      call("comments", { ref: item }, commentsSchema), call("versions", { ref: item }, versionsSchema)])
      .then(async ([graph, threadResult, commentResult, versionResult]) => {
        const edges = [...graph.backlinks.map((link) => ({ ref: link.from, detail: `Linked by ${link.source}` })), ...graph.outgoing.map((link) => ({ ref: link.to, detail: link.kind }))];
        const entries = await Promise.all(edges.map(async ({ ref, detail }) => {
          const { item: related } = await call("itemAt", ref, itemSchema).catch(() => ({ item: null }));
          return related ? { title: related.title || "Untitled", href: related.href, detail } : null;
        }));
        if (!cancelled) { setLinks(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)); setThreads(threadResult.threads); setComments(commentResult.comments); setVersions(versionResult.versions); }
      }).catch(() => { if (!cancelled) { setLinks([]); setThreads([]); } });
    return () => { cancelled = true; };
  }, [open, item.pluginId, item.id, sdk]);
  if (!studio) return null;
  return <div className="relative">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-sm shadow-sm hover:bg-state-hover">
      <Icon name="Link" className="size-4" /> Related
    </button>
    {open ? <div className="absolute top-10 right-0 z-30 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-border bg-background p-3 shadow-xl">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">Related items</div>
      {links.length ? links.map((link, index) => <a key={`${link.href}:${index}`} href={link.href} className="block rounded px-2 py-1.5 text-sm hover:bg-state-hover">{link.title}<span className="block text-xs text-muted-foreground">{link.detail}</span></a>) : <p className="px-2 text-sm text-muted-foreground">No related items.</p>}
      <div className="mt-3 mb-2 text-xs font-semibold text-muted-foreground">Threads about this</div>
      {threads.length ? threads.map((thread) => <a key={thread.threadId} href={`/threads/${thread.threadId}`} className="block rounded px-2 py-1.5 text-sm hover:bg-state-hover">{thread.role}<span className="block text-xs text-muted-foreground">{thread.state}</span></a>) : <p className="px-2 text-sm text-muted-foreground">No threads yet.</p>}
      <div className="mt-3 mb-2 text-xs font-semibold text-muted-foreground">Comments</div>
      {comments.length ? comments.map((comment) => <p key={comment.id} className="rounded px-2 py-1.5 text-sm">{comment.body}{comment.resolvedAt ? <span className="ml-1 text-xs text-muted-foreground">Resolved</span> : null}</p>) : <p className="px-2 text-sm text-muted-foreground">No comments yet.</p>}
      {item.pluginId !== "pages" ? <form className="mt-2 flex gap-1" onSubmit={(event) => {
        event.preventDefault();
        const body = commentText.trim();
        if (!body) return;
        void sdk.plugins.callRpc({ pluginId: "studio", method: "commentCreate", input: { ref: { pluginId: item.pluginId, id: item.id }, parentId: null, anchor: null, actor: { kind: "user" }, body }, outputSchema: z.object({ comment: commentsSchema.shape.comments.element }) })
          .then(({ comment }) => { setComments((current) => [...current, comment]); setCommentText(""); setError(""); }).catch(() => setError("Could not post comment."));
      }}><input aria-label="New comment" value={commentText} onChange={(event) => setCommentText(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm" /><button type="submit" className="rounded border border-border px-2 text-sm">Post</button></form> : null}
      {error ? <p role="alert" className="px-2 text-xs text-destructive">{error}</p> : null}
      <div className="mt-3 mb-2 text-xs font-semibold text-muted-foreground">Versions</div>
      {versions.length ? versions.map((version) => <p key={version.id} className="rounded px-2 py-1 text-sm">{version.label}<span className="block text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</span></p>) : <p className="px-2 text-sm text-muted-foreground">No saved versions.</p>}
    </div> : null}
  </div>;
}
