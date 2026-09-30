// The Tasks nav panel: the board at the root, the same tasks as a Studio
// list at `list`, and one task at `<task id>`. Tasks keeps its own board
// even with Studio installed; Studio lists tasks alongside everything else.
import { useCallback, useState } from "react";
import { AddOnCollection, cn, Icon, type ProviderCall } from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL, isTaskId } from "../src/shared";
import { Board } from "./board";
import { TaskView } from "./task-view";

const LIST = "list";

export function TasksPanel({ subPath }: { subPath: string }) {
  const studioRpc = useRpc<StudioSchemas["provider"]>();
  const callStudio = useCallback<ProviderCall>((method, input) => studioRpc.call(method, input as never) as never, [studioRpc]);
  const navigate = useBbNavigate();
  const [first = ""] = subPath.split("/").filter(Boolean);
  const [version, setVersion] = useState(0);
  useRealtime(REALTIME_CHANNEL, () => setVersion((current) => current + 1));

  const go = useCallback((to: string, replace = false) => navigate.toPluginPanel(PANEL_PATH, { subPath: to, replace }), [navigate]);
  const [lastView, setLastView] = useState(first === LIST ? LIST : "");

  if (isTaskId(first)) {
    return <TaskView key={first} taskId={first} onBack={(replace) => go(lastView, replace)} />;
  }

  const view = first === LIST ? LIST : "";
  const toggle = (
    <div role="group" aria-label="View" className="flex h-8 items-center rounded-md border border-border p-0.5">
      {(
        [
          ["", "Board", "GridView"],
          [LIST, "List", "ListView"],
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

  if (view === LIST) {
    return (
      <AddOnCollection pluginId={PLUGIN_ID} title="Tasks" kind="task" call={callStudio} refreshKey={version} handOver={false} headerActions={toggle} />
    );
  }
  return <Board refreshKey={version} viewToggle={toggle} onOpen={(id) => go(id)} />;
}
