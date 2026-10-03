import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bbCli, pluginRpc, sleep } from "./bb.mjs";

/** Verify a real, fresh staged assistant finding. The caller owns its thread/browser. */
export async function verifyExploreTask(client, {
  projectId, threadId, messageId, label, outputDir, checkpoint,
  checkUnavailable = false,
}) {
  const dataDir = process.env.BB_DATA_DIR;
  const manifest = await readFile(resolve(dataDir, "../capture.env"), "utf8");
  assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`));
  assert.ok(manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`));
  const finding = { threadId, messageId, label, parentId: null };
  const lookup = () => pluginRpc("explore", "taskForFinding", { ...finding, create: false });
  const before = await lookup();
  assert.equal(before.available, true, "Studio Tasks must initially be running");
  assert.equal(before.task, null, "Use a fresh finding; existing tasks are never removed");
  await mkdir(outputDir, { recursive: true });
  const evidence = { checkpoint, finding };
  let space, taskId, disabled = false;
  const selector = action => `button[aria-label=${JSON.stringify(`${action}: ${label}`)}]`;
  try {
    ({ space } = await pluginRpc("studio", "createSpace", { name: "Explore task verification" }));
    await pluginRpc("studio", "spaceMembers", { id: space.id, add: [{ pluginId: "bb-thread", id: threadId }] });
    await client.navigate(`/projects/${projectId}/threads/${threadId}`);
    await client.waitForSelector(selector("Track task"));
    await client.capture(join(outputDir, "explore-track-task.png"));
    await client.evaluate(`document.querySelector(${JSON.stringify(selector("Track task"))}).click()`);
    await client.waitForSelector(selector("Open task"));
    taskId = (await lookup()).task?.id;
    assert.ok(taskId, "UI click must create a persistent task");
    evidence.taskId = taskId;
    const retries = await Promise.all(Array.from({ length: 3 }, () =>
      pluginRpc("explore", "taskForFinding", { ...finding, create: true })));
    evidence.retryIds = retries.map(result => result.task?.id);
    assert.ok(evidence.retryIds.every(id => id === taskId));
    const { task, links } = await pluginRpc("studio-tasks", "get", { id: taskId });
    assert.equal(task.projectId, projectId);
    assert.ok(links.some(link => link.target === "thread" && link.itemId === threadId));
    evidence.projectId = task.projectId;
    evidence.sourceLink = links.find(link => link.itemId === threadId);
    const { spaces } = await pluginRpc("studio", "spaces", null);
    assert.ok(spaces.find(item => item.id === space.id)?.itemKeys.includes(`studio-tasks:${taskId}`));
    evidence.spaceId = space.id;
    evidence.inheritedSpace = true;
    await client.evaluate(`document.querySelector(${JSON.stringify(selector("Open task"))}).click()`);
    await client.waitForSelector(`[data-float-window="path:/plugins/studio-tasks/tasks/${taskId}"]`);
    await client.waitForText("Finding source");
    evidence.openTask = true;
    await client.capture(join(outputDir, "explore-linked-task.png"));
    if (checkUnavailable) {
      await bbCli(["plugin", "disable", "studio-tasks"]);
      disabled = true;
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      await client.waitForText("Tasks unavailable");
      const unavailable = await client.evaluate(`document.querySelector(${JSON.stringify(selector("Track task"))})?.disabled`);
      assert.equal(unavailable, true);
      evidence.unavailableDisabled = true;
      await client.capture(join(outputDir, "explore-tasks-unavailable.png"));
      await bbCli(["plugin", "enable", "studio-tasks"]);
      disabled = false;
      await client.evaluate("window.dispatchEvent(new Event('focus'))");
      await client.waitForText("Open task");
      evidence.availabilityRecovered = true;
    }
    return evidence;
  } finally {
    if (disabled) await bbCli(["plugin", "enable", "studio-tasks"]);
    taskId ??= (await lookup()).task?.id;
    if (taskId) await pluginRpc("studio-tasks", "delete", { id: taskId });
    if (space) {
      await pluginRpc("studio", "deleteSpace", { id: space.id });
      if (space.pageId) await pluginRpc("pages", "remove", { id: space.pageId });
    }
    await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1')");
    await sleep(100);
    await writeFile(join(outputDir, "explore-verification.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}
