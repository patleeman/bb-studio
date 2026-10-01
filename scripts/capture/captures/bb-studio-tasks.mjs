export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "studio-tasks",
    packageDir: "bb-studio-tasks",
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
      const cleanup = async () => {
        for (const id of ids) await pluginRpc("studio-tasks", "delete", { id }).catch(() => {});
      };
      try {
        for (const task of seeded) {
          const { task: created } = await pluginRpc("studio-tasks", "create", { ...task, projectId });
          ids.push(created.id);
        }
        const { task: subtask } = await pluginRpc("studio-tasks", "create", { title: "Review the launch draft", projectId, parentId: ids[0], priority: "medium" });
        ids.push(subtask.id);
        await client.navigate("/plugins/studio-tasks/tasks");
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
