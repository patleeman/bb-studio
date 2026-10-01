// The Tasks nav panel: the board at the root, the same tasks as a Studio
// list at `list`, and one task at `<task id>`. Tasks keeps its own board
// even with Studio installed; Studio lists tasks alongside everything else.
import { useCallback, useState } from "react";
import { cn, Icon, useAddOnPanel } from "@bb-studio/kit/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { PANEL_PATH, REALTIME_CHANNEL, isTaskId } from "../src/shared";
import { Board } from "./board";
import { TaskView } from "./task-view";
import { TaskViews } from "./views";

const LIST = "list";
const CALENDAR = "calendar";

export function TasksPanel({ subPath }: { subPath: string }) {
  const { refreshKey: version } = useAddOnPanel(REALTIME_CHANNEL, PANEL_PATH, "task");
  const navigate = useBbNavigate();
  const [first = ""] = subPath.split("/").filter(Boolean);

  const go = useCallback((to: string, replace = false) => navigate.toPluginPanel(PANEL_PATH, { subPath: to, replace }), [navigate]);
  const [lastView, setLastView] = useState(first === LIST ? LIST : "");

  if (isTaskId(first)) {
    return <TaskView key={first} taskId={first} onBack={(replace) => go(lastView, replace)} />;
  }

  const view = first === LIST || first === CALENDAR ? first : "";
  const toggle = (
    <div role="group" aria-label="View" className="flex h-8 items-center rounded-md border border-border p-0.5">
      {(
        [
          ["", "Board", "GridView"],
          [LIST, "List", "ListView"],
          [CALENDAR, "Calendar", "CalendarDays"],
        ] as const
      ).map(([to, label, icon]) => (
        <button
          key={label}
          type="button"
          aria-pressed={view === to}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground",
          )}
          onClick={() => {
            setLastView(to);
            go(to, true);
          }}
        >
          <Icon name={icon} className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );

  if (first === LIST || first === CALENDAR) return <TaskViews mode={first} refreshKey={version} onOpen={(id) => go(id)} headerActions={toggle} />;
  return <Board refreshKey={version} viewToggle={toggle} onOpen={(id) => go(id)} />;
}
