import companions from "./tasks-companions.mjs";
import dispatch from "./tasks-dispatch.mjs";

export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  ...(process.env.BB_CAPTURE_TASKS_COMPANIONS === "1" ? [companions({ projectId, seedPages, pluginRpc, bbCli, sleep })] : []),
  ...(process.env.BB_CAPTURE_TASKS_DISPATCH === "1" ? [dispatch({ projectId, pluginRpc, bbCli, sleep })] : []),
  {
    id: "studio-tasks",
    packageDir: "bb-studio/src/modules/tasks",
    privateSidebar: true,
    setup: async (client) => {
      const seeded = [
        { title: "Write the launch post", status: "todo", assignee: "me", due: "2026-10-06", priority: "high", recurrence: "weekly", labels: ["launch"], description: "Announce offline sync and the new team plans." },
        { title: "Update the pricing page copy", status: "todo", assignee: "agent" },
        { title: "Fix the flaky checkout test", status: "in_progress", assignee: "agent" },
        { title: "Add offline sync to settings", status: "review", assignee: "agent" },
        { title: "Draft the Q3 usage report", status: "done", assignee: "me" },
      ];
      const ids = [];
      let boardId = null;
      // Deleting the board deletes its tasks.
      const cleanup = async () => {
        if (boardId) await pluginRpc("studio", "tasks_boardDelete", { id: boardId }).catch(() => {});
      };
      try {
        ({ board: { id: boardId } } = await pluginRpc("studio", "tasks_boardCreate", { title: "Fall launch", projectId }));
        for (const task of seeded) {
          const { task: created } = await pluginRpc("studio", "tasks_create", { ...task, projectId, boardId });
          ids.push(created.id);
        }
        const { task: subtask } = await pluginRpc("studio", "tasks_create", { title: "Review the launch draft", projectId, boardId, parentId: ids[0], priority: "medium" });
        ids.push(subtask.id);
        // The boards index lists the seeded board, then it opens on its own page.
        await client.navigate("/plugins/studio/tasks");
        await client.waitForText("Boards");
        await client.waitForText("Fall launch");
        await client.navigate(`/plugins/studio/tasks/${boardId}`);
        await client.waitForInputValue("Board title", "Fall launch");
        for (const column of ["To do", "In progress", "Review", "Done"]) await client.waitForText(column);
        for (const task of seeded) await client.waitForText(task.title);
        await client.waitForText("Review the launch draft");
        await client.waitForText("Calendar");
        await client.waitForText("high");
        await client.waitForText("New task");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];
