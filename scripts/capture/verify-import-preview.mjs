import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { sleep } from "./bb.mjs";

/** Exercise the actual browser file chooser and File/onChange import path. */
export async function chooseImportFile(client, path) {
  await client.command("Page.enable");
  await client.command("Page.setInterceptFileChooserDialog", { enabled: true });
  let chooser;
  const listener = event => { const m = JSON.parse(event.data); if (m.method === "Page.fileChooserOpened") chooser = m.params; };
  client.socket.addEventListener("message", listener);
  try {
    const point = await client.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Import');
      if (!button) throw new Error('Missing Import button');
      const rect = button.getBoundingClientRect(); return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
    })()`);
    await client.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    for (let i = 0; !chooser && i < 40; i++) await sleep(100);
    assert.ok(chooser?.backendNodeId, "Import must open a real file chooser");
    await client.command("DOM.setFileInputFiles", { files: [path], backendNodeId: chooser.backendNodeId });
    return { mode: chooser.mode, opened: true };
  } finally {
    client.socket.removeEventListener("message", listener);
    await client.command("Page.setInterceptFileChooserDialog", { enabled: false });
  }
}

/** Read completed browser download bytes, never substitute an RPC response. */
export async function waitForDownload(directory, name) {
  for (let i = 0; i < 80; i++) {
    if ((await readdir(directory)).includes(name)) return readFile(`${directory}/${name}`);
    await sleep(150);
  }
  throw new Error(`Browser did not download ${name}`);
}

export async function capturePreviewBounds(client, path) {
  const state = await client.evaluate(`({ width: innerWidth, height: innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    download: !!document.querySelector('a[aria-label="Download"]'),
    text: document.body.innerText.slice(-2500) })`);
  assert.equal(state.horizontalOverflow, false, "Preview must not overflow the page horizontally");
  await client.capture(path);
  return state;
}
