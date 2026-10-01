import { useEffect, useMemo, useState } from "react";
import { Icon } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { STATUS_LABELS } from "../src/shared";
import { useTasksRpc, type Task } from "./types";

type Sort = "due" | "title" | "priority" | "updated";
type Group = "status" | "priority" | "project" | "none";
const weight: Record<Task["priority"], number> = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };

export function TaskViews({ mode, refreshKey, onOpen, headerActions }: { mode: "list" | "calendar"; refreshKey: unknown; onOpen(id: string): void; headerActions: React.ReactNode }) {
  const rpc = useTasksRpc();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("due");
  const [group, setGroup] = useState<Group>("status");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  useEffect(() => {
    let live = true;
    void rpc.call("board", {}).then(({ tasks }) => { if (live) { setTasks(tasks); setError(null); } }, (failure) => { if (live) setError(errorMessage(failure)); });
    return () => { live = false; };
  }, [rpc, refreshKey]);
  const ordered = useMemo(() => [...tasks].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "priority") return weight[b.priority] - weight[a.priority] || a.title.localeCompare(b.title);
    if (sort === "updated") return b.updatedAt - a.updatedAt;
    return (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title);
  }), [tasks, sort]);
  const groups = useMemo(() => {
    const result = new Map<string, Task[]>();
    for (const task of ordered) {
      const key = group === "none" ? "Tasks" : group === "status" ? STATUS_LABELS[task.status] ?? task.status : group === "priority" ? task.priority : task.projectId ?? "Global";
      result.set(key, [...(result.get(key) ?? []), task]);
    }
    return result;
  }, [ordered, group]);
  const first = new Date(`${month}-01T12:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  function shift(offset: number) { const date = new Date(`${month}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + offset); setMonth(date.toISOString().slice(0, 7)); }
  return <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
    <div className="flex flex-wrap items-center gap-3 px-6 pt-10 pb-4 max-md:px-3 max-md:pt-4">
      <h1 className="mr-auto text-2xl font-semibold">Tasks</h1>{headerActions}
    </div>
    {error ? <p role="alert" className="px-6 text-sm text-destructive">{error}</p> : null}
    {mode === "list" ? <div className="min-h-0 overflow-auto px-6 pb-6 max-md:px-3">
      <div className="mb-4 flex gap-3 text-sm">
        <label>Sort <select aria-label="Sort tasks" value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="rounded border border-border bg-background p-1"><option value="due">Due date</option><option value="title">Title</option><option value="priority">Priority</option><option value="updated">Recently updated</option></select></label>
        <label>Group <select aria-label="Group tasks" value={group} onChange={(event) => setGroup(event.target.value as Group)} className="rounded border border-border bg-background p-1"><option value="status">Status</option><option value="priority">Priority</option><option value="project">Project</option><option value="none">None</option></select></label>
      </div>
      {[...groups].map(([name, rows]) => <section key={name} className="mb-6"><h2 className="mb-2 text-sm font-medium">{name} <span className="text-muted-foreground">{rows.length}</span></h2>
        <div className="divide-y divide-border rounded-md border border-border">{rows.map((task) => <button key={task.id} type="button" onClick={() => onOpen(task.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-state-hover"><Icon name={task.status === "done" ? "CircleCheck" : "Circle"} className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{task.title || "Untitled"}</span><span className="text-muted-foreground">{task.priority !== "none" ? task.priority : ""}</span><span className="text-muted-foreground">{task.due ?? ""}</span></button>)}</div>
      </section>)}
    </div> : <div className="min-h-0 overflow-auto px-6 pb-6 max-md:px-3">
      <div className="mb-3 flex items-center gap-2"><button aria-label="Previous month" onClick={() => shift(-1)}><Icon name="ChevronLeft" /></button><h2 className="min-w-40 text-center font-medium">{first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</h2><button aria-label="Next month" onClick={() => shift(1)}><Icon name="ChevronRight" /></button></div>
      <div className="grid grid-cols-7 border-l border-t border-border text-xs">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="border-r border-b border-border p-2 font-medium">{day}</div>)}
        {Array.from({ length: first.getUTCDay() }, (_, index) => <div key={`empty-${index}`} className="border-r border-b border-border" />)}
        {Array.from({ length: days }, (_, index) => { const day = `${month}-${String(index + 1).padStart(2, "0")}`; return <div key={day} className="min-h-28 border-r border-b border-border p-1"><span className="p-1">{index + 1}</span>{tasks.filter((task) => task.due === day).map((task) => <button key={task.id} title={task.title} onClick={() => onOpen(task.id)} className="mt-1 block w-full truncate rounded bg-muted px-1 py-0.5 text-left hover:bg-state-hover">{task.title || "Untitled"}</button>)}</div>; })}
      </div>
    </div>}
  </div>;
}
