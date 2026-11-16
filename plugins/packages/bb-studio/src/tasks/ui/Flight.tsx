import { useState, type ReactNode } from "react";
import { Icon, cn } from "../../kit/ui/index";
import { isClosed, USER_OWNER, type Task } from "../contract";
import { age, countBelow, flightLook, plural, startedAt, stepProgress, waitLabel, type FlightLook, type FlightNode, type Progress, type WorkerInfo } from "./board-model";
import { ownerShort, type Names } from "./model";

const LOOK_LABEL: Record<FlightLook, string> = { running: "Running", waiting: "Waiting", "needs-you": "Needs you", todo: "To do", done: "Done", failed: "Failed" };

export function ProgressRing({ progress, size = 28, label }: { progress: Progress | null; size?: number; label: string }) {
  const r = 15, c = 2 * Math.PI * r;
  const part = progress ? Math.max(0.04, progress.at / progress.of) : 0.25;
  return (
    <svg role="img" aria-label={label} data-testid="flight-ring" data-progress={progress ? `${progress.at}/${progress.of}` : undefined} viewBox="0 0 36 36" width={size} height={size}
      className={cn("shrink-0 text-success", !progress && "animate-spin motion-reduce:animate-none")}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={4} />
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeDasharray={`${(part * c).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 18 18)" />
    </svg>
  );
}

export function FlightGlyph({ task, needsYou = false, size = 28, label }: { task: Task; needsYou?: boolean; size?: number; label?: string }) {
  const look = flightLook(task, needsYou);
  const text = label ?? LOOK_LABEL[look];
  const box = { width: size, height: size };
  if (task.stale) return <span role="img" aria-label="Ended without a final update" data-testid="flight-glyph" data-look="ended" style={box} className="flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted-foreground/50 text-muted-foreground"><Icon name="Check" className={size > 20 ? "size-3" : "size-2"} /></span>;
  if (look === "running") return <ProgressRing progress={stepProgress(task.progress.step)} size={size} label={text} />;
  if (look === "needs-you") return <span role="img" aria-label={text} data-testid="flight-glyph" data-look={look} style={box} className="flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-warning bg-warning/15"><span className="size-1.5 rounded-full bg-warning" /></span>;
  if (look === "done") return <span role="img" aria-label={text} data-testid="flight-glyph" data-look={look} style={box} className="flex shrink-0 items-center justify-center text-success"><Icon name="Check" className="size-3.5" /></span>;
  if (look === "failed") return <span role="img" aria-label={text} data-testid="flight-glyph" data-look={look} style={box} className="flex shrink-0 items-center justify-center text-destructive"><Icon name="X" className="size-3.5" /></span>;
  if (look === "todo") return <span role="img" aria-label={text} data-testid="flight-glyph" data-look={look} style={box} className="flex shrink-0 items-center justify-center"><span className="size-3.5 rounded-full border-[1.5px] border-muted-foreground" /></span>;
  return <span role="img" aria-label={text} data-testid="flight-glyph" data-look={look} style={box} className="flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-muted-foreground/70 text-muted-foreground"><Icon name="Pause" className={size > 20 ? "size-3" : "size-2"} /></span>;
}

export type FlightText = { look: FlightLook; line: string | null; right: string; owner: string | null; elapsed: string | null; aria: string };

export function flightText(node: FlightNode, names: Names, now: number, titleOf: (id: string) => string | null): FlightText {
  const { task } = node;
  const look = flightLook(task, node.row.needsYou);
  const owner = task.owner === USER_OWNER ? null : ownerShort(task, names);
  const progress = stepProgress(task.progress.step);
  const wait = waitLabel(task, titleOf);
  const closed = isClosed(task);
  const line = look === "needs-you" && task.needs ? task.needs
    : look === "running" ? [progress ? progress.rest : task.progress.step, task.progress.line].filter(Boolean).join(" · ") || null
      : look === "waiting" ? task.progress.line || wait.long
        : task.progress.line;
  const right = closed ? LOOK_LABEL[look]
    : look === "running" ? progress?.label ?? "running"
      : look === "needs-you" ? "needs you"
        : look === "todo" ? "to do"
          : wait.short;
  if (task.stale) return { look, line: task.progress.line ?? "Ended without a final update", right: "ended", owner, elapsed: null, aria: [task.title, "ended without a final update", owner].filter(Boolean).join(", ") };
  const elapsed = look === "running" ? age(startedAt(task), now) : null;
  const aria = [task.title, look === "running" ? (progress ? `running, step ${progress.label}` : "running") : look === "needs-you" ? "needs you" : closed || look === "todo" ? LOOK_LABEL[look].toLowerCase() : wait.short, owner, elapsed ? `for ${elapsed}` : null].filter(Boolean).join(", ");
  return { look, line, right, owner, elapsed, aria };
}

function workerDot(status: string | null) {
  if (status === "active" || status === "running") return <span role="img" aria-label="Running" className="size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent motion-reduce:animate-none" />;
  if (status === "error" || status === "failed") return <Icon name="X" aria-label="Failed" className="size-2.5 shrink-0 text-destructive" />;
  return <span role="img" aria-label="Idle" className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />;
}

export function WorkerLink({ worker, onOpen, indent }: { worker: WorkerInfo; onOpen(threadId: string): void; indent: number }) {
  return (
    <li>
      <button type="button" data-testid="flight-worker" data-thread-id={worker.threadId} onClick={() => onOpen(worker.threadId)} aria-label={`Open worker ${worker.name}`}
        style={{ paddingLeft: indent }} className="flex min-h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md pr-2 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <span className="flex w-3 shrink-0 justify-center">{workerDot(worker.status)}</span>
        <Icon name="Bot" aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{worker.name}</span>
      </button>
    </li>
  );
}

export function FoldToggle({ node, open, onToggle, className }: { node: FlightNode; open: boolean; onToggle(): void; className?: string }) {
  const below = countBelow(node);
  if (!below.subtasks && !below.workers) return null;
  const text = [below.subtasks ? plural(below.subtasks, "subtask") : null, below.workers ? plural(below.workers, "worker") : null].filter(Boolean).join(" · ");
  return (
    <button type="button" data-testid="flight-fold" data-count={text} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${text} under ${node.task.title}`} title={text} onClick={onToggle}
      className={cn("flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-2xs tabular-nums text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring", className)}>
      <Icon name={below.workers ? "Bot" : "ListTodo"} aria-hidden className="size-3" />
      <span>{below.workers || below.subtasks}</span>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden className="size-3" />
    </button>
  );
}

export function FlightChildren({ node, names, now, titleOf, onOpenTask, onOpenThread, depth = 1 }: { node: FlightNode; names: Names; now: number; titleOf(id: string): string | null; onOpenTask(task: Task): void; onOpenThread(threadId: string): void; depth?: number }) {
  const indent = 12 + depth * 16;
  return (
    <ul data-testid="flight-children" aria-label={`Under ${node.task.title}`} className="flex flex-col pb-1">
      {node.workers.map((w) => <WorkerLink key={w.threadId} worker={w} onOpen={onOpenThread} indent={indent} />)}
      {node.children.map((child) => <FlightChild key={child.task.id} node={child} names={names} now={now} titleOf={titleOf} onOpenTask={onOpenTask} onOpenThread={onOpenThread} depth={depth} />)}
    </ul>
  );
}

function FlightChild({ node, names, now, titleOf, onOpenTask, onOpenThread, depth }: { node: FlightNode; names: Names; now: number; titleOf(id: string): string | null; onOpenTask(task: Task): void; onOpenThread(threadId: string): void; depth: number }) {
  const text = flightText(node, names, now, titleOf);
  const indent = 12 + depth * 16;
  return (
    <li>
      <button type="button" data-testid="flight-subtask" data-task-id={node.task.id} data-look={text.look} onClick={() => onOpenTask(node.task)} aria-label={text.aria}
        style={{ paddingLeft: indent }} className="flex min-h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md pr-2 text-left text-xs hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <FlightGlyph task={node.task} needsYou={node.row.needsYou} size={12} />
        <span className={cn("min-w-0 max-w-[55%] shrink-0 truncate", isClosed(node.task) ? "text-muted-foreground" : "text-foreground")}>{node.task.title}</span>
        <span className="min-w-0 flex-1 truncate text-subtle-foreground">{text.line}</span>
        <span className={cn("shrink-0 text-2xs", text.look === "needs-you" ? "text-warning" : "text-subtle-foreground")}>{text.right}</span>
      </button>
      {node.workers.length || node.children.length ? <FlightChildren node={node} names={names} now={now} titleOf={titleOf} onOpenTask={onOpenTask} onOpenThread={onOpenThread} depth={depth + 1} /> : null}
    </li>
  );
}

export function useFold(): [ReadonlySet<string>, (id: string) => void] {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  return [open, (id) => setOpen((before) => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; })];
}

export function PageFlightRow({ node, names, now, titleOf, open, onToggle, onOpenTask, onOpenThread, aside }: { node: FlightNode; names: Names; now: number; titleOf(id: string): string | null; open: boolean; onToggle(): void; onOpenTask(task: Task): void; onOpenThread(threadId: string): void; aside?: ReactNode }) {
  const text = flightText(node, names, now, titleOf);
  return (
    <li data-testid="page-flight-row" data-task-id={node.task.id} data-look={text.look} className="border-t border-border/50 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={() => onOpenTask(node.task)} aria-label={text.aria}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 rounded-md py-2.5 pr-1 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <FlightGlyph task={node.task} needsYou={node.row.needsYou} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span data-testid="flight-title" className="truncate text-sm font-medium text-foreground">{node.task.title}</span>
            {text.line ? <span data-testid="flight-line" className="truncate text-xs text-muted-foreground">{text.line}</span> : null}
          </span>
          <span className="flex shrink-0 flex-col items-end text-xs text-subtle-foreground">
            <span data-testid="flight-right" className={cn("font-medium", text.look === "needs-you" ? "text-warning" : "text-muted-foreground")}>{text.right}</span>
            <span data-testid="flight-owner" className="max-w-40 truncate">{[text.owner, text.elapsed].filter(Boolean).join(" · ")}</span>
          </span>
        </button>
        <FoldToggle node={node} open={open} onToggle={onToggle} />
        {aside}
      </div>
      {open ? <FlightChildren node={node} names={names} now={now} titleOf={titleOf} onOpenTask={onOpenTask} onOpenThread={onOpenThread} /> : null}
    </li>
  );
}
