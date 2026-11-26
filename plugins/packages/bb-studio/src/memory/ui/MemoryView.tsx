// The Memory page (`/plugins/studio/studio/memory`), on the Bot-page
// template (src/ui/bot-page): one Bot's memory in three layers, top to bottom
// (plan "BB Studio Memory & Skills Architecture"):
//
// 1. Core: its always-on skills (src/core-skill.ts), in every prompt. The
//    core skill's sections (Preferences, Right now, Check-in, and any others
//    it has) are edited in place, with the shared character budget beside
//    the heading ("1,420 / 2,000 chars") and each capped section's lines.
// 2. Skills: the on-demand skills, loaded when a task matches. A row opens
//    its editor and version history; + New skill adds one. One control row:
//    Auto-learn (daily and when a conversation is archived), with Run now.
// 3. History: Summaries (default), the archived conversations' summaries as
//    cards, or Past conversations, every conversation with full-text search.
//    A card or row opens the conversation beside the page.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "../../kit/app/index";
import { Button } from "../../kit/ui/button";
import { Input } from "../../kit/ui/input";
import { Switch } from "../../kit/ui/switch";
import { Textarea } from "../../kit/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../../kit/ui/toggle-group";
import { cn } from "../../kit/ui/index";
import { errorMessage, relativeTime } from "../../kit/format";
import { CORE_SECTIONS, bulletCount, canonicalSection, sectionCap, sectionText, withSection } from "../../core-skill";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageRow, noMatch, useRowOpen } from "../../ui/bot-page";
import { useCall, useLive } from "../../ui/live";
import { lastBot } from "../../ui/bot/selection";
import { SkillDetail } from "../../ui/skills/SkillsPage";
import { conversationDetail, Highlighted, searchWords, SEARCH_DEBOUNCE_MS, useDebounced } from "../../ui/conversations/OlderPage";
import { shortDate } from "../../ui/conversations/finish";
import { summarySections } from "../../ui/conversations/model";

const SMALL = "h-7 px-2.5 text-xs font-normal";
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const chars = (value: number) => value.toLocaleString("en-US");
/** Part of bot_skill_write's SKILL_CHANGED refusal (src/bot-skills.ts), which the UI can't import. */
const SKILL_CHANGED_HINT = "changed since you opened it";

/** A skill body split at its `## ` headings: the text before the first, then each section. */
export function splitSections(body: string): { preamble: string; sections: { heading: string; text: string }[] } {
  const lines = body.split("\n");
  const sections: { heading: string; lines: string[] }[] = [];
  const preamble: string[] = [];
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (heading) sections.push({ heading, lines: [] });
    else (sections.at(-1)?.lines ?? preamble).push(line);
  }
  return { preamble: preamble.join("\n").trim(), sections: sections.map((section) => ({ heading: section.heading, text: section.lines.join("\n").trim() })) };
}

/** The sections the Core layer shows: the three defaults first (empty when the skill lacks one), then any others in the skill's order. */
export function coreSections(body: string): { heading: string; text: string; missing: boolean }[] {
  const { sections } = splitSections(body);
  const found = (name: string) => sections.find((section) => canonicalSection(section.heading) === name);
  return [
    ...CORE_SECTIONS.map((name) => { const section = found(name); return section ? { ...section, missing: false } : { heading: name, text: "", missing: true }; }),
    ...sections.filter((section) => !canonicalSection(section.heading)).map((section) => ({ ...section, missing: false })),
  ];
}

/** The view for the Bot the route names, else the Bot last picked in this window, else the one on screen. */
export default function MemoryView({ botId: routeBot }: { botId: string | null }) {
  const spaces = useLive("bot_spaces", {}, { pollMs: 120_000 });
  const botId = routeBot ?? lastBot() ?? spaces.data?.currentBotId ?? null;
  const bot = spaces.data?.bots?.find((each) => each.id === botId) ?? null;
  if (!botId) return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground" data-testid="memory-view">{spaces.error ?? "Loading memory…"}</div>;
  return (
    <BotPageLayout testId="memory-view" title="Memory" bot={bot?.name} botId={bot?.id}>
      <CoreLayer key={`core-${botId}`} botId={botId} />
      <SkillsLayer key={`skills-${botId}`} botId={botId} />
      <HistoryLayer key={`history-${botId}`} botId={botId} />
    </BotPageLayout>
  );
}

// ---- Layer 1: Core -----------------------------------------------------------

function CoreLayer({ botId }: { botId: string }) {
  const call = useCall();
  const core = useLive("bot_core", { botId }, { pollMs: 30_000 });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = core.data;
  const skill = data?.skills.find((each) => each.core) ?? null;
  const others = data?.skills.filter((each) => each !== skill) ?? [];
  /**
   * Saves one section (or a whole other skill) into the latest text: the
   * skill is read again first, so the Bot's edit to another section stays.
   * If this section changed since the edit began, nothing is written and
   * the newer text comes back as a conflict; saving again replaces it.
   */
  const save = async (name: string, section: string | null, base: string, text: string): Promise<{ conflict: string } | null> => {
    setError(null);
    try {
      const latest = (await call("bot_core", { botId })).skills.find((each) => each.name === name);
      if (!latest) { setError(`${name} is gone.`); return null; }
      const current = section === null ? latest.body : sectionText(latest.body, section) ?? "";
      if (current.trim() !== base.trim()) return { conflict: current };
      const body = section === null ? text : withSection(latest.body, section, text);
      // A compare-and-swap (ifBody, as the phone writes): if the Bot changed the skill after this read, nothing is written.
      await call("bot_skill_write", { botId, name, description: latest.description, body, ifBody: latest.body });
      setEditing(null);
      core.refresh();
      return null;
    } catch (cause) {
      const message = errorMessage(cause) ?? "";
      if (message.includes(SKILL_CHANGED_HINT)) {
        // Changed between the read and the write: show what it says now, as a conflict.
        const now = (await call("bot_core", { botId }).catch(() => null))?.skills.find((each) => each.name === name);
        if (now) return { conflict: section === null ? now.body : sectionText(now.body, section) ?? "" };
      }
      setError(message || "It didn't save.");
      return null;
    }
  };
  const budget = data ? (
    <span data-testid="memory-budget" className={cn("tabular-nums", data.over ? "text-warning" : "text-muted-foreground")} title="Always-on skills go into every prompt">
      {chars(data.chars)} / {chars(data.cap)} chars
    </span>
  ) : null;
  return (
    <BotPageGroup title="Core" testId="memory-core" aside={budget}>
      {error || core.error ? <p role="alert" className="px-2 text-sm text-destructive">{error ?? core.error}</p> : null}
      {!data ? <p className="px-2 text-sm text-muted-foreground">Loading…</p> : !skill ? (
        <BotPageEmpty testId="memory-core-empty" title="No always-on skill" />
      ) : (
        <div className="flex flex-col">
          {coreSections(skill.body).map((section) => {
            const id = `${skill.name}:${section.heading}`;
            return (
              <CoreSection key={id} heading={section.heading} text={section.text} cap={sectionCap(section.heading)} editing={editing === id}
                onEdit={() => setEditing(id)} onCancel={() => setEditing(null)}
                onSave={(base, text) => save(skill.name, section.heading, base, text)} />
            );
          })}
          {others.map((other) => (
            <CoreSection key={other.name} heading={other.name} text={other.body} cap={null} editing={editing === other.name}
              onEdit={() => setEditing(other.name)} onCancel={() => setEditing(null)} onSave={(base, body) => save(other.name, null, base, body)} />
          ))}
          {data.skills.flatMap((each) => each.warnings).length ? (
            <ul data-testid="memory-core-warnings" className="flex flex-col gap-1 px-2 pt-2 text-xs">
              {[...new Set(data.skills.flatMap((each) => each.warnings))].map((warning) => <li key={warning} className="flex items-start gap-1.5"><Icon name="AlertTriangle" aria-hidden className="mt-px size-3.5 shrink-0 text-warning" /><span>{warning}</span></li>)}
            </ul>
          ) : null}
        </div>
      )}
    </BotPageGroup>
  );
}

function CoreSection({ heading, text, cap, editing, onEdit, onCancel, onSave }: { heading: string; text: string; cap: number | null; editing: boolean; onEdit(): void; onCancel(): void; onSave(base: string, text: string): Promise<{ conflict: string } | null> }) {
  const [draft, setDraft] = useState(text);
  // The text the edit started from: a refresh (the 30 s poll) doesn't touch an open draft.
  const [base, setBase] = useState(text);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => { if (editing) { setDraft(textRef.current); setBase(textRef.current); setConflict(null); } }, [editing]);
  const lines = bulletCount(editing ? draft : text);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await onSave(base, draft);
      // Changed while you edited: show the newer text; saving again replaces it.
      if (result) { setConflict(result.conflict); setBase(result.conflict); }
    } finally { setSaving(false); }
  };
  return (
    <section data-testid="memory-core-section" data-section={heading} className="group/section flex flex-col gap-1 border-b border-border/60 px-2 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{heading}</h3>
        {!editing ? <Button type="button" variant="ghost" size="sm" data-testid="memory-section-edit" className={cn(SMALL, "opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100")} aria-label={`Edit ${heading}`} onClick={onEdit}>Edit</Button> : null}
        {cap ? <span data-testid="memory-section-lines" className={cn("text-xs tabular-nums", lines > cap ? "text-warning" : "text-muted-foreground")}>{lines} / {cap}</span> : null}
      </div>
      {editing ? (
        <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
          <Textarea aria-label={heading} data-testid="memory-section-input" autoFocus value={draft} rows={Math.min(14, Math.max(3, draft.split("\n").length + 1))}
            onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event); }}
            className="font-mono text-xs leading-relaxed" placeholder="- One line per rule" />
          {conflict !== null ? (
            <div role="alert" data-testid="memory-section-conflict" className="flex flex-col gap-1 rounded-md border border-warning/40 px-2.5 py-2 text-xs">
              <span className="text-foreground">This changed while you edited. Now it reads:</span>
              <span className="whitespace-pre-wrap text-muted-foreground">{conflict || "(empty)"}</span>
              <span className="text-foreground">Save again to replace it with yours.</span>
            </div>
          ) : null}
          <div className="flex gap-1">
            <Button type="submit" size="sm" className={SMALL} disabled={saving} data-testid="memory-section-save">{conflict !== null ? "Replace" : "Save"}</Button>
            <Button type="button" variant="ghost" size="sm" className={SMALL} onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      ) : text ? (
        <button type="button" onClick={onEdit} className="rounded-sm text-left text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{text}</button>
      ) : (
        <button type="button" onClick={onEdit} className="rounded-sm text-left text-[13px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Add a line</button>
      )}
    </section>
  );
}

// ---- Layer 2: Skills ---------------------------------------------------------

function SkillsLayer({ botId }: { botId: string }) {
  const call = useCall();
  const skills = useLive("bot_skills", { botId }, { pollMs: 30_000 });
  const learning = useLive("bot_learning", { botId }, { pollMs: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  const shown = (skills.data?.skills ?? []).filter((skill) => !skill.alwaysOn && skill.state !== "archived");
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await run(); skills.refresh(); learning.refresh(); } catch (cause) { setError(errorMessage(cause) || "That didn't work."); } finally { setBusy(false); }
  };
  const revert = (version: { id: number }) => void act(() => call("bot_skill_revert", { botId, versionId: version.id }));
  const learn = learning.data;
  return (
    <BotPageGroup title="Skills" testId="memory-skills"
      aside={<Button type="button" variant="ghost" size="sm" data-testid="memory-skill-new" className={SMALL} onClick={() => setAdding(true)}><Icon name="Plus" aria-hidden />New skill</Button>}>
      {error || skills.error ? <p role="alert" className="px-2 text-sm text-destructive">{error ?? skills.error}</p> : null}
      {adding ? <NewSkill taken={(skills.data?.skills ?? []).map((skill) => skill.name)} onCancel={() => setAdding(false)}
        onSave={(input) => act(async () => { await call("bot_skill_write", { botId, ...input }); setAdding(false); setSelected(input.name); })} /> : null}
      {skills.data && !shown.length && !adding ? <BotPageEmpty testId="memory-skills-empty" title="No skills yet" hint="The Bot saves a way of working as a skill when it will come up again." /> : null}
      {shown.map((skill) => (
        <div key={skill.name} className="flex flex-col">
          <BotPageRow testId="memory-skill" data={{ "data-skill": skill.name }} icon="Toolbox" title={skill.name} titleText={`${skill.name}: ${skill.description}`}
            detail={skill.description} selected={selected === skill.name}
            status={skill.state === "stale" ? { label: "Stale", tone: "warning" } : null}
            meta={skill.usedAt ? `used ${relativeTime(skill.usedAt, now)}` : relativeTime(skill.updatedAt, now)}
            onOpen={() => setSelected(selected === skill.name ? null : skill.name)} />
          {selected === skill.name ? <SkillDetail botId={botId} name={skill.name} description={skill.description} busy={busy} revert={revert} editable onSaved={() => skills.refresh()} /> : null}
        </div>
      ))}
      {learn ? (
        <div data-testid="memory-autolearn" className="mt-1 flex min-w-0 items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Switch size="sm" checked={learn.enabled} disabled={busy} aria-label="Auto-learn" onCheckedChange={(enabled) => void act(() => call("bot_learning_set", { botId, enabled }))} />
          <span className="text-foreground">Auto-learn</span>
          <span>Daily + on archive</span>
          <span className="min-w-0 flex-1 truncate" data-testid="memory-autolearn-status">
            {learn.reviewing ? "· Reviewing now…" : learn.lastReview ? `· ${learn.lastReview.result}, ${relativeTime(learn.lastReview.at, now)}` : ""}
          </span>
          <Button type="button" variant="outline" size="sm" data-testid="memory-autolearn-run" className={SMALL} disabled={busy || !learn.enabled || learn.reviewing}
            onClick={() => void act(() => call("bot_learning_review", { botId }))}>Run now</Button>
        </div>
      ) : null}
    </BotPageGroup>
  );
}

function NewSkill({ taken, onSave, onCancel }: { taken: readonly string[]; onSave(input: { name: string; description: string; body: string }): Promise<void>; onCancel(): void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const problem = !name ? null : !SKILL_NAME.test(name) ? "Lowercase words joined by hyphens, like weekly-review." : taken.includes(name) ? `There's a skill named ${name} already.` : null;
  const ready = !!name && !problem && !!description.trim() && !!body.trim();
  return (
    <form data-testid="memory-skill-form" className="flex flex-col gap-2 rounded-md border border-border p-3" onSubmit={(event) => { event.preventDefault(); if (ready) void onSave({ name, description: description.trim(), body }); }}>
      <Input aria-label="Skill name" placeholder="weekly-review" value={name} autoFocus onChange={(event) => setName(event.target.value.trim())} className="h-8 font-mono text-xs" />
      {problem ? <p className="text-xs text-warning">{problem}</p> : null}
      <Input aria-label="When to use it" placeholder="When to use it, in one sentence" value={description} onChange={(event) => setDescription(event.target.value)} className="h-8 text-sm" />
      <Textarea aria-label="Instructions" placeholder="The steps and the pitfalls" value={body} rows={6} onChange={(event) => setBody(event.target.value)} className="font-mono text-xs" />
      <div className="flex gap-1">
        <Button type="submit" size="sm" className={SMALL} disabled={!ready}>Save skill</Button>
        <Button type="button" variant="ghost" size="sm" className={SMALL} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ---- Layer 3: History --------------------------------------------------------

type HistoryView = "summaries" | "conversations";

function HistoryLayer({ botId }: { botId: string }) {
  const [view, setView] = useState<HistoryView>("summaries");
  const [query, setQuery] = useState("");
  const words = searchWords(query);
  const control = (
    <ToggleGroup type="single" size="sm" value={view} aria-label="History" data-testid="memory-history-view" onValueChange={(next) => { if (next) setView(next as HistoryView); }}>
      <ToggleGroupItem value="summaries" className="h-7 px-2.5 text-xs">Summaries</ToggleGroupItem>
      <ToggleGroupItem value="conversations" className="h-7 px-2.5 text-xs">Past conversations</ToggleGroupItem>
    </ToggleGroup>
  );
  return (
    <BotPageGroup title="History" testId="memory-history" aside={control}>
      <div className="px-2 pb-2">
        <Input type="search" aria-label={view === "summaries" ? "Search summaries" : "Search past conversations"} data-testid="memory-history-search" value={query}
          placeholder={view === "summaries" ? "Search summaries" : "Search every message"} onChange={(event) => setQuery(event.target.value)} className="h-8 text-sm" />
      </div>
      {view === "summaries" ? <Summaries botId={botId} words={words} query={query} clear={() => setQuery("")} /> : <PastConversations botId={botId} words={words} query={query} clear={() => setQuery("")} />}
    </BotPageGroup>
  );
}

function Summaries({ botId, words, query, clear }: { botId: string; words: readonly string[]; query: string; clear(): void }) {
  const rowOpen = useRowOpen();
  const live = useLive("bot_summaries", { botId }, { pollMs: 60_000 });
  const now = Date.now();
  const all = live.data?.summaries ?? [];
  const shown = all.filter((each) => !words.length || words.every((word) => `${each.title}\n${each.summary}`.toLowerCase().includes(word)));
  if (live.error && !live.data) return <p role="alert" className="px-2 text-sm text-destructive">{live.error}</p>;
  if (!live.data) return <p className="px-2 text-sm text-muted-foreground">Loading…</p>;
  if (!shown.length) return <BotPageEmpty testId="memory-summaries-empty" {...(words.length ? { title: noMatch("summaries", query), action: { label: "Clear search", onClick: clear } } : { title: "No summaries yet", hint: "Archiving a conversation writes its summary here." })} />;
  return (
    <div className="flex flex-col gap-2 px-2">
      {shown.map((each) => {
        const open = rowOpen({ kind: "conversation", id: each.threadId }, each.title);
        return (
          <article key={each.threadId} data-testid="memory-summary" data-thread-id={each.threadId} className={cn("rounded-md border border-border", open.selected && "border-ring")}>
            <button type="button" onClick={(event) => open.onOpen(event)} className="flex w-full flex-col gap-1.5 rounded-md px-3 py-2.5 text-left hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="flex w-full items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"><Highlighted text={each.title} words={words} /></span>
                <span className="shrink-0 text-xs text-muted-foreground">{shortDate(each.archivedAt, now)}</span>
              </span>
              <SummaryBody summary={each.summary} words={words} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

function SummaryBody({ summary, words }: { summary: string; words: readonly string[] }) {
  const sections = useMemo(() => summarySections(summary), [summary]);
  return (
    <span className="flex flex-col gap-1 text-xs leading-relaxed">
      {sections.map((section, index): ReactNode => (
        <span key={`${section.heading}-${index}`} className="flex flex-col">
          {section.heading ? <span className="font-medium text-muted-foreground">{section.heading}</span> : null}
          {section.items.slice(0, 4).map((item, at) => <span key={at} className="line-clamp-2 text-foreground/90">{section.list || section.items.length > 1 ? "· " : ""}<Highlighted text={item} words={words} /></span>)}
          {section.items.length > 4 ? <span className="text-muted-foreground">+{section.items.length - 4} more</span> : null}
        </span>
      ))}
    </span>
  );
}

function PastConversations({ botId, words, query, clear }: { botId: string; words: readonly string[]; query: string; clear(): void }) {
  const rowOpen = useRowOpen();
  const live = useLive("bot_conversations_all", { botId }, { pollMs: 60_000 });
  const settled = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const search = useLive("bot_conversations_search", { botId, query: settled }, { enabled: settled.length > 0, pollMs: 15_000 });
  const hits = useMemo(() => new Map((settled && search.data?.hits ? search.data.hits : []).map((hit) => [hit.threadId, hit])), [settled, search.data]);
  const now = Date.now();
  const rows = (live.data?.conversations ?? []).filter((row) => !words.length || hits.has(row.threadId) || words.every((word) => row.title.toLowerCase().includes(word)));
  if (live.error && !live.data) return <p role="alert" className="px-2 text-sm text-destructive">{live.error}</p>;
  if (!live.data) return <p className="px-2 text-sm text-muted-foreground">Loading…</p>;
  return (
    <>
      {words.length && search.data?.indexing ? <p data-testid="memory-history-indexing" className="px-2 text-xs text-muted-foreground">Still reading older messages</p> : null}
      {!rows.length ? <BotPageEmpty testId="memory-conversations-empty" {...(words.length ? { title: noMatch("conversations", query), action: { label: "Clear search", onClick: clear } } : { title: "No conversations yet" })} /> : null}
      {rows.map((row) => {
        const detail = conversationDetail(row, hits.get(row.threadId));
        const archived = row.archivedAt !== null;
        return (
          <BotPageRow key={row.threadId} testId="memory-conversation" data={{ "data-thread-id": row.threadId }} icon={archived ? (row.summary ? "CircleCheck" : "Archive") : "MessageSquare"}
            iconClassName={archived && row.summary ? "text-success" : undefined} title={<Highlighted text={row.title} words={words} />} titleText={row.title}
            detail={detail.text ? (detail.snippet ? <Highlighted text={detail.text} words={words} /> : detail.text) : null} detailTone={detail.tone}
            meta={archived ? shortDate(row.updatedAt, now) : relativeTime(row.updatedAt, now)} {...rowOpen({ kind: "conversation", id: row.threadId }, row.title)} />
        );
      })}
    </>
  );
}
