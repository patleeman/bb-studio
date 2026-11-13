import { Fragment, useState } from "react";
import { Icon } from "../../kit/app/index";
import { Button } from "../../kit/ui/button";
import { errorMessage, relativeTime } from "../../kit/format";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageRow, BotPageToolbar, noMatch } from "../bot-page";
import { useCall, useLive } from "../live";
import { matchesSkill, type SkillsFilter } from "./paths";

type Version = { id: number; name: string; description: string | null; body: string | null; diff: string; warnings: string[]; at: number };

const SMALL = "h-7 px-2.5 text-xs font-normal";

function Diff({ diff }: { diff: string }) {
  return (
    <pre data-testid="skill-diff" className="max-h-72 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
      {diff.split("\n").map((line, index) => <Fragment key={index}>{index ? "\n" : ""}<span className={line.startsWith("+") ? "text-success" : line.startsWith("-") ? "text-destructive" : "text-muted-foreground"}>{line}</span></Fragment>)}
    </pre>
  );
}

function VersionRow({ version, showName, busy, open, onToggle, onRevert }: { version: Version; showName: boolean; busy: boolean; open: boolean; onToggle(): void; onRevert(): void }) {
  return (
    <div data-testid="skill-version" data-version={version.id} className="flex flex-col">
      <BotPageRow icon={version.body === null ? "Trash2" : "History"} title={showName ? version.name : `Version ${version.id}`} titleText={version.name}
        status={version.body === null ? { label: "Deleted", tone: "danger" } : version.warnings.length ? { label: version.warnings.length === 1 ? "1 warning" : `${version.warnings.length} warnings`, tone: "warning" } : null}
        meta={relativeTime(version.at)} selected={open} onOpen={onToggle}
        actions={<Button type="button" variant="outline" size="sm" data-testid="skill-revert" disabled={busy} className={SMALL} aria-label={`Revert ${version.name} to version ${version.id}`} onClick={onRevert}><Icon name="RotateCcw" />Revert</Button>} />
      {open ? (
        <div className="flex flex-col gap-2 px-2 pt-1 pb-3 pl-9">
          <Diff diff={version.diff} />
          {version.warnings.length ? (
            <ul className="flex flex-col gap-1 text-xs">
              {version.warnings.map((warning, index) => <li key={index} className="flex items-start gap-1.5"><Icon name="AlertTriangle" className="mt-px size-3.5 shrink-0 text-warning" aria-hidden /><span>{warning}</span></li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Versions({ botId, name, busy, revert }: { botId: string; name?: string; busy: boolean; revert(version: Version): void }) {
  const [cursors, setCursors] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const history = useLive("bot_skill_history", { botId, ...(name ? { name } : {}), ...(cursors.length ? { before: cursors[cursors.length - 1] } : {}) }, { pollMs: 30_000 });
  const versions = history.data?.versions ?? [];
  if (!versions.length) return <BotPageEmpty testId="skill-history-empty">{history.error ?? (history.data ? "No versions" : "Loading…")}</BotPageEmpty>;
  return (
    <>
      {versions.map((version) => <VersionRow key={version.id} version={version} showName={!name} busy={busy} open={open === version.id} onToggle={() => setOpen(open === version.id ? null : version.id)} onRevert={() => revert(version)} />)}
      {cursors.length || versions.length === 50 ? (
        <div className="flex gap-1 px-2 pt-1">
          {cursors.length ? <Button type="button" variant="ghost" size="sm" className={SMALL} onClick={() => setCursors(cursors.slice(0, -1))}>Newer</Button> : null}
          {versions.length === 50 ? <Button type="button" variant="ghost" size="sm" className={SMALL} onClick={() => setCursors([...cursors, versions[49]!.id])}>Older</Button> : null}
        </div>
      ) : null}
    </>
  );
}

function SkillDetail({ botId, name, description, busy, revert }: { botId: string; name: string; description: string; busy: boolean; revert(version: Version): void }) {
  const history = useLive("bot_skill_history", { botId, name }, { pollMs: 30_000 });
  const body = history.data?.versions.find((version) => version.body !== null)?.body ?? null;
  return (
    <div data-testid="skill-detail" className="flex flex-col gap-3 px-2 pt-1 pb-4 pl-9">
      <p className="text-sm text-foreground">{description}</p>
      {body !== null ? <pre data-testid="skill-body" className="max-h-80 overflow-auto rounded-md border border-border px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">{body}</pre> : null}
      <BotPageGroup title="History" count={history.data?.versions.length} testId="skill-history">
        <Versions botId={botId} name={name} busy={busy} revert={revert} />
      </BotPageGroup>
    </div>
  );
}

export default function SkillsPage({ botId: routeBot }: { botId: string | null }) {
  const call = useCall();
  const spaces = useLive("bot_spaces", {}, { pollMs: 120_000 });
  const botId = routeBot ?? spaces.data?.currentBotId ?? null;
  const bot = spaces.data?.bots?.find((each) => each.id === botId) ?? null;
  const skills = useLive("bot_skills", botId ? { botId } : {}, { enabled: !!botId, pollMs: 30_000 });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillsFilter>("skills");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const now = Date.now();
  const run = async (method: "bot_skill_delete" | "bot_skill_restore" | "bot_skill_revert", input: Record<string, unknown>) => {
    if (!botId) return;
    setBusy(true);
    setError(null);
    try {
      await call(method, { botId, ...input } as never);
      skills.refresh();
      setRevision(revision + 1);
    } catch (cause) {
      setError(errorMessage(cause) || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const revert = (version: Version) => void run("bot_skill_revert", { versionId: version.id });
  const remove = (name: string) => { if (confirm(`Delete the skill ${name}?`)) void run("bot_skill_delete", { name }); };
  const all = skills.data?.skills ?? [];
  const active = all.filter((skill) => skill.state !== "archived");
  const archived = all.filter((skill) => skill.state === "archived");
  const shown = (filter === "archived" ? archived : active).filter((skill) => matchesSkill(query, skill));
  return (
    <BotPageLayout testId="skills-page" title="Skills" bot={bot?.name} botId={bot?.id}
      toolbar={<BotPageToolbar<SkillsFilter> search={filter === "history" ? undefined : { value: query, onChange: setQuery, placeholder: "Search skills" }}
        filter={{ label: "Show", value: filter, onChange: (next) => { setFilter(next); setSelected(null); }, options: [
          { id: "skills", label: "Skills", count: active.length },
          { id: "archived", label: "Archived", count: archived.length },
          { id: "history", label: "History" },
        ] }} />}>
      {error || skills.error ? <p role="alert" className="text-sm text-destructive">{error ?? skills.error}</p> : null}
      {filter === "history" ? (
        botId ? <BotPageGroup title="History" testId="skills-history"><Versions key={revision} botId={botId} busy={busy} revert={revert} /></BotPageGroup> : null
      ) : skills.data && !shown.length ? (
        <BotPageEmpty testId="skills-empty" {...(query.trim()
          ? { title: noMatch(filter === "archived" ? "archived skills" : "skills", query), action: { label: "Clear search", onClick: () => setQuery("") } }
          : filter === "archived" ? { title: "No archived skills" } : { title: "No skills yet", hint: "Ask the Bot to save a way of working as a skill." })} />
      ) : shown.length ? (
        <BotPageGroup title={filter === "archived" ? "Archived" : "Skills"} count={shown.length}>
          {shown.map((skill) => (
            <Fragment key={skill.name}>
              <BotPageRow testId="skill-row" data={{ "data-skill": skill.name }} icon="Toolbox" title={skill.name} titleText={`${skill.name}: ${skill.description}`}
                muted={skill.state === "archived"} selected={selected === skill.name}
                status={skill.pinned ? { label: "Pinned" } : skill.state === "stale" ? { label: "Stale", tone: "warning" } : null}
                meta={skill.usedAt ? `used ${relativeTime(skill.usedAt, now)}` : relativeTime(skill.updatedAt, now)}
                onOpen={() => setSelected(selected === skill.name ? null : skill.name)}
                actions={skill.state === "archived"
                  ? <Button type="button" variant="outline" size="sm" data-testid="skill-restore" disabled={busy} className={SMALL} onClick={() => void run("bot_skill_restore", { name: skill.name })}>Restore</Button>
                  : <Button type="button" variant="outline" size="sm" data-testid="skill-delete" disabled={busy} className={SMALL} aria-label={`Delete ${skill.name}`} onClick={() => remove(skill.name)}>Delete</Button>} />
              {selected === skill.name && botId ? <SkillDetail key={revision} botId={botId} name={skill.name} description={skill.description} busy={busy} revert={revert} /> : null}
            </Fragment>
          ))}
        </BotPageGroup>
      ) : null}
    </BotPageLayout>
  );
}
