import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { Icon } from "../ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useCompanionNavigate } from "./float";
import { ItemLinkText, ItemLinkTextarea } from "./item-links";
import { useStudioPresent } from "./presence";
import { studioItemProps, studioThreadProps } from "./studio-item";

export interface RelatedRef { pluginId: string; id: string }
const refSchema = z.object({ pluginId: z.string(), id: z.string() });
const linkSchema = z.object({ from: refSchema, to: refSchema, kind: z.string(), source: z.string() });
const linksSchema = z.object({ outgoing: z.array(linkSchema), backlinks: z.array(linkSchema) });
const threadsSchema = z.object({ threads: z.array(z.object({ threadId: z.string(), state: z.string(), role: z.string() }).passthrough()) });
const itemSchema = z.object({ item: z.object({ title: z.string(), href: z.string() }).passthrough().nullable(), kind: z.unknown().nullable() });
const commentsSchema = z.object({ comments: z.array(z.object({ id: z.string(), parentId: z.string().nullable(), body: z.string(), resolvedAt: z.number().nullable() }).passthrough()) });
const versionsSchema = z.object({ versions: z.array(z.object({ id: z.string(), label: z.string(), createdAt: z.number() }).passthrough()) });

/** Related items and threads from Studio. Hidden when the hub is absent. */
export function RelatedPanel({ ref: item, compact = false }: { ref: RelatedRef; compact?: boolean }) {
  const sdk = useSdk();
  const studio = useStudioPresent();
  const companionNavigate = useCompanionNavigate();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<{ title: string; href: string; detail: string }[]>([]);
  const [threads, setThreads] = useState<{ threadId: string; role: string; state: string }[]>([]);
  const [comments, setComments] = useState<z.infer<typeof commentsSchema>["comments"]>([]);
  const [versions, setVersions] = useState<{ id: string; label: string; createdAt: number }[]>([]);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshComments = () => sdk.plugins.callRpc({ pluginId: "studio", method: "comments", input: { ref: { pluginId: item.pluginId, id: item.id } }, outputSchema: commentsSchema })
    .then(({ comments }) => setComments(comments));
  const createComment = (body: string, parentId: string | null) => {
    setBusy(true);
    setError("");
    void sdk.plugins.callRpc({ pluginId: "studio", method: "commentCreate", input: { ref: { pluginId: item.pluginId, id: item.id }, parentId, anchor: null, actor: { kind: "user" }, body }, outputSchema: z.object({ comment: commentsSchema.shape.comments.element }) })
      .then(() => refreshComments())
      .then(() => { setCommentText(""); setReplyText(""); setReplyTo(null); })
      .catch(() => setError("Could not post comment."))
      .finally(() => setBusy(false));
  };
  const resolveComment = (id: string, resolved: boolean) => {
    setBusy(true);
    setError("");
    void sdk.plugins.callRpc({ pluginId: "studio", method: "commentResolve", input: { ref: { pluginId: item.pluginId, id: item.id }, id, resolved }, outputSchema: z.object({ ok: z.boolean() }) })
      .then(({ ok }) => { if (!ok) throw new Error("Comment not found"); return refreshComments(); })
      .catch(() => setError("Could not update comment."))
      .finally(() => setBusy(false));
  };
  const rootComments = comments.filter((comment) => comment.parentId === null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLinks([]);
    setThreads([]);
    setComments([]);
    setVersions([]);
    setReplyTo(null);
    setReplyText("");
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
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" aria-label="Related" title={compact ? "Related items" : undefined} className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-sm shadow-sm hover:bg-state-hover">
      <Icon name="Layers" className="size-4" /> {compact ? null : "Related"}
    </button></PopoverTrigger>
    <PopoverContent data-studio-related-panel="" aria-label="Related items" align="end" sideOffset={8} className="max-h-[min(70vh,var(--radix-popover-content-available-height))] w-72 max-w-[calc(100vw-1rem)] rounded-lg bg-background p-3 shadow-xl">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">Related items</div>
      {links.length ? links.map((link, index) => <a key={`${link.href}:${index}`} href={link.href} {...studioItemProps(link)} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && companionNavigate({ kind: "path", path: link.href })) event.preventDefault(); }} className="block rounded px-2 py-1.5 text-sm hover:bg-state-hover">{link.title}<span className="block text-xs text-muted-foreground">{link.detail}</span></a>) : <p className="px-2 text-sm text-muted-foreground">No related items.</p>}
      <div className="mt-3 mb-2 text-xs font-semibold text-muted-foreground">Threads about this</div>
      {threads.length ? threads.map((thread) => <a key={thread.threadId} href={`/threads/${thread.threadId}`} {...studioThreadProps(thread.threadId, thread.role)} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && companionNavigate({ kind: "thread", threadId: thread.threadId })) event.preventDefault(); }} className="block rounded px-2 py-1.5 text-sm hover:bg-state-hover">{thread.role}<span className="block text-xs text-muted-foreground">{thread.state}</span></a>) : <p className="px-2 text-sm text-muted-foreground">No threads yet.</p>}
      <div className="mt-3 mb-2 text-xs font-semibold text-muted-foreground">Comments</div>
      {rootComments.length ? rootComments.map((comment) => <div key={comment.id} className="border-b border-border/70 px-2 py-2 last:border-b-0">
        <p className="whitespace-pre-wrap break-words text-sm"><ItemLinkText text={comment.body} /></p>
        {comments.filter((reply) => reply.parentId === comment.id).map((reply) => <p key={reply.id} className="mt-2 border-l border-border pl-2 text-sm whitespace-pre-wrap break-words"><ItemLinkText text={reply.body} /></p>)}
        <div className="mt-2 flex items-center gap-3 text-xs">
          {comment.resolvedAt ? <span className="text-muted-foreground">Resolved</span> : <button type="button" disabled={busy} onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)} className="text-foreground underline-offset-2 hover:underline focus-visible:underline">Reply</button>}
          <button type="button" disabled={busy} onClick={() => resolveComment(comment.id, !comment.resolvedAt)} className="text-foreground underline-offset-2 hover:underline focus-visible:underline">{comment.resolvedAt ? "Reopen" : "Resolve"}</button>
        </div>
        {replyTo === comment.id && !comment.resolvedAt ? <form className="mt-2 flex flex-col gap-1" onSubmit={(event) => { event.preventDefault(); const body = replyText.trim(); if (body) createComment(body, comment.id); }}>
          <ItemLinkTextarea aria-label="Reply to comment" placeholder="Reply… @ links an item" rows={2} value={replyText} onValueChange={setReplyText} className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm" />
          <button type="submit" disabled={busy || !replyText.trim()} className="self-end rounded border border-border px-2 text-sm disabled:opacity-50">Post reply</button>
        </form> : null}
      </div>) : <p className="px-2 text-sm text-muted-foreground">No comments yet.</p>}
      {item.pluginId !== "pages" ? <form className="mt-2 flex gap-1" onSubmit={(event) => {
        event.preventDefault();
        const body = commentText.trim();
        if (!body) return;
        createComment(body, null);
      }}><ItemLinkTextarea aria-label="New comment" placeholder="Comment… @ links an item" rows={1} value={commentText} onValueChange={setCommentText} wrapperClassName="min-w-0 flex-1" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} className="block w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm" /><button type="submit" disabled={busy || !commentText.trim()} className="rounded border border-border px-2 text-sm disabled:opacity-50">Post</button></form> : null}
      {error ? <p role="alert" className="px-2 text-xs text-destructive">{error}</p> : null}
      <div className="mt-3 mb-2 text-xs font-semibold text-muted-foreground">Versions</div>
      {versions.length ? versions.map((version) => <p key={version.id} className="rounded px-2 py-1 text-sm">{version.label}<span className="block text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</span></p>) : <p className="px-2 text-sm text-muted-foreground">No saved versions.</p>}
    </PopoverContent>
  </Popover>;
}
