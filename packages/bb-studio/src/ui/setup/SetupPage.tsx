// Studio's Setup page: the one place to set up BB Studio. Every add-on from
// the bb-studio marketplace with its status and health checks, one-click
// install and enable, retired plugins to remove, and the CLI command for each
// action. See src/setup.ts.
import { Button, cn, Icon } from "@bb-studio/kit/ui";
import { useState } from "react";
import type { AddOnEntry, AddOnStatus, RetiredEntry } from "../../setup-contract";
import { ProblemRow } from "../health/HealthViews";
import { useHealth, type HealthApi } from "../health/use-health";
import { useSetup, type SetupApi } from "./use-setup";
import { BackupSection } from "./BackupSection";

const STATUS: Record<AddOnStatus, { label: string; tone: string }> = {
  installed: { label: "Installed", tone: "bg-success/15 text-success" },
  "not-installed": { label: "Not installed", tone: "bg-muted text-muted-foreground" },
  disabled: { label: "Turned off", tone: "bg-muted text-muted-foreground" },
  "needs-setup": { label: "Needs setup", tone: "bg-warning/15 text-warning" },
  broken: { label: "Broken", tone: "bg-destructive/15 text-destructive" },
};

/** A shell command with a Copy button. */
export function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(command).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, () => {});
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md bg-muted/60 py-0.5 pl-2 pr-0.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">{command}</code>
      <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={copied ? "Copied" : "Copy command"} onClick={copy}>
        <Icon name={copied ? "Check" : "Copy"} />
      </Button>
    </div>
  );
}

function AddOnRow({ addOn, setup, health }: { addOn: AddOnEntry; setup: SetupApi; health: HealthApi }) {
  const failure = setup.failures[addOn.id];
  const busy = setup.busy === addOn.id;
  const action =
    addOn.status === "not-installed" ? <Button size="sm" variant="outline" disabled={Boolean(setup.busy)} onClick={() => void setup.install([addOn.id])}>{busy ? "Installing…" : "Install"}</Button>
    : addOn.status === "disabled" ? <Button size="sm" variant="outline" disabled={Boolean(setup.busy)} onClick={() => void setup.enable(addOn.id)}>{busy ? "Turning on…" : "Turn on"}</Button>
    : null;
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{addOn.name}</span>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS[addOn.status].tone)}>{STATUS[addOn.status].label}</span>
        {action}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{addOn.summary}</p>
      {addOn.optional && addOn.status === "not-installed" ? <p className="text-xs text-muted-foreground">Optional. {addOn.optional}</p> : null}
      {addOn.problems.length ? (
        <ul className="flex flex-col gap-1.5 pt-0.5">
          {addOn.problems.map((problem) => <ProblemRow key={problem.key} problem={problem} health={health} />)}
        </ul>
      ) : null}
      {addOn.passed.length ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Icon name="CircleCheck" className="mt-px size-3.5 shrink-0" />
          <span>{addOn.passed.join("; ")}</span>
        </p>
      ) : null}
      {addOn.unanswered ? <p className="text-xs text-muted-foreground">Its health check didn't answer: {addOn.unanswered}</p> : null}
      {failure ? <p className="text-xs text-destructive">{failure} Run this instead:</p> : null}
      {addOn.command ? <CommandLine command={addOn.command} /> : null}
    </li>
  );
}

function RetiredRow({ entry, setup }: { entry: RetiredEntry; setup: SetupApi }) {
  const [confirming, setConfirming] = useState(false);
  const failure = setup.failures[entry.id];
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{entry.name} <span className="font-normal text-muted-foreground">({entry.id})</span></span>
        <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">Retired</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{entry.why}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-relaxed">
        <dt className="font-medium text-foreground">Kept</dt><dd className="text-muted-foreground">{entry.kept}</dd>
        <dt className="font-medium text-foreground">Deleted</dt><dd className="text-muted-foreground">{entry.deleted}</dd>
      </dl>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-foreground">Before removing it</p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-xs text-muted-foreground">
          {entry.before.map((step) => (
            <li key={step.text} className="flex flex-col gap-1">
              <span>{step.text}</span>
              {step.command ? <CommandLine command={step.command} /> : null}
            </li>
          ))}
        </ol>
      </div>
      {entry.blocker ? <p className="text-xs text-warning">Not yet: {entry.blocker}</p> : null}
      {failure ? <p className="text-xs text-destructive">{failure}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {confirming ? (
          <>
            <span className="text-xs text-muted-foreground">Remove {entry.name} and delete its settings?</span>
            <Button size="sm" variant="destructive" disabled={Boolean(setup.busy)} onClick={() => void setup.remove(entry.id).then(() => setConfirming(false))}>
              {setup.busy === entry.id ? "Removing…" : "Remove"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" disabled={Boolean(entry.blocker) || Boolean(setup.busy)} onClick={() => setConfirming(true)}>Remove…</Button>
        )}
      </div>
      <CommandLine command={entry.removeCommand} />
    </li>
  );
}

export function SetupPage() {
  const setup = useSetup();
  const health = useHealth();
  const { summary, error } = setup;
  const missing = summary?.addOns.filter((addOn) => addOn.status === "not-installed" && !addOn.optional) ?? [];
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground">Set up BB Studio</h1>
          <p className="text-sm text-muted-foreground">
            Every BB Studio add-on, whether it's installed and working, and what to do next. Studio checks again every few minutes.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={Boolean(setup.busy)} onClick={() => void setup.checkAgain()}>
          {setup.busy === "check" ? "Checking…" : "Check again"}
        </Button>
      </header>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!summary ? <p className="text-sm text-muted-foreground">Checking add-ons…</p> : (
        <>
          {!summary.marketplaceAdded && summary.addOns.some((addOn) => addOn.status === "not-installed") ? (
            <section className="flex flex-col gap-1.5 rounded-md border border-warning/40 p-3">
              <p className="text-sm text-foreground">Add the bb-studio marketplace first, so BB can install from it.</p>
              <CommandLine command={summary.marketplaceCommand} />
            </section>
          ) : null}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 text-sm font-medium text-foreground">Add-ons</h2>
              {missing.length ? (
                <Button size="sm" disabled={Boolean(setup.busy)} onClick={() => void setup.install(missing.map((addOn) => addOn.id), "install-all")}>
                  {setup.busy === "install-all" ? "Installing…" : `Install all (${missing.length})`}
                </Button>
              ) : null}
            </div>
            {summary.installAll ? <CommandLine command={summary.installAll} /> : null}
            <ul className="flex flex-col gap-2">
              {summary.addOns.map((addOn) => <AddOnRow key={addOn.id} addOn={addOn} setup={setup} health={health} />)}
            </ul>
          </section>
          {summary.retired.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-foreground">Retired plugins ({summary.retired.length})</h2>
              <p className="text-xs text-muted-foreground">These were part of BB Studio and are no longer needed. Removing one asks first.</p>
              <ul className="flex flex-col gap-2">
                {summary.retired.map((entry) => <RetiredRow key={entry.id} entry={entry} setup={setup} />)}
              </ul>
            </section>
          ) : null}
          {summary.otherProblems.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-foreground">Other plugins need attention ({summary.otherProblems.length})</h2>
              <ul className="flex flex-col gap-2">
                {summary.otherProblems.map((problem) => <ProblemRow key={problem.key} problem={problem} health={health} />)}
              </ul>
            </section>
          ) : null}
          <BackupSection />
          <p className="text-xs text-subtle-foreground">Last checked {new Date(summary.checkedAt).toLocaleTimeString()}. The same list is in <code className="font-mono">bb studio setup</code>.</p>
        </>
      )}
    </div>
  );
}
