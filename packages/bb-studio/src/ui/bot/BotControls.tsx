// A Bot's Controls (bot/<botId>/controls): every setting, off the main page,
// with a back link to it. Section links on the left: Profile (with Profile
// changes and Revert), Model, Memory, Skills (with Learn from work and its
// history), Check-ins, Attention (the primary Bot's Todos: daily budget and
// quiet hours), Prompt cache (the only place tokens and cost show) and
// Maintenance (the switch, rules and history). An external Bot has no
// Memory page, skills or maintenance here: Profile, Model and Check-ins.
// The components are the ones Bot info always had, moved here.
import { OUTLINE_BUTTON, openAppPath } from "../../kit/app/index";
import { Icon } from "../../kit/ui/index";
import { useEffect, useState, type ReactNode } from "react";
import type { BotView } from "../../contract";
import { externalName } from "../../external-providers";
import { useLive } from "../live";
import { BotFace } from "../../presence/ui/BotFace";
import { botProvider } from "./BotAvatar";
import { BotProfileEditor, PRESETS, presetOf, runningCount, SkillsList, statusLabel, useBotControls } from "./BotHome";
import { SwitchModelDialog } from "./BotModel";
import { ProfileChanges } from "./ProfileChanges";
import { BotCacheSection } from "./BotCache";
import { BotMaintenance } from "./BotMaintenance";
import { BotAttention } from "./BotAttention";
import { botPath } from "./selection";

const STATE_DOT = { active: "bg-success", paused: "bg-warning", stopped: "bg-muted-foreground/50" } as const;
type Section = { id: string; label: string };

/** The sections an internal Bot has, and the three an external one keeps. Attention is the primary Bot's (Todos are its). */
export function controlSections(external: boolean, primary = false): Section[] {
  const all: Section[] = [
    { id: "profile", label: "Profile" }, { id: "model", label: "Model" }, { id: "memory", label: "Memory" }, { id: "skills", label: "Skills" },
    { id: "checkins", label: "Check-ins" }, { id: "attention", label: "Attention" }, { id: "cache", label: "Prompt cache" }, { id: "maintenance", label: "Maintenance" },
  ];
  if (external) return all.filter((each) => ["profile", "model", "checkins"].includes(each.id));
  return primary ? all : all.filter((each) => each.id !== "attention");
}

/** What its check-ins are, in words: a preset's name and when, or Off. */
export function checkinWords(run: BotView["run"]): string {
  const preset = presetOf(run);
  if (preset === "off") return "Off";
  if (preset) { const found = PRESETS.find((each) => each.id === preset)!; return `${found.label}, ${found.hint.replace(/^Weekdays /, "weekdays at ").replace("9–17", "9 AM to 5 PM")}`; }
  return statusLabel(run, "active").replace(/^Checks in /, "Custom: ");
}

export function BotControls({ view, refresh }: { view: BotView; refresh(): void }) {
  const activity = useLive("bot_activity", { botId: view.bot!.id }, { pollMs: 30_000 });
  const running = runningCount(activity.data);
  const { bot, profile, busy, error, setSheet, openMemory, saveProfile, sheets } = useBotControls(view, refresh, running);
  const [switching, setSwitching] = useState(false);
  const external = bot.kind === "external";
  const primary = !!bot.primary;
  const sections = controlSections(external, primary);
  const [current, setCurrent] = useState(sections[0]!.id);
  const go = (id: string) => { setCurrent(id); document.getElementById(`controls-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); };
  // A link to a section (controls#maintenance) opens on it.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!sections.some((each) => each.id === id)) return;
    setCurrent(id);
    requestAnimationFrame(() => document.getElementById(`controls-${id}`)?.scrollIntoView({ block: "start" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col pb-12" aria-label={`${bot.name} controls`} data-testid="bot-controls-page">
      <button type="button" className="flex items-center gap-1.5 self-start pt-6 text-sm text-muted-foreground hover:text-foreground" onClick={() => openAppPath(botPath(bot.id))}>
        <Icon name="ArrowLeft" className="size-3.5" aria-hidden />{bot.name}
      </button>
      <h1 className="flex items-center gap-3 pt-3 pb-6 text-xl font-semibold">
        <BotFace botId={bot.id} size={30} provider={botProvider(bot)} />Controls
      </h1>
      {error ? <p role="alert" className="pb-2 text-xs text-destructive">{error}</p> : null}
      <div className="flex items-start gap-10">
        <nav aria-label="Controls sections" className="sticky top-4 hidden w-44 shrink-0 flex-col gap-0.5 @3xl/page:flex">
          {sections.map((section) => (
            <button key={section.id} type="button" aria-current={current === section.id ? "true" : undefined} onClick={() => go(section.id)}
              className="h-8 rounded-md px-2.5 text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground aria-[current]:bg-state-active aria-[current]:text-foreground">{section.label}</button>
          ))}
        </nav>
        <div className="flex min-w-0 max-w-2xl flex-1 flex-col divide-y divide-border">
          <Part id="profile" title="Profile">
            {/* The profile editor brings its own Edit; its margins are the section's. */}
            <div className="-mt-3 [&>section]:mx-0 [&>section]:pt-0">
              <BotProfileEditor bot={bot} value={profile} status={statusLabel(view.run, bot.state, running)} statusDot={STATE_DOT[bot.state]} busy={!!busy}
                onSave={saveProfile}>
                <ProfileChanges botId={bot.id} onChanged={refresh} />
              </BotProfileEditor>
            </div>
          </Part>
          <Part id="model" title="Model">
            <Row label="Runs on" value={external ? `${externalName(bot.providerId)}${bot.model ? ` · ${bot.model}` : ""}` : bot.model ?? "Its thread's model"}
              action={bot.threadId && bot.providerId && bot.model ? <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => setSwitching(true)}>Switch model…</button> : null} />
          </Part>
          {external ? null : (
            <Part id="memory" title="Memory">
              <Row label="Memory page" action={<button type="button" className={OUTLINE_BUTTON} aria-label="Open memory" onClick={() => void openMemory()}>Open<Icon name="ArrowUpRight" /></button>} />
            </Part>
          )}
          {external ? null : (
            <Part id="skills" title="Skills">
              <div className="text-sm"><SkillsList botId={bot.id} /></div>
            </Part>
          )}
          <Part id="checkins" title="Check-ins">
            <Row label="Preset" value={checkinWords(view.run)} action={bot.state === "active" ? <button type="button" className={OUTLINE_BUTTON} onClick={() => setSheet("checkins")}>Change…</button> : null} />
          </Part>
          {external || !primary ? null : (
            <Part id="attention" title="Attention">
              <BotAttention botName={bot.name} />
            </Part>
          )}
          {external ? null : (
            <Part id="cache" title="Prompt cache">
              <div className="[&>section]:mx-0 [&>section]:mt-0">
                {bot.threadId ? <BotCacheSection botId={bot.id} threadId={bot.threadId} heading={false} /> : <p className="text-sm text-muted-foreground">No chat</p>}
              </div>
            </Part>
          )}
          {external ? null : (
            <Part id="maintenance" title="Maintenance">
              <div className="[&>section]:px-0 [&>section]:pt-0"><BotMaintenance botId={bot.id} heading={false} /></div>
            </Part>
          )}
        </div>
      </div>
      {switching && bot.threadId && bot.providerId && bot.model
        ? <SwitchModelDialog threadId={bot.threadId} providerId={bot.providerId} model={bot.model} onClose={() => setSwitching(false)} onSwitched={() => refresh()} />
        : null}
      {sheets}
    </div>
  );
}

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`controls-${id}`} aria-label={title} data-controls={id} className="flex scroll-mt-4 flex-col gap-3 py-6 first:pt-0">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, action }: { label: string; value?: string; action: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-4 text-sm">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
      {action}
    </div>
  );
}
