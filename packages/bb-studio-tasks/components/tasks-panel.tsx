// The Tasks nav panel: every board at the root, one board at `<board id>`
// (or its list and calendar at `<board id>/list` and `/calendar`), and one
// task at `<task id>`. Boards are Studio items too, beside pages and tables.
import { useCallback, useEffect, useState } from "react";
import { cn, Icon, useAddOnPanel } from "@bb-studio/kit/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { BOARD_VIEWS, PANEL_PATH, REALTIME_CHANNEL, isBoardId, isTaskId, type BoardView } from "../src/shared";
import { Board } from "./board";
import { BoardsIndex } from "./boards";
import { TaskView } from "./task-view";
import { TaskViews } from "./views";

const VIEW_BUTTONS: [BoardView, string, string][] = [
  ["board", "Board", "GridView"],
  ["list", "List", "ListView"],
  ["calendar", "Calendar", "Calendar"],
];

/** A board's sub path for a view: the board itself has none. */
function boardPath(boardId: string, view: BoardView): string {
  return view === "board" ? boardId : `${boardId}/${view}`;
}

export function TasksPanel({ subPath }: { subPath: string }) {
  const { refreshKey: version } = useAddOnPanel(REALTIME_CHANNEL, PANEL_PATH, "board");
  const navigate = useBbNavigate();
  const [first = "", second = ""] = subPath.split("/").filter(Boolean);

  const go = useCallback((to: string, replace = false) => navigate.toPluginPanel(PANEL_PATH, { subPath: to, replace }), [navigate]);
  /** The view a task's back button returns to, when it's on the same board. */
  const [lastView, setLastView] = useState<{ boardId: string; view: BoardView } | null>(null);
  const boardId = isBoardId(first) ? first : null;
  const view: BoardView = (BOARD_VIEWS as readonly string[]).includes(second) ? (second as BoardView) : "board";
  useEffect(() => {
    if (boardId) setLastView({ boardId, view });
  }, [boardId, view]);

  if (isTaskId(first)) {
    return (
      <TaskView
        key={first}
        taskId={first}
        onBack={(replace, boardId) => go(boardId ? boardPath(boardId, lastView?.boardId === boardId ? lastView.view : "board") : "", replace)}
        onOpenBoard={(boardId) => go(boardId)}
      />
    );
  }

  if (!boardId) return <BoardsIndex refreshKey={version} onOpen={(id) => go(id)} />;

  const toggle = (
    <div role="group" aria-label="View" className="flex h-8 items-center rounded-md border border-border p-0.5">
      {VIEW_BUTTONS.map(([to, label, icon]) => (
        <button
          key={to}
          type="button"
          aria-pressed={view === to}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground",
          )}
          onClick={() => go(boardPath(boardId, to), true)}
        >
          <Icon name={icon} className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
  const props = { boardId, refreshKey: version, viewToggle: toggle, onOpen: (id: string) => go(id), onBack: (replace?: boolean) => go("", replace) };
  if (view === "board") return <Board key={boardId} {...props} />;
  return <TaskViews key={boardId} mode={view} {...props} />;
}
