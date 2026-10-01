import { untitled } from "@bb-studio/kit/format";
// `::task{id="tsk_…"}` in a reply: a card for a task that opens it on the
// board, with its status and who acts next.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard } from "@bb-studio/kit/app";
import { useBbNavigate, useRealtime, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { PANEL_PATH, REALTIME_CHANNEL, STATUS_LABELS, TASK_UPDATE_TYPE, isTaskId } from "../src/shared";
import { AssigneeChip, DueChip, HandoffBadge, STATUS_ICONS } from "./pieces";
import { useTasksRpc, type Task, type TaskEvent } from "./types";

export function TaskDirective({ attributes }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  const valid = isTaskId(id);
  const rpc = useTasksRpc();
  const navigate = useBbNavigate();
  const [task, setTask] = useState<Task | null | undefined>(undefined);

  const load = useCallback(() => {
    if (!valid) return;
    rpc.call("get", { id }).then(
      (result) => setTask(result.task),
      () => setTask(null),
    );
  }, [rpc, id, valid]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as TaskEvent;
    if (event?.type === TASK_UPDATE_TYPE && event.taskId === id) load();
  });

  if (!valid || task === null) return <ItemDirectiveCard state="deleted" kind="task" icon="ListTodo" />;
  if (!task) return <ItemDirectiveCard state="loading" kind="task" icon="ListTodo" />;
  return (
    <ItemDirectiveCard
      state="ready"
      kind="task"
      icon={STATUS_ICONS[task.status]}
      title={untitled(task.title)}
      onOpen={() => navigate.toPluginPanel(PANEL_PATH, { subPath: task.id })}
      details={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{STATUS_LABELS[task.status]} · Studio Tasks</span>
        <HandoffBadge handoff={task.handoff} status={task.status} />
        <DueChip due={task.due} status={task.status} />
        <AssigneeChip assignee={task.assignee} />
      </span>}
    />
  );
}
