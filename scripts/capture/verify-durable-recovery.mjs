import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pluginRpc, sleep } from "./bb.mjs";

export async function requireRecoveryStage() {
  const dataDir = process.env.BB_DATA_DIR;
  const manifest = await readFile(resolve(dataDir, "../capture.env"), "utf8");
  assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`));
  assert.ok(manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`));
}

/** Dirty editors intentionally guard reload. Without Page.enable CDP can stall. */
export async function allowRecoveryReload(client) {
  await client.command("Page.enable");
  const dialogs = [];
  const onMessage = event => {
    const message = JSON.parse(event.data);
    if (message.method !== "Page.javascriptDialogOpening") return;
    if (message.params.type !== "beforeunload") return;
    dialogs.push(message.params.type);
    void client.command("Page.handleJavaScriptDialog", { accept: true });
  };
  client.socket.addEventListener("message", onMessage);
  return { dialogs, dispose: () => client.socket.removeEventListener("message", onMessage) };
}

/** Read actual committed records; never seed metadata as a substitute for capture. */
export async function localRecoveryRecords(client, database, store) {
  return client.evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open(${JSON.stringify(database)}, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const query = db.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll();
      query.onerror = () => { db.close(); reject(query.error); };
      query.onsuccess = () => {
        const result = query.result.map(record => record.parts
          ? { ...record, parts: record.parts.map(part => part.byteLength) }
          : record);
        db.close(); resolve(result);
      };
    };
  })`, true);
}

/** Inject a browser storage failure without altering the plugin or server. */
export async function failRecoveryWrites(client, database) {
  await requireRecoveryStage();
  await client.evaluate(`(() => {
    if (window.__recoveryOriginalPut) throw new Error('Storage fault already installed');
    window.__recoveryOriginalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === ${JSON.stringify(database)}) throw new DOMException('Injected local storage quota failure', 'QuotaExceededError');
      return window.__recoveryOriginalPut.apply(this, args);
    };
  })()`);
  return () => client.evaluate(`(() => {
    if (window.__recoveryOriginalPut) IDBObjectStore.prototype.put = window.__recoveryOriginalPut;
    delete window.__recoveryOriginalPut;
  })()`);
}

/** A fresh real canvas edit, offline durable write, and guarded browser reload. */
export async function verifyOfflineDrawing(client, { projectId, screenshotPath, resultPath }) {
  await requireRecoveryStage();
  const { drawing } = await pluginRpc("excalidraw", "createDrawing", { name: "Offline recovery verification", projectId });
  const handling = await allowRecoveryReload(client);
  const result = { drawingId: drawing.id, dialogs: handling.dialogs };
  try {
    await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
    await client.waitForSelector(".excalidraw canvas");
    await sleep(500);
    await client.command("Network.enable");
    await client.command("Network.setBlockedURLs", { urls: ["*api/v1/plugins/excalidraw/rpc/saveDrawing*"] });
    await client.command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await client.drawRectangle();
    await sleep(1000);
    const read = async () => (await localRecoveryRecords(client, "bb-studio-drawing-drafts", "drafts")).filter(draft => draft.drawingId === drawing.id);
    const before = await read();
    assert.equal(before.length, 1);
    assert.equal(JSON.parse(before[0].data).elements.length, 1);
    await client.command("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await client.command("Page.reload");
    await sleep(1000);
    await client.waitForSelector('[aria-label="Unsaved drawing recovery"]');
    assert.deepEqual(await read(), before);
    result.exactDraftSurvivedReload = true;
    result.draftId = before[0].id;
    await client.capture(screenshotPath);
    return result;
  } finally {
    await client.command("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await client.command("Network.setBlockedURLs", { urls: [] });
    // Keep the source/draft available for further recovery decisions. Caller
    // owns cleanup of this returned drawing and its isolated browser profile.
    handling.dispose();
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  }
}
