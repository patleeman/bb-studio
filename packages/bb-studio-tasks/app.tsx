// Studio Tasks — frontend entry.
//
// Surfaces:
//   - navPanel "Tasks": every board, one board (and its list and calendar
//     views) at tasks/<board id>, and one task at tasks/<task id>.
//   - threadPanelAction "Tasks": the thread's tasks and recent ones, and one
//     task, inside a thread's right panel. New makes a task linked to the
//     thread.
//   - messageDirective `::task{id="tsk_…"}`: a card in a reply.
//   - mention provider (server): `@task` works in every composer.
import { FloatPanels, ThreadItemsPanel } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TaskDirective } from "./components/task-directive";
import { TasksPanel } from "./components/tasks-panel";
import { TaskView } from "./components/task-view";
import { BOARD_ICON, PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL } from "./src/shared";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks",
    icon: BOARD_ICON,
    path: PANEL_PATH,
    component: ({ subPath }) => <TasksPanel subPath={subPath ?? ""} />,
  });
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "float", component: () => <FloatPanels path={PANEL_PATH} render={(subPath) => <TasksPanel subPath={subPath} />} /> });
  app.slots.threadPanelAction({
    id: "tasks",
    title: "Tasks",
    icon: BOARD_ICON,
    layout: "flush",
    component: ({ threadId }) => (
      <ThreadItemsPanel
        threadId={threadId}
        pluginId={PLUGIN_ID}
        kind="task"
        channel={REALTIME_CHANNEL}
        renderItem={(id, { onBack }) => <TaskView key={id} taskId={id} onBack={() => onBack()} compact />}
      />
    ),
  });

  app.slots.messageDirective({ id: "task", component: TaskDirective });
});
