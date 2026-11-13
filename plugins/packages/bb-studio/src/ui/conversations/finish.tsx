// Finishing a conversation on screen (src/bot-finish.ts; mockup 6d):
// - Archiving a conversation writes its summary (src/bot-finish.ts).
// - A finished conversation opens read-only: where its composer goes, "✓
//   Archived on <date>. Read-only." and Reopen (ReadOnlyComposer.tsx).
// - The card in Main, `::finished{thread="thr_…"}`: "✓ Archived: <title>",
//   its dates, the summary's sections, and links back to the conversation
//   and to Memory.
import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { BotThreadInfo, FinishedConversation } from "../../bot-threads-contract";
import { Icon } from "../../kit/app/index";
import { MEMORY_SUBPATH } from "../../memory/shared";
import { errorMessage } from "../../kit/format";
import { useCall, useLive } from "../live";
import { summarySections } from "./model";


/** Whether a thread is a finished conversation (read-only, with Reopen). */
export function isFinished(info: Pick<BotThreadInfo, "kind" | "archivedAt" | "finishedSummary"> | null | undefined): boolean {
  return !!info && info.kind === "conversation" && info.archivedAt !== null && info.finishedSummary !== null;
}

/** "Nov 10", or "Nov 10, 2025" in another year. */
export function shortDate(at: number, now = Date.now()): string {
  const date = new Date(at);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) });
}

/** Where a finished conversation's composer goes: when it was finished, and Reopen. */
export function FinishedBox({ info }: { info: BotThreadInfo }) {
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reopen = async () => {
    setBusy(true);
    setError(null);
    try { await call("bot_reopen", { threadId: info.threadId }); } catch (cause) { setError(errorMessage(cause) || "It didn't reopen."); } finally { setBusy(false); }
  };
  return (
    <div data-testid="finished-box" className="flex min-w-0 items-center gap-2 rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
      <Icon name="CircleCheck" className="size-4 shrink-0 text-success" />
      <span className="min-w-0 flex-1 truncate">{error ? <span role="alert" className="text-destructive">{error}</span> : `Archived on ${shortDate(info.archivedAt!)}. Read-only.`}</span>
      <button type="button" data-testid="finished-reopen" disabled={busy} onClick={() => void reopen()}
        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-state-hover disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Reopen</button>
    </div>
  );
}

/** `::finished{thread="thr_…"}` in Main: the finished conversation's card. */
export function FinishedCard({ attributes }: PluginMessageDirectiveProps) {
  const threadId = attributes.thread ?? "";
  const live = useLive("bot_finished", { threadId }, { enabled: /^[\w-]{3,200}$/.test(threadId), pollMs: 0 });
  const navigate = useBbNavigate();
  const finished: FinishedConversation | null = live.data?.finished ?? null;
  if (!finished) return live.loading ? null : <p data-testid="finished-card-missing" className="text-xs text-muted-foreground">Archived conversation</p>;
  const sections = summarySections(finished.summary);
  return (
    <section data-testid="finished-card" aria-label={`Archived: ${finished.title}`} className="studio-root my-2 flex max-w-xl flex-col gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm">
      <header className="flex items-center gap-2">
        <Icon name="CircleCheck" className="size-4 shrink-0 text-success" />
        <h3 className="min-w-0 flex-1 truncate font-semibold text-foreground">Archived: {finished.title}</h3>
      </header>
      <p className="text-xs text-muted-foreground">{shortDate(finished.startedAt)}{shortDate(finished.startedAt) === shortDate(finished.finishedAt) ? "" : ` – ${shortDate(finished.finishedAt)}`}</p>
      {sections.map((section, index) => (
        <div key={`${section.heading}-${index}`} className="flex flex-col gap-0.5">
          {section.heading ? <h4 className="text-xs font-semibold text-muted-foreground">{section.heading}</h4> : null}
          {section.items.length > 1 || section.list ? (
            <ul className="list-disc pl-4 text-foreground">{section.items.map((item, at) => <li key={at}>{item}</li>)}</ul>
          ) : section.items.map((item, at) => <p key={at} className="text-foreground">{item}</p>)}
        </div>
      ))}
      <footer className="flex flex-wrap items-center gap-3 pt-1 text-xs">
        <button type="button" data-testid="finished-open" onClick={() => navigate.toThread(finished.threadId)} className="text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Open the conversation</button>
        <button type="button" data-testid="finished-memory" onClick={() => navigate.toPluginPanel("studio", { subPath: `${MEMORY_SUBPATH}/${encodeURIComponent(finished.botId)}` })} className="text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">See in Memory</button>
        <span className="text-muted-foreground">{finished.records ? `Saved to Memory as ${finished.records} record${finished.records === 1 ? "" : "s"}` : "Not in Memory yet"}{finished.archived ? "" : " · reopened"}</span>
      </footer>
    </section>
  );
}
