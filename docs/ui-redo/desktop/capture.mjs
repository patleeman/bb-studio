#!/usr/bin/env node
/**
 * Before and after renders for the surface D UI redo (docs/ui-redo/desktop/REDO.md).
 * Runs against a staged BB (scripts/staged-bb.mjs) and forces each failure
 * state by answering the Studio RPC it depends on with an error in the
 * capture browser. Nothing on the server is broken.
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   node docs/ui-redo/desktop/capture.mjs before|after [scene,...]
 */
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, ensureChrome } from "../../../scripts/capture/driver.mjs";
import { bbCli, pluginRpc, projectId, sleep, threadId } from "../../../scripts/capture/bb.mjs";
import { seedDrawing } from "../../../scripts/capture/seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2];
if (phase !== "before" && phase !== "after") throw new Error("Usage: capture.mjs before|after [scene,...]");
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const SCHEMES = (process.env.REDO_SCHEMES ?? "dark,light").split(",");

const { webSocketUrl, process: chrome } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
await client.connect();
await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });

// RPC faults: method -> { mode: "fail" | "hold", message, when?(body) }.
const faults = new Map();
const held = [];
const failBody = (message) => Buffer.from(JSON.stringify({ ok: false, error: { code: "unavailable", message } })).toString("base64");
const fail = (requestId, message) => client.command("Fetch.fulfillRequest", {
  requestId, responseCode: 500, responseHeaders: [{ name: "content-type", value: "application/json" }], body: failBody(message),
}).catch(() => {});
client.socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method !== "Fetch.requestPaused") return;
  const { requestId, request } = message.params;
  const method = decodeURIComponent(request.url.split("/rpc/")[1]?.split("?")[0] ?? "");
  const fault = faults.get(method);
  if (!fault || (fault.when && !fault.when(request.postData ?? ""))) {
    client.command("Fetch.continueRequest", { requestId }).catch(() => {});
  } else if (fault.mode === "hold") held.push({ requestId, method });
  else void fail(requestId, fault.message);
});
await client.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/plugins/studio/rpc/*" }] });
const clearFaults = () => { faults.clear(); };
const releaseHeld = (method, message) => {
  for (const each of held.splice(0)) {
    if (each.method === method) void fail(each.requestId, message);
    else client.command("Fetch.continueRequest", { requestId: each.requestId }).catch(() => {});
  }
};

const scheme = async (value) => {
  await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
  await sleep(300);
  const dark = await client.evaluate(`document.documentElement.classList.contains("dark")`);
  if (dark !== (value === "dark")) throw new Error(`BB isn't in ${value} mode`);
};
const rectOf = (expression) => client.evaluate(`(() => { const el = ${expression}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
const pad = (rect, by = 16, extra = {}) => ({
  x: Math.max(0, rect.x - by), y: Math.max(0, rect.y - by),
  width: Math.min(1440 - Math.max(0, rect.x - by), rect.width + by * 2 + (extra.width ?? 0)),
  height: Math.min(1000 - Math.max(0, rect.y - by), rect.height + by * 2 + (extra.height ?? 0)),
});
const shot = async (name, mode, clip) => {
  const path = join(here, "img", `${name}-${phase}-${mode}.png`);
  await mkdir(dirname(path), { recursive: true });
  await client.capture(path, clip);
  process.stdout.write(`  ${path}\n`);
};
const waitFor = async (label, expression, timeoutMs = 15000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await client.poll(`Boolean(${expression})`)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const clickText = (text, scope = "document") => client.evaluate(`(() => {
  const button = [...${scope}.querySelectorAll("button, [role=menuitem]")].find((each) => each.textContent.trim() === ${JSON.stringify(text)} && each.checkVisibility());
  if (!button) throw new Error(${JSON.stringify(`No button ${text}`)});
  button.click();
})()`);
const createPage = async (input) => (await pluginRpc("studio", "pages.create", { projectId, parentId: null, markdown: "", ...input })).page;
const removePage = (id) => pluginRpc("studio", "pages.remove", { id }).catch(() => {});
const openPage = async (id) => {
  // Each scene starts from an empty workspace, without the last scene's tabs.
  await client.resetCaptureState();
  await client.navigate(`/plugins/pages/pages/${id}`);
  await client.waitForSelector(`[data-studio-workspace-editor="/plugins/studio/studio/pages/${id}"]`, 30000);
};
const workspaceRect = () => rectOf(`[...document.querySelectorAll('[data-workspace-pane]')].find((each) => each.checkVisibility()) ?? document.querySelector('[data-studio-workspace]')`);

const scenes = {
  // c8917f9a, f0982399: content search while it runs and after it fails.
  async search(mode) {
    const page = await createPage({ title: "Offline sync checklist", icon: "✅", markdown: "Verify the outbox drains after reconnecting." });
    const other = await createPage({ title: "Beta feedback", icon: "💬", markdown: "Teams asked for an offline checklist in the onboarding." });
    try {
      await client.resetCaptureState();
      await client.navigate("/plugins/studio/studio/collection");
      await client.evaluate(`localStorage.setItem("studio:query:all", "")`);
      await client.navigate("/plugins/studio/studio/collection");
      await client.waitForSelector('[data-studio-workspace] [role="row"][aria-label="Offline sync checklist"]', 30000);
      await scheme(mode);
      faults.set("search", { mode: "hold" });
      await client.evaluate(`(() => { const input = document.querySelector('input[aria-label="Search and filter studio"]'); input.focus(); input.select(); })()`);
      await client.command("Input.insertText", { text: "checklist" });
      await sleep(1200);
      const area = await workspaceRect();
      const clip = { x: area.x, y: area.y, width: area.width, height: 420 };
      await shot("search-loading", mode, clip);
      releaseHeld("search", "Studio search index is unavailable");
      await sleep(900);
      await shot("search-error", mode, clip);
    } finally {
      clearFaults();
      releaseHeld("", "");
      await removePage(page.id);
      await removePage(other.id);
    }
  },

  // 5a368687: the breadcrumb of a nested page.
  async breadcrumb(mode) {
    const parent = await createPage({ title: "Offline mode launch", icon: "🚀" });
    const child = await createPage({ title: "Rollout risks", icon: "⚠️", parentId: parent.id, markdown: "- Storage quota on older devices" });
    try {
      await openPage(child.id);
      await client.waitForSelector('nav[aria-label="Breadcrumb"]');
      await scheme(mode);
      await sleep(500);
      const area = await workspaceRect();
      // The workspace tab row and the top of the page.
      await shot("breadcrumb", mode, { x: area.x, y: 0, width: area.width, height: area.y + 200 });
    } finally {
      await removePage(child.id);
      await removePage(parent.id);
    }
  },

  // 26bf9d29: a failed icon change and the page menu while a change runs.
  async "page-icon-error"(mode) {
    const page = await createPage({ title: "Launch retro", markdown: "Notes from the October launch." });
    try {
      await openPage(page.id);
      await client.waitForSelector('button[aria-label="Add icon"]', 30000);
      await scheme(mode);
      faults.set("pages.update", { mode: "fail", message: "This page is being moved by another session" });
      await client.evaluate(`document.querySelector('button[aria-label="Add icon"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`);
      await waitFor("the icon menu", `document.querySelector('[role="menu"] button')`);
      await client.evaluate(`document.querySelector('[role="menu"] button').click()`);
      await client.waitForText("Couldn't change the page icon").catch(() => {});
      await sleep(700);
      await shot("page-icon-error", mode);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.evaluate(`document.querySelectorAll('[data-sonner-toast] button[data-close-button]').forEach((each) => each.click())`);
      await sleep(400);
      // The page menu while a move is still running.
      faults.set("pages.update", { mode: "hold" });
      await client.evaluate(`[...document.querySelectorAll('button[aria-label="Page actions"]')].find((each) => each.checkVisibility()).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`);
      await waitFor("the page menu", `document.querySelector('[role="menu"]')`);
      await clickText("Archive");
      await sleep(300);
      await client.evaluate(`[...document.querySelectorAll('button[aria-label="Page actions"]')].find((each) => each.checkVisibility()).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`);
      await sleep(500);
      const menu = await rectOf(`document.querySelector('[role="menu"]')`);
      const trigger = await rectOf(`[...document.querySelectorAll('button[aria-label="Page actions"]')].find((each) => each.checkVisibility())`);
      if (menu && trigger) {
        const x = Math.min(menu.x, trigger.x) - 24;
        const y = Math.min(menu.y, trigger.y) - 16;
        await shot("page-menu-pending", mode, { x, y, width: Math.max(menu.x + menu.width, trigger.x + trigger.width) - x + 24, height: menu.y + menu.height - y + 16 });
      }
    } finally {
      clearFaults();
      releaseHeld("pages.update", "cancelled");
      await removePage(page.id);
    }
  },

  // 8c90c3a9: a whiteboard stroke that could not be saved.
  async whiteboard(mode) {
    const { drawing, cleanup } = await seedDrawing();
    const page = await createPage({
      title: "Checkout sketch", icon: "✏️",
      markdown: ["A quick sketch of the checkout flow.", "", "```embed", JSON.stringify({ kind: "drawing", target: drawing.id }), "```", ""].join("\n"),
    });
    try {
      await openPage(page.id);
      await client.waitForSelector("[data-whiteboard]", 30000);
      await scheme(mode);
      await client.evaluate(`document.querySelector("[data-whiteboard]").scrollIntoView({ block: "center" })`);
      await sleep(500);
      faults.set("pages.whiteboardSave", { mode: "fail", message: "BB is offline" });
      await client.evaluate(`[...document.querySelectorAll("button")].find((each) => each.textContent.trim() === "Sketch").click()`);
      await sleep(400);
      const board = await rectOf(`document.querySelector("[data-whiteboard]")`);
      const start = { x: board.x + board.width * 0.3, y: board.y + board.height * 0.75 };
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
      await client.command("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 24; step++) {
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x + step * 14, y: start.y - Math.sin(step / 4) * 30, button: "left", buttons: 1 });
        await sleep(12);
      }
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + 24 * 14, y: start.y, button: "left", buttons: 0, clickCount: 1 });
      await client.waitForText("Retry save");
      await sleep(400);
      const frame = await rectOf(`document.querySelector("[data-whiteboard]").parentElement`);
      await shot("whiteboard-save-failed", mode, pad(frame, 24));
    } finally {
      clearFaults();
      await removePage(page.id);
      await cleanup();
    }
  },

  // d132d367: the thread's Studio tab when its items can't load.
  async "studio-tab-error"(mode) {
    faults.set("threadItems", { mode: "fail", message: "Thread links are unavailable" });
    try {
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      await sleep(1500);
      await scheme(mode);
      const shown = await client.evaluate(`Boolean([...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label")?.startsWith("Hide right panel")))`);
      if (!shown) await client.evaluate(`[...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label")?.startsWith("Show right panel"))?.click()`);
      await sleep(800);
      const studio = await client.evaluate(`Boolean([...document.querySelectorAll('[role="tab"]')].find((each) => each.textContent.trim() === "Studio"))`);
      if (studio) await client.evaluate(`[...document.querySelectorAll('[role="tab"]')].find((each) => each.textContent.trim() === "Studio").click()`);
      else {
        await client.evaluate(`[...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label")?.startsWith("Open new tab")).click()`);
        await sleep(800);
        await clickText("Studio");
      }
      await client.waitForText("Couldn't load", 20000);
      await sleep(600);
      const alert = await rectOf(`[...document.querySelectorAll('[role="alert"]')].find((each) => each.textContent.includes("Couldn't load"))`);
      const x = Math.max(0, alert.x - 24);
      await shot("studio-tab-error", mode, { x, y: 0, width: 1440 - x, height: Math.min(1000, alert.y + alert.height + 220) });
    } finally {
      clearFaults();
    }
  },

  // a778a39d: Unsent audio when Talk can't read its local outbox.
  async "talk-unsent-error"(mode) {
    const { identifier } = await client.command("Page.addScriptToEvaluateOnNewDocument", { source: `
      { const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (name, version) {
          if (name === "bb-plugin-talk") throw new DOMException("The audio outbox on this device couldn't be opened.", "UnknownError");
          return open.call(this, name, version);
        }; }
    ` });
    try {
      await client.navigate("/plugins/studio/studio/recordings/unsent");
      await client.waitForText("Unsent audio", 30000);
      await scheme(mode);
      await client.waitForText("couldn’t", 20000).catch(() => client.waitForText("couldn't", 5000));
      await sleep(600);
      const area = await rectOf(`document.querySelector("h1").closest(".studio-root")`);
      await shot("talk-unsent-error", mode, { x: area.x, y: area.y, width: area.width, height: 480 });
    } finally {
      await client.command("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  },

  // 9a0c1b9c: a restore that failed after the plan, in Setup.
  async "backup-restore-error"(mode) {
    const dir = await mkdtemp(join(tmpdir(), "redo-d-backup-"));
    await bbCli(["studio", "backup", "--out", dir]);
    const file = join(dir, (await readdir(dir)).find((name) => name.endsWith(".zip")));
    faults.set("backup.restore", { mode: "fail", message: "The disk is full. Free some space and try again.", when: (body) => /"dryRun":false/.test(body) });
    try {
      await client.navigate("/plugins/studio/studio/setup");
      await client.waitForText("Backup and restore", 30000);
      await scheme(mode);
      const { root } = await client.command("DOM.getDocument", { depth: 0 });
      const { nodeId } = await client.command("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[aria-label="Backup file to restore"]' });
      await client.command("DOM.setFileInputFiles", { nodeId, files: [file] });
      await client.waitForText("Nothing has changed yet", 30000);
      const section = `[...document.querySelectorAll("section")].find((each) => each.querySelector("h2")?.textContent === "Backup and restore")`;
      await client.evaluate(`${section}.scrollIntoView({ block: "center" })`);
      await client.evaluate(`[...${section}.querySelectorAll("button")].find((each) => each.textContent.trim() === "Restore").click()`);
      await waitFor("the restore error", `${section}.querySelector('[role="alert"]')`, 20000);
      await sleep(500);
      await shot("backup-restore-error", mode, pad(await rectOf(section), 20));
    } finally {
      clearFaults();
    }
  },
};

try {
  for (const [name, run] of Object.entries(scenes)) {
    if (only && !only.has(name)) continue;
    for (const mode of SCHEMES) {
      process.stdout.write(`${name} (${mode})\n`);
      try { await run(mode); }
      catch (error) {
        await client.capture(join(tmpdir(), `redo-d-${name}-${mode}-failure.png`)).catch(() => {});
        process.stdout.write(`  FAILED: ${error.message.split("\n")[0]}\n`);
        if (process.env.REDO_STRICT) throw error;
      }
    }
  }
} finally {
  client.socket?.close();
  chrome?.kill();
}
process.exit(0);
