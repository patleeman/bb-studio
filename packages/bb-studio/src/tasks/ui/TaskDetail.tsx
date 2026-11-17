import { useEffect, useRef, type ReactNode } from "react";
import type { LoopPeople } from "../../loops/ui/hooks";
import type { TaskView } from "../rpc-contract";
import { TaskCardView } from "./TaskCard";

/**
 * A task's detail, in its side-panel tab: the task's card with its facts.
 * Opened from a row on the Tasks page, it takes focus (and scrolls to its
 * top), so the open is plain to see and the keyboard lands in it; closing
 * the tab puts focus back on the row.
 */
export function TaskDetail({ view, people, refresh, extra }: { view: TaskView; people: LoopPeople; refresh(): void; extra?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = view.task.id;
  useEffect(() => {
    const el = ref.current;
    const from = typeof document === "undefined" ? null : document.activeElement;
    if (!el || !from?.closest?.("[data-testid=todos-page]")) return;
    el.scrollIntoView?.({ block: "start" });
    el.focus({ preventScroll: true });
  }, [id]);
  return (
    <div data-testid="task-detail" data-task-id={id} className="studio-root flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <div ref={ref} tabIndex={-1} role="region" aria-label={`Task: ${view.task.title}`} className="mx-auto w-full max-w-2xl rounded-xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <TaskCardView view={view} people={people} refresh={refresh} detail bare extra={extra} />
      </div>
    </div>
  );
}
