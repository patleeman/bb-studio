// "Changed by <Bot>": the edits a Bot made to its own profile (name,
// description, emoji, shape, color, avatar image), each with a small diff and
// Revert, which restores the old value. Reverts are listed too. Shown in the
// Profile section of Bot info.
import { relativeTime } from "../../kit/format";
import { useState } from "react";
import type { BotProfileChangeView } from "../../contract";
import { useLive } from "../live";
import { useAction } from "./BotHome";

const FIELD_LABEL: Record<BotProfileChangeView["field"], string> = {
  name: "name", role: "description", avatar: "emoji", shape: "shape", color: "color", avatarImage: "avatar",
};

/** Who made a change: the Bot by name, an agent elsewhere, or you (a revert). */
export function changedBy(change: BotProfileChangeView): string {
  if (change.reverts !== null) return "You reverted";
  return `Changed by ${change.actorName ?? "an agent"}`;
}

function Value({ change, side }: { change: BotProfileChangeView; side: "old" | "new" }) {
  const value = side === "old" ? change.oldValue : change.newValue;
  const url = side === "old" ? change.oldImageUrl : change.newImageUrl;
  const struck = side === "old" ? "text-muted-foreground line-through" : "";
  if (change.field === "avatarImage") {
    if (url) return <img src={url} alt={side === "old" ? "Old avatar" : "New avatar"} className="size-5 shrink-0 rounded-full object-cover" />;
    return <span className={`shrink-0 text-xs ${struck}`}>{value ? "an image" : "drawn"}</span>;
  }
  if (change.field === "color" && value) return <span className="size-3.5 shrink-0 rounded-full" style={{ background: value }} title={value} aria-label={value} />;
  return <span className={`min-w-0 truncate text-xs ${struck}`} title={value ?? undefined}>{value || (change.field === "shape" ? "emoji" : "empty")}</span>;
}

/** The Bot's own profile edits, newest first; `limit` rows, or all. */
export function ProfileChanges({ botId, onChanged, limit = 5 }: { botId: string; onChanged(): void; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const changes = useLive("bot_profile_changes", { botId }, { pollMs: 30_000 });
  const { run, busy, error } = useAction(() => { changes.refresh(); onChanged(); }, botId);
  const list = (changes.data?.changes ?? []).slice(0, limit);
  return (
    <section aria-label="Profile changes" className="flex flex-col">
      <button type="button" aria-expanded={expanded} aria-controls="bot-profile-changes-content" onClick={() => setExpanded((open) => !open)}
        className="self-start rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
        Profile changes
      </button>
      <div id="bot-profile-changes-content" hidden={!expanded}>
        {list.length ? <ul className="flex flex-col">
          {list.map((change) => (
            <li key={change.id} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm" data-testid="bot-profile-change">
              <span className="shrink-0 text-xs text-muted-foreground">{changedBy(change)} {FIELD_LABEL[change.field]}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <Value change={change} side="old" />
                <span aria-hidden className="shrink-0 text-xs text-muted-foreground">→</span>
                <Value change={change} side="new" />
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(change.at)}</span>
              {change.reverts === null && change.revertedAt === null
                ? <button type="button" className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" disabled={!!busy}
                    aria-label={`Revert ${FIELD_LABEL[change.field]}`} onClick={() => void run("bot_profile_revert", { changeId: change.id })}>Revert</button>
                : change.revertedAt !== null ? <span className="shrink-0 text-xs text-muted-foreground">Reverted</span> : null}
            </li>
          ))}
        </ul> : <p className="px-1.5 py-1 text-xs text-muted-foreground">{changes.loading && !changes.data ? "Loading…" : "No profile changes yet."}</p>}
        {error ? <p role="alert" className="px-1.5 text-xs text-destructive">{error}</p> : null}
      </div>
    </section>
  );
}
