import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { openAppPath } from "@bb-studio/kit/app";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMutationErrorMessage } from "../ui/mutation-errors.js";
import type { SidebarThread } from "../model/sidebar-thread.js";

type Drop = { threads: SidebarThread[]; nest?: () => Promise<unknown> };
export function channelDropThreads(sources: readonly SidebarThread[], target: SidebarThread | undefined) {
  if (!target || sources.some(thread => thread.id === target.id)) return [];
  const threads = [...new Map([target, ...sources].map(thread => [thread.id, thread])).values()];
  return threads.length >= 2 && threads.length <= 32 ? threads : [];
}
export function useThreadChannelDrop() {
  const sdk = useSdk();
  const [drop, setDrop] = useState<Drop | null>(null), [name, setName] = useState("");
  const [pending, setPending] = useState(false), [available, setAvailable] = useState<boolean | null>(null), [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID()), busy = useRef(false), generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const close = () => { if (!busy.current) { generation.current++; setDrop(null); } };
  const offer = useCallback((threads: SidebarThread[], nest?: () => Promise<unknown>) => {
    const seq = ++generation.current;
    requestId.current = crypto.randomUUID();
    setDrop({ threads, nest }); setName(threads.map(thread => thread.title || thread.titleFallback || "Thread").join(" + ").slice(0, 80)); setError(null); setAvailable(null);
    void Promise.resolve().then(() => sdk.plugins.callRpc({ pluginId: "bot-teams", method: "views", input: {}, outputSchema: z.array(z.object({ id: z.string() })), signal: AbortSignal.timeout(10_000) })).then(() => { if (seq === generation.current) setAvailable(true); }, () => { if (seq === generation.current) setAvailable(false); });
  }, [sdk]);
  const act = async (create: boolean) => {
    if (!drop || busy.current) return;
    busy.current = true; setPending(true); setError(null);
    const seq = generation.current;
    try {
      if (create) {
        const channel = await sdk.plugins.callRpc({ pluginId: "bot-teams", method: "viewCreate", input: { name: name.trim(), members: drop.threads.map(thread => ({ kind: "thread", id: thread.id })), requestId: requestId.current }, outputSchema: z.object({ id: z.string() }), signal: AbortSignal.timeout(10_000) });
        if (seq === generation.current) { setDrop(null); openAppPath(`/plugins/bot-teams/channels/${channel.id}`); }
      } else { await drop.nest?.(); setDrop(null); }
    } catch (cause) { setError(getMutationErrorMessage({ error: cause, fallbackMessage: "Could not combine these threads." })); }
    finally { busy.current = false; setPending(false); }
  };
  const dialog = <Dialog open={!!drop} onOpenChange={open => { if (!open) close(); }}><DialogContent>
    <DialogHeader><DialogTitle>Combine threads</DialogTitle><DialogDescription>Create a channel to view and message these threads together. Each thread keeps its project and history.</DialogDescription></DialogHeader>
    <ul className="max-h-40 overflow-auto space-y-1 text-sm">{drop?.threads.map(thread => <li key={thread.id} className="truncate">{thread.title || thread.titleFallback || "New thread"}</li>)}</ul>
    <form onSubmit={event => { event.preventDefault(); void act(true); }} className="space-y-4">
      {available !== false && <label className="block space-y-1.5 text-sm"><span>Channel name</span><Input aria-label="Channel name" value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={pending} /></label>}
      {available === false && <p className="text-sm text-muted-foreground">Enable Studio Teams to create channels.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="ghost" disabled={pending} onClick={close}>Cancel</Button>{drop?.nest && <Button type="button" variant="outline" disabled={pending} onClick={() => void act(false)}>Nest threads</Button>}{available !== false && <Button type="submit" disabled={pending || !available || !name.trim()}>{pending ? "Saving…" : "Create channel"}</Button>}</DialogFooter>
    </form>
  </DialogContent></Dialog>;
  return { offer, dialog };
}
