/** Persistent, local-only collection fixtures; unlike capture fixtures, these survive screenshots. */
export async function seedStudioItems(pluginRpc, projectId) {
  let active = [];
  try { active = (await pluginRpc("studio", "modules_status", null)).active; } catch { /* 17-plugin baseline */ }
  const call = (module, legacy, method, input) => pluginRpc(
    active.includes(module) ? "studio" : legacy,
    active.includes(module) ? `${module}_${method}` : method, input,
  );
  const { page } = await pluginRpc("pages", "create", {
    projectId, parentId: null, title: "ORBIT-42 launch checklist", icon: "✅",
    markdown: "## Release checklist\n\n- [ ] Review the release notes\n- [ ] Confirm the Friday release window",
  });
  const { drawing } = await pluginRpc("excalidraw", "createDrawing", { projectId, name: "ORBIT-42 release flow" });
  const { table } = await call("tables", "studio-tables", "create", {
    projectId, title: "ORBIT-42 release inventory",
    columns: [{ id: "name", name: "Item", type: "text" }], rows: [{ name: "Release notes" }],
  });
  const { task } = await call("tasks", "studio-tasks", "create", {
    projectId, title: "ORBIT-42 review release notes", description: "Confirm the Friday release window.",
  });
  const artifact = await call("artifacts", "artifacts", "importFile", {
    projectId, name: "ORBIT-42-release-brief.md", mime: "text/markdown",
    bytes: Buffer.from("# ORBIT-42 release brief\n\nRelease window: Friday.\n").toString("base64"),
  });
  const recording = await call("talk", "talk", "recording_create", { kind: "recording", projectId, threadId: null });
  await call("talk", "talk", "recording_rename", { id: recording.id, title: "ORBIT-42 audio fixture (silence)" });
  // One second of valid silent PCM: no microphone, transcription, or agent run.
  const wav = Buffer.alloc(32044);
  wav.write("RIFF"); wav.writeUInt32LE(32036, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(32000, 40);
  await call("talk", "talk", "segment_put", {
    recordingId: recording.id, sessionId: "stagedseed1", index: 0, startedAt: Date.now(),
    durationMs: 1000, mimeType: "audio/wav", audioBase64: wav.toString("base64"),
  });
  await call("talk", "talk", "recording_state", { id: recording.id, status: "paused" });
  const expected = { page: page.id, drawing: drawing.id, table: table.id, task: task.id, artifact: artifact.id, recording: recording.id };
  const { providers, items } = await pluginRpc("studio", "overview", null);
  for (const [kind, id] of Object.entries(expected)) {
    if (!items.some(item => item.id === id && item.kind === kind)) throw new Error(`Staged overview is missing ${kind} ${id}`);
  }
  return { projectId, items: expected, providers: providers.map(({ pluginId, state }) => ({ pluginId, state })) };
}
