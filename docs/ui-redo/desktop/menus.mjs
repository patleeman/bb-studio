#!/usr/bin/env node
/**
 * Every Studio dropdown menu, open, for the "Dropdowns" section of REDO.md:
 * before and after ebde4f05 gave portaled menus the plugin scope. Runs against
 * a staged BB (scripts/staged-bb.mjs) and seeds one item of each kind first.
 *
 *   . "$BB_STAGED_DIR/capture.env"
 *   node docs/ui-redo/desktop/menus.mjs before|after [menu,...]
 */
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, ensureChrome } from "../../../scripts/capture/driver.mjs";
import { pluginRpc, projectId, sleep, threadId } from "../../../scripts/capture/bb.mjs";
import { seedArtifact, seedDrawing, seedTalkRecording } from "../../../scripts/capture/seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2];
if (phase !== "before" && phase !== "after") throw new Error("Usage: menus.mjs before|after [menu,...]");
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const SCHEMES = (process.env.REDO_SCHEMES ?? "dark,light").split(",");

const { webSocketUrl, process: chrome } = await ensureChrome();
const client = new CdpClient(webSocketUrl);
await client.connect();
await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });

const scheme = (value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const visible = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => each.checkVisibility() && ${text === undefined ? "true" : `each.textContent.trim() === ${JSON.stringify(text)}`})`;
const rect = (expression) => client.evaluate(`(() => { const el = ${expression}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
const need = async (label, expression, timeoutMs = 15000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await rect(expression).catch(() => null);
    if (found && found.width) return found;
    await sleep(200);
  }
  throw new Error(`No ${label}`);
};
const mouse = async (type, { x, y }, extra = {}) => client.command("Input.dispatchMouseEvent", { type, x, y, button: "none", ...extra });
const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const hover = async (label, expression) => { await mouse("mouseMoved", center(await need(label, expression))); await sleep(400); };
const click = async (label, expression, { button = "left" } = {}) => {
  const point = center(await need(label, expression));
  await mouse("mouseMoved", point);
  await mouse("mousePressed", point, { button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
  await mouse("mouseReleased", point, { button, buttons: 0, clickCount: 1 });
  await sleep(500);
};
const openSub = async (text) => {
  const item = visible('[role="menu"] [role="menuitem"]', text);
  await hover(`submenu ${text}`, item);
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await sleep(500);
  const menus = await client.evaluate(`[...document.querySelectorAll('[role="menu"]')].filter((each) => each.checkVisibility()).length`);
  if (menus < 2) throw new Error(`The ${text} submenu didn't open`);
};
const escape = async () => {
  for (let i = 0; i < 3; i++) {
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(120);
  }
  await mouse("mouseMoved", { x: 1430, y: 990 });
  await sleep(300);
};
/** Every open menu and the trigger, with room around them. */
const shot = async (name, mode, trigger) => {
  await sleep(450);
  for (let i = 0; i < 15 && !(await client.evaluate(`[...document.querySelectorAll('[role="menu"]')].some((each) => each.checkVisibility())`)); i++) await sleep(200);
  const boxes = await client.evaluate(`[...document.querySelectorAll('[role="menu"], [data-radix-popper-content-wrapper]')].filter((each) => each.checkVisibility()).map((each) => { const r = each.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })`);
  if (!boxes.length) throw new Error("No menu is open");
  if (trigger) boxes.push(trigger);
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 24);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 24);
  const right = Math.min(1440, Math.max(...boxes.map((b) => b.x + b.width)) + 24);
  const bottom = Math.min(1000, Math.max(...boxes.map((b) => b.y + b.height)) + 24);
  const path = join(here, "img", "menus", `${name}-${phase}-${mode}.png`);
  await mkdir(dirname(path), { recursive: true });
  await client.capture(path, { x: left, y: top, width: right - left, height: bottom - top });
};

// ---- fixtures ---------------------------------------------------------------
const cleanups = [];
const page = async (input) => {
  const { page: made } = await pluginRpc("studio", "pages.create", { projectId, parentId: null, markdown: "", ...input });
  cleanups.push(() => pluginRpc("studio", "pages.remove", { id: made.id }).catch(() => {}));
  return made;
};
const launch = await page({ title: "Offline mode launch", icon: "🚀", markdown: "## Launch checklist\n\n- [ ] Final go/no-go review" });
await page({ title: "Rollout risks", icon: "⚠️", parentId: launch.id, markdown: "- Storage quota on older devices" });
const links = await page({ title: "Launch links", markdown: `See @[Offline mode launch](page:${launch.id}) for the checklist.` });
const retro = await page({ title: "Launch retro", markdown: "Notes from the October launch." });
const { note } = await pluginRpc("studio", "notes.create", { threadId, text: "- Beta teams: 42\n- Crash-free sessions: 99.4%" });
cleanups.push(() => pluginRpc("studio", "notes.discard", { pageId: note.pageId }).catch(() => {}));
const drawing = await seedDrawing();
cleanups.push(drawing.cleanup);
const artifact = await seedArtifact();
cleanups.push(artifact.cleanup);
const recordingId = await seedTalkRecording(projectId, { transcribe: false, title: "Weekly product sync" });
cleanups.push(() => pluginRpc("studio", "provider.call", { pluginId: "talk", method: "studio_delete", input: { ids: [recordingId] } }).catch(() => {}));
const { item: designItem } = await pluginRpc("studio", "provider.call", { pluginId: "design", method: "studio_create", input: { kind: "design", projectId } });
await pluginRpc("studio", "designs.renameDesign", { id: designItem.id, name: "Checkout redesign" });
cleanups.push(() => pluginRpc("studio", "designs.deleteDesign", { id: designItem.id }).catch(() => {}));
const { dashboard } = await pluginRpc("studio", "dashboards.create", { name: "Launch metrics", projectId });
cleanups.push(() => pluginRpc("studio", "dashboards.delete", { id: dashboard.id }).catch(() => {}));
await pluginRpc("studio", "dashboards.edit", { id: dashboard.id, ops: [
  { op: "add", type: "stat", title: "Revenue", options: { prefix: "$" }, source: { kind: "static", data: { value: 48210, delta: "+12.4%", trend: "up", series: [36100, 38900, 41800, 48210] } } },
] });
const { mini } = await pluginRpc("studio", "minis.create", { name: "Menu sampler", projectId });
cleanups.push(() => pluginRpc("studio", "provider.call", { pluginId: "minis", method: "studio_delete", input: { ids: [mini.id] } }).catch(() => {}));
await pluginRpc("studio", "minis.save", { id: mini.id, note: "Seeded", files: {
  "mini.json": JSON.stringify({ entry: "main.jsx", size: { minHeight: 360 } }),
  "main.jsx": `import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@studio/kit";
export default function App() {
  return (
    <div className="p-4">
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger asChild><Button variant="outline">Deal actions</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Acme renewal</DropdownMenuLabel>
          <DropdownMenuItem>Mark as won</DropdownMenuItem>
          <DropdownMenuItem>Move to proposal</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive">Delete deal</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
` } });
let { bot } = await pluginRpc("studio", "bot_get", {});
if (!bot) ({ bot } = await pluginRpc("studio", "bot_create", { name: "Dot", avatar: "🟣", shape: "blob", color: "#7c66dc", setup: "" }));

const studioTab = async (path) => {
  await client.resetCaptureState();
  await client.navigate(path);
  await client.waitForSelector(`[data-studio-workspace-editor="${path}"]`, 30000);
  await sleep(1200);
};
const collection = async () => {
  await client.resetCaptureState();
  await client.navigate("/plugins/studio/studio/collection");
  await client.evaluate(`localStorage.setItem("studio:query:all", "")`);
  await client.navigate("/plugins/studio/studio/collection");
  await client.waitForSelector('[data-studio-workspace] [role="row"][aria-label="Launch retro"]', 30000);
  await sleep(600);
};
const row = (title) => `document.querySelector('[data-studio-workspace] [role="row"][aria-label=${JSON.stringify(title)}]')`;
// The item's own ⋯ in its header, not BB's rail.
const more = visible('[data-studio-item-header] button[aria-label="More"]');
const pagePath = (id) => `/plugins/studio/studio/pages/${id}`;

// name -> open the menu, returning the trigger's box (or null).
const menus = {
  "studio-options": async () => { await collection(); const t = await need("Studio options", visible('button[aria-label="Studio options"]')); await click("Studio options", visible('button[aria-label="Studio options"]')); return t; },
  "collection-new": async () => { await collection(); const sel = visible("[data-studio-workspace-bar] button, [data-studio-bar] button", "New"); const t = await need("New", sel); await click("New", sel); return t; },
  "collection-row-actions": async () => {
    await collection();
    await hover("row", row("Launch retro"));
    const sel = `${row("Launch retro")}.querySelector('button[aria-label="Actions"]')`;
    const t = await need("row Actions", sel); await click("row Actions", sel); return t;
  },
  "collection-row-move-to": async () => { const t = await menus["collection-row-actions"](); await openSub("Move to"); return t; },
  "collection-row-context": async () => { await collection(); await click("row", row("Launch retro"), { button: "right" }); return null; },
  "collection-bulk-move": async () => {
    await collection();
    await hover("row", row("Launch retro"));
    await click("row checkbox", `${row("Launch retro")}.querySelector('[role="checkbox"], input[type="checkbox"]')`);
    const sel = visible("button", "Move"); const t = await need("Move", sel); await click("Move", sel); return t;
  },
  "collection-bulk-tag": async () => {
    await collection();
    await hover("row", row("Launch retro"));
    await click("row checkbox", `${row("Launch retro")}.querySelector('[role="checkbox"], input[type="checkbox"]')`);
    const sel = visible("button", "Tag"); const t = await need("Tag", sel); await click("Tag", sel); return t;
  },
  "query-chip": async () => {
    await client.resetCaptureState();
    await client.navigate("/plugins/studio/studio/collection");
    await client.evaluate(`localStorage.setItem("studio:query:all", "kind:page ")`);
    await client.navigate("/plugins/studio/studio/collection");
    const sel = visible('button[aria-label^="Options for"]'); const t = await need("filter chip", sel, 30000); await click("filter chip", sel); return t;
  },
  "sidebar-new": async () => { await collection(); const sel = visible('button[aria-label="New"][title="New"]'); const t = await need("sidebar New", sel); await click("sidebar New", sel); return t; },
  "item-gesture": async () => { await studioTab(pagePath(links.id)); await click("mention", visible('[data-studio-workspace-editor] [data-inline-content-type="mention"], [data-studio-workspace-editor] .bn-inline-content a'), { button: "right" }); return null; },
  "page-menu": async () => { await studioTab(pagePath(retro.id)); const sel = visible('button[aria-label="Page actions"]'); const t = await need("Page actions", sel); await click("Page actions", sel); return t; },
  "page-menu-move-project": async () => { const t = await menus["page-menu"](); await openSub("Move to project"); return t; },
  "page-icon-picker": async () => { await studioTab(pagePath(retro.id)); const sel = visible('button[aria-label="Add icon"]'); const t = await need("Add icon", sel); await click("Add icon", sel); return t; },
  "note-send": async () => { await studioTab(pagePath(note.pageId)); const sel = visible('button[aria-label="How to send"]'); const t = await need("How to send", sel, 20000); await click("How to send", sel); return t; },
  "drawing-more": async () => { await studioTab(`/plugins/studio/studio/drawings/${drawing.drawing.id}`); const t = await need("More", more, 30000); await click("More", more); return t; },
  "recording-more": async () => { await studioTab(`/plugins/studio/studio/recordings/${recordingId}`); const t = await need("More", more, 30000); await click("More", more); return t; },
  "recording-more-move-to": async () => { const t = await menus["recording-more"](); await openSub("Move to"); return t; },
  "artifact-more": async () => { await studioTab(`/plugins/studio/studio/artifacts/${artifact.artifactId}`); const t = await need("More", more, 30000); await click("More", more); return t; },
  "artifact-more-versions": async () => { const t = await menus["artifact-more"](); await openSub("Versions"); return t; },
  "dashboard-widget": async () => {
    await studioTab(`/plugins/studio/studio/dashboards/${dashboard.id}`);
    await hover("widget", `document.querySelector("[data-widget-id]")`);
    const sel = visible('button[aria-label="More for Revenue"]'); const t = await need("widget menu", sel, 20000); await click("widget menu", sel); return t;
  },
  "dashboard-versions": async () => { await studioTab(`/plugins/studio/studio/dashboards/${dashboard.id}`); const sel = visible('button[aria-label="Version history"]'); const t = await need("Version history", sel, 20000); await click("Version history", sel); return t; },
  "mini-app-menu": async () => {
    await studioTab(`/plugins/studio/studio/minis/${mini.id}`);
    const frame = await need("mini frame", `document.querySelector("[data-studio-workspace-editor] iframe")`, 30000);
    await sleep(2500);
    return { clip: { x: frame.x, y: frame.y, width: Math.min(frame.width, 420), height: Math.min(frame.height, 300) } };
  },
  "bot-menu": async () => {
    await client.resetCaptureState();
    await client.navigate(`/plugins/studio/studio/bot/${bot.id}`);
    const sel = visible('button[aria-label="Bot menu"]'); const t = await need("Bot menu", sel, 30000); await click("Bot menu", sel); return t;
  },
  "bot-threads-sort": async () => {
    await client.resetCaptureState();
    await client.navigate(`/plugins/studio/studio/bot/${bot.id}`);
    const sel = visible('button[aria-label="Sort and group threads"]'); const t = await need("Sort and group", sel, 30000); await click("Sort and group", sel); return t;
  },
  "bot-automations": async () => {
    await client.resetCaptureState();
    await client.navigate(`/plugins/studio/studio/bot/${bot.id}`);
    const sel = visible('section[aria-label="Automations"] button', "New"); const t = await need("Automations New", sel, 30000);
    if (await client.evaluate(`${sel}.disabled`)) throw new Error("Automations New is disabled for this bot");
    await click("Automations New", sel);
    return t;
  },
  "bot-cache": async () => {
    await client.resetCaptureState();
    await client.navigate(`/projects/${bot.projectId ?? projectId}/threads/${bot.threadId}`);
    const sel = visible('[data-testid="bot-cache-chip"]');
    const t = await need("cache indicator", sel, 30000); await click("cache indicator", sel); return t;
  },
};

const failed = [];
try {
  for (const [name, open] of Object.entries(menus)) {
    if (only && !only.has(name)) continue;
    for (const mode of SCHEMES) {
      process.stdout.write(`${name} (${mode})\n`);
      try {
        await scheme(mode);
        const trigger = await open();
        if (trigger?.clip) {
          const path = join(here, "img", "menus", `${name}-${phase}-${mode}.png`);
          await mkdir(dirname(path), { recursive: true });
          await client.capture(path, trigger.clip);
        } else await shot(name, mode, trigger);
      } catch (error) {
        failed.push(`${name} (${mode}): ${error.message.split("\n")[0]}`);
        await client.capture(join(tmpdir(), `redo-d-menu-${name}-${mode}.png`)).catch(() => {});
      }
      await escape();
    }
  }
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
  client.socket?.close();
  chrome?.kill();
}
if (failed.length) process.stdout.write(`\nFailed:\n  ${failed.join("\n  ")}\n`);
process.exit(0);
