// Studio Tasks — frontend entry.
//
// Surfaces:
//   - navPanel "Tasks": the board, a list view, and one task at tasks/<id>.
//   - messageDirective `::task{id="tsk_…"}`: a card in a reply.
//   - mention provider (server): `@task` works in every composer.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TaskDirective } from "./components/task-directive";
import { TasksPanel } from "./components/tasks-panel";
import { BOARD_ICON, PANEL_PATH } from "./src/shared";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks",
    icon: BOARD_ICON,
    path: PANEL_PATH,
    component: ({ subPath }) => <TasksPanel subPath={subPath ?? ""} />,
  });

  app.slots.messageDirective({ id: "task", component: TaskDirective });
});
