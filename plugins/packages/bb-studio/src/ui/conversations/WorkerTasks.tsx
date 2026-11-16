import { experimental_ThreadActionsContextMenu as ThreadActionsContextMenu, type PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { useState, type ReactNode } from "react";
import { Icon } from "../../kit/app/index";
import { cn } from "../../kit/ui/utils";
import { threadDragItem, writeDragItem } from "../../kit/app/item-drag";
import { flightLook, plural, workersUnder, type FlightNode, type WorkerGroup, type WorkerInfo } from "../../tasks/ui/board-model";
import { shortAge } from "./model";

const INK_55 = "text-[color-mix(in_oklab,var(--foreground)_55%,transparent)]";
const ROW = "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-[13px] text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-state-active";

function TaskGlyph({ node, slot }: { node: FlightNode; slot?: number }) {
  const look = flightLook(node.task, node.row.needsYou);
  if (look === "running" && slot !== undefined) return <span role="img" aria-label="Running" data-status="running" data-testid="worker-dot" data-worker-slot={slot} className="mx-[2.5px] size-[7px] shrink-0 rounded-full bg-[var(--studio-worker)] shadow-[0_0_6px_var(--studio-worker)]" />;
  if (look === "running") return <span role="img" aria-label="Running" data-status="running" className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent motion-reduce:animate-none" />;
  if (look === "needs-you") return <span role="img" aria-label="Needs you" data-status="needs-you" className="mx-[3px] size-1.5 shrink-0 rounded-full bg-warning" />;
  if (look === "failed") return <Icon name="X" className="size-3 shrink-0 text-destructive" aria-label="Failed" />;
  if (look === "done") return <Icon name="Check" className="size-3 shrink-0 text-success" aria-label="Done" />;
  return <span role="img" aria-label="Waiting" data-status="waiting" className="flex size-3 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/70"><Icon name="Pause" aria-hidden className="size-1.5 text-muted-foreground" /></span>;
}

function workerStatus(status: string | null): string {
  return status === "active" || status === "running" ? "Running" : status === "error" || status === "failed" ? "Failed" : "Idle";
}

export type WorkerTaskProps = {
  node: FlightNode;
  now: number;
  activeThreadId: string | null;
  onOpenThread(threadId: string): void;
  targetOf(threadId: string): PluginThreadActionTarget | null;
  slotOf(threadId: string): number | undefined;
};

export function WorkerTaskRow({ node, now, activeThreadId, onOpenThread, targetOf, slotOf }: WorkerTaskProps) {
  const workers = workersUnder(node);
  const [open, setOpen] = useState(() => workers.some((w) => w.threadId === activeThreadId));
  const single = workers.length === 1 ? workers[0]! : null;
  const selected = workers.some((w) => w.threadId === activeThreadId);
  const slot = workers.map((w) => slotOf(w.threadId)).find((s) => s !== undefined);
  const look = flightLook(node.task, node.row.needsYou);
  const label = `${node.task.title}, ${look === "needs-you" ? "needs you" : look}${workers.length > 1 ? `, ${plural(workers.length, "worker")}` : ""}`;
  const main = (
    <button type="button" data-testid="worker-task" data-task-id={node.task.id} data-look={look} aria-label={label} aria-current={selected && !open ? "page" : undefined}
      onClick={() => (single ? onOpenThread(single.threadId) : setOpen(!open))}
      draggable={!!single} onDragStart={single ? (event) => { event.dataTransfer.effectAllowed = "all"; writeDragItem(event.dataTransfer, threadDragItem({ id: single.threadId, title: node.task.title })); } : undefined}
      className={ROW}>
      <span className="flex w-3 shrink-0 justify-center"><TaskGlyph node={node} slot={slot} /></span>
      <span data-testid="worker-title" className="min-w-0 flex-1 truncate">{node.task.title}</span>
      {workers.length > 1 ? <span data-testid="worker-count" aria-hidden className={`shrink-0 text-xs tabular-nums ${INK_55}`}>×{workers.length}</span> : null}
      <span data-testid="worker-time" className={`shrink-0 text-[11px] tabular-nums ${INK_55}`}>{shortAge(node.task.updatedAt, now)}</span>
    </button>
  );
  const target = single ? targetOf(single.threadId) : null;
  return (
    <li className="flex flex-col">
      <div className="flex min-w-0 items-center">
        <div className="min-w-0 flex-1">{target ? <ThreadActionsContextMenu thread={target}><div>{main}</div></ThreadActionsContextMenu> : main}</div>
        {workers.length > 1 ? (
          <button type="button" data-testid="worker-task-fold" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} the ${workers.length} workers on ${node.task.title}`} onClick={() => setOpen(!open)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3" />
          </button>
        ) : null}
      </div>
      {open && workers.length > 1 ? (
        <ul aria-label={`Workers on ${node.task.title}`} className="flex flex-col">
          {workers.map((w) => <WorkerThreadRow key={w.threadId} worker={w} selected={w.threadId === activeThreadId} onOpen={onOpenThread} target={targetOf(w.threadId)} />)}
        </ul>
      ) : null}
    </li>
  );
}

function WorkerThreadRow({ worker, selected, onOpen, target }: { worker: WorkerInfo; selected: boolean; onOpen(threadId: string): void; target: PluginThreadActionTarget | null }) {
  const status = workerStatus(worker.status);
  const button = (
    <button type="button" data-testid="worker-row" data-thread-id={worker.threadId} data-status={status.toLowerCase()} aria-current={selected ? "page" : undefined} aria-label={`${worker.name}, ${status.toLowerCase()}`} onClick={() => onOpen(worker.threadId)}
      draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "all"; writeDragItem(event.dataTransfer, threadDragItem({ id: worker.threadId, title: worker.name })); }}
      className={cn(ROW, "h-6 pl-6 text-xs text-muted-foreground")}>
      <span className="flex w-3 shrink-0 justify-center">
        {status === "Running" ? <span aria-hidden className="size-2 animate-spin rounded-full border-[1.5px] border-success border-r-transparent motion-reduce:animate-none" /> : status === "Failed" ? <Icon name="X" aria-hidden className="size-2.5 text-destructive" /> : <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{worker.name}</span>
    </button>
  );
  return <li>{target ? <ThreadActionsContextMenu thread={target}><div>{button}</div></ThreadActionsContextMenu> : button}</li>;
}

export function WorkerTasks({ groups, done, now, activeThreadId, onOpenThread, targetOf, slotOf, empty, showNames }: {
  groups: readonly WorkerGroup[];
  done: readonly FlightNode[];
  now: number;
  activeThreadId: string | null;
  onOpenThread(threadId: string): void;
  targetOf(threadId: string): PluginThreadActionTarget | null;
  slotOf(threadId: string): number | undefined;
  empty: ReactNode;
  showNames: boolean;
}) {
  const [doneOpen, setDoneOpen] = useState(() => done.some((n) => workersUnder(n).some((w) => w.threadId === activeThreadId)));
  const row = (node: FlightNode) => <WorkerTaskRow key={node.task.id} node={node} now={now} activeThreadId={activeThreadId} onOpenThread={onOpenThread} targetOf={targetOf} slotOf={slotOf} />;
  return (
    <>
      {groups.map((group) => (
        <div key={group.conversation ?? "none"} role="group" aria-label={`Working for ${group.name}`} data-testid="worker-group" data-conversation={group.conversation ?? ""}>
          {showNames ? <div data-testid="worker-group-name" className={`truncate px-2 pt-1 text-[11px] ${INK_55}`}>{group.name}</div> : null}
          <ul className="flex flex-col">{group.nodes.map(row)}</ul>
        </div>
      ))}
      {done.length ? (
        <button type="button" data-testid="workers-done" aria-expanded={doneOpen} onClick={() => setDoneOpen(!doneOpen)}
          className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none">
          <Icon name={doneOpen ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" />{done.length} done today
        </button>
      ) : null}
      {doneOpen && done.length ? <ul aria-label="Done today" className="flex flex-col">{done.map(row)}</ul> : null}
      {!groups.length && !done.length ? empty : null}
    </>
  );
}
