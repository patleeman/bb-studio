// Studio Design: a design open full screen, with a round of two live options,
// and a three-step prototype splayed into one frame per step.
//
// Only agent tools write screens, so the seeder creates each design through
// Studio's studio_create RPC and then writes rounds and screens with the
// plugin's own DesignStore, straight into the staged data directory's
// plugins/design/data.db (the plugin has already run its migrations).
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const storeModule = join(repoRoot, "packages/bb-studio-design/src/server/store.ts");
const sqliteModule = join(repoRoot, "packages/bb-studio-design/node_modules/better-sqlite3/lib/index.js");
const tsx = join(repoRoot, "node_modules/.bin/tsx");

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif`;
const ACCENT = "oklch(0.55 0.15 255)";

/** Option 1a: the desktop welcome screen for Orbit's release planner. */
const welcomeDesktop = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Welcome to Orbit</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 ${FONT}; color: oklch(0.22 0.01 255); background: oklch(0.985 0.003 255); }
  header { display: flex; align-items: center; justify-content: space-between; padding: 24px 56px; border-bottom: 1px solid oklch(0.92 0.005 255); }
  .brand { font-weight: 700; font-size: 20px; }
  nav { display: flex; gap: 28px; color: oklch(0.45 0.01 255); font-size: 15px; }
  main { display: grid; grid-template-columns: 1.1fr 1fr; gap: 56px; padding: 72px 56px; align-items: center; }
  h1 { font-size: 48px; line-height: 1.1; margin: 0 0 20px; }
  p { margin: 0 0 32px; font-size: 18px; color: oklch(0.42 0.01 255); text-wrap: pretty; max-width: 30em; }
  .actions { display: flex; gap: 12px; }
  button { font: inherit; font-weight: 600; padding: 12px 22px; border-radius: 8px; border: 1px solid oklch(0.85 0.01 255); background: white; cursor: pointer; }
  button.primary { background: ${ACCENT}; border-color: ${ACCENT}; color: white; }
  .card { background: white; border: 1px solid oklch(0.92 0.005 255); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
  .card h2 { margin: 0; font-size: 15px; color: oklch(0.45 0.01 255); font-weight: 600; }
  .row { display: flex; justify-content: space-between; padding: 12px 0; border-top: 1px solid oklch(0.94 0.005 255); font-size: 15px; }
  .row:first-of-type { border-top: 0; }
  .tag { font-size: 13px; padding: 2px 10px; border-radius: 999px; background: oklch(0.95 0.03 255); color: ${ACCENT}; }
</style>
</head>
<body>
<header><span class="brand">Orbit</span><nav><span>Releases</span><span>Checklists</span><span>Team</span></nav></header>
<main>
  <section>
    <h1>Plan every release in one place</h1>
    <p>Orbit keeps your release notes, checklist and ship window together, so the whole team sees what is left before Friday.</p>
    <div class="actions"><button class="primary" id="start">Create a release</button><button>Import from GitHub</button></div>
  </section>
  <section class="card" aria-label="Upcoming releases">
    <h2>Upcoming releases</h2>
    <div class="row"><span>ORBIT-42 · Offline sync</span><span class="tag">Friday</span></div>
    <div class="row"><span>ORBIT-43 · Billing fixes</span><span class="tag">Oct 17</span></div>
    <div class="row"><span>ORBIT-44 · New onboarding</span><span class="tag">Oct 24</span></div>
  </section>
</main>
</body>
</html>`;

/** Option 1b: the same welcome screen for phones. */
const welcomeMobile = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Welcome to Orbit</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; font: 16px/1.5 ${FONT}; color: oklch(0.22 0.01 255); background: oklch(0.985 0.003 255); padding: 64px 24px 40px; }
  .brand { font-weight: 700; font-size: 20px; margin-bottom: 48px; }
  h1 { font-size: 34px; line-height: 1.15; margin: 0 0 16px; }
  p { margin: 0 0 32px; color: oklch(0.42 0.01 255); text-wrap: pretty; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  li { background: white; border: 1px solid oklch(0.92 0.005 255); border-radius: 12px; padding: 14px 16px; display: flex; justify-content: space-between; }
  li span:last-child { color: ${ACCENT}; font-size: 14px; }
  .actions { margin-top: auto; display: flex; flex-direction: column; gap: 12px; }
  button { font: inherit; font-weight: 600; min-height: 48px; border-radius: 10px; border: 1px solid oklch(0.85 0.01 255); background: white; }
  button.primary { background: ${ACCENT}; border-color: ${ACCENT}; color: white; }
</style>
</head>
<body>
  <div class="brand">Orbit</div>
  <h1>Plan every release in one place</h1>
  <p>Release notes, checklist and ship window, together for the whole team.</p>
  <ul>
    <li><span>ORBIT-42 · Offline sync</span><span>Friday</span></li>
    <li><span>ORBIT-43 · Billing fixes</span><span>Oct 17</span></li>
  </ul>
  <div class="actions"><button class="primary">Create a release</button><button>Sign in</button></div>
</body>
</html>`;

/** A three-step mobile prototype: one screen, opened at a step by the URL hash. */
const releasePrototype = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="bb-design-steps" content="name=Name the release; checklist=Pick a checklist; done=Release created">
<title>New release</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; font: 16px/1.5 ${FONT}; color: oklch(0.22 0.01 255); background: oklch(0.985 0.003 255); }
  section { display: none; min-height: 100vh; flex-direction: column; padding: 56px 24px 40px; }
  section.on { display: flex; }
  .progress { font-size: 14px; color: oklch(0.5 0.01 255); margin-bottom: 12px; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 24px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; font-weight: 600; margin-bottom: 18px; }
  input { font: inherit; font-weight: 400; padding: 12px 14px; border-radius: 10px; border: 1px solid oklch(0.85 0.01 255); background: white; }
  .option { display: flex; flex-direction: row; gap: 12px; align-items: flex-start; padding: 14px 16px; border-radius: 12px; border: 1px solid oklch(0.9 0.005 255); background: white; margin-bottom: 12px; font-weight: 400; font-size: 15px; }
  .option input { margin-top: 4px; }
  .option b { display: block; font-size: 16px; }
  .option small { color: oklch(0.5 0.01 255); }
  .footer { margin-top: auto; display: flex; flex-direction: column; gap: 12px; }
  button { font: inherit; font-weight: 600; min-height: 48px; border-radius: 10px; border: 1px solid ${ACCENT}; background: ${ACCENT}; color: white; }
  button.quiet { background: white; color: oklch(0.3 0.01 255); border-color: oklch(0.85 0.01 255); }
  .done { align-items: center; justify-content: center; text-align: center; }
  .check { width: 64px; height: 64px; border-radius: 50%; background: oklch(0.93 0.06 155); color: oklch(0.45 0.13 155); display: grid; place-items: center; font-size: 30px; margin: 0 auto 20px; }
</style>
</head>
<body>
<section id="name">
  <div class="progress">Step 1 of 3</div>
  <h1>Name the release</h1>
  <label>Release name <input id="title" value="ORBIT-45 · Shared calendars"></label>
  <label>Ship window <input value="Friday, Oct 31"></label>
  <div class="footer"><button data-go="checklist">Continue</button></div>
</section>
<section id="checklist">
  <div class="progress">Step 2 of 3</div>
  <h1>Pick a checklist</h1>
  <label class="option"><input type="radio" name="list" checked><span><b>Standard release</b><small>Notes, QA sign-off, staged rollout</small></span></label>
  <label class="option"><input type="radio" name="list"><span><b>Hotfix</b><small>QA sign-off and a same-day ship</small></span></label>
  <label class="option"><input type="radio" name="list"><span><b>Start empty</b><small>Add your own steps later</small></span></label>
  <div class="footer"><button data-go="done">Create release</button><button class="quiet" data-go="name">Back</button></div>
</section>
<section id="done" class="done">
  <div class="check">✓</div>
  <h1 id="summary">ORBIT-45 · Shared calendars is ready</h1>
  <p>The standard checklist has 9 steps. Your team can see it now.</p>
  <div class="footer" style="width:100%"><button data-go="name">Open the release</button></div>
</section>
<script>
  const show = () => {
    const step = location.hash.slice(1) || "name";
    document.querySelectorAll("section").forEach((s) => s.classList.toggle("on", s.id === step));
    document.getElementById("summary").textContent = document.getElementById("title").value + " is ready";
  };
  document.addEventListener("click", (event) => {
    const go = event.target.closest("[data-go]");
    if (go) location.hash = go.dataset.go;
  });
  addEventListener("hashchange", show);
  show();
</script>
</body>
</html>`;

const DESIGNS = {
  welcome: {
    name: "Orbit onboarding",
    rounds: [{ round: 1, title: "Welcome screen", intro: "The first screen a new team sees, on desktop and on a phone." }],
    screens: [
      { id: "1a", viewport: "desktop", title: "Desktop", caption: "Desktop: the pitch beside the upcoming releases", html: welcomeDesktop },
      { id: "1b", viewport: "mobile", title: "Mobile", caption: "Mobile layout", html: welcomeMobile },
    ],
  },
  prototype: {
    name: "New release flow",
    rounds: [{ round: 1, title: "Create a release", intro: "One prototype for the whole flow, played from any step." }],
    screens: [{ id: "1a", viewport: "mobile", title: "New release", caption: "Three steps on a phone", html: releasePrototype }],
  },
};

/** Writes rounds and screens through the plugin's DesignStore, run by tsx so it can load the TypeScript. */
async function writeScreens(designId, design) {
  const dir = await mkdtemp(join(tmpdir(), "design-seed-"));
  const script = join(dir, "seed.mts");
  await writeFile(
    script,
    `import Database from ${JSON.stringify(sqliteModule)};
import { DesignStore } from ${JSON.stringify(storeModule)};
const input = ${JSON.stringify({ designId, rounds: design.rounds, screens: design.screens })};
const db = new Database(${JSON.stringify(join(process.env.BB_DATA_DIR, "plugins/design/data.db"))});
db.pragma("busy_timeout = 5000");
const store = new DesignStore(db);
for (const round of input.rounds) store.setRound(input.designId, round.round, { title: round.title, intro: round.intro }, "agent");
for (const screen of input.screens) store.writeScreen(input.designId, screen, "agent");
db.close();
`,
  );
  try {
    const child = spawn(tsx, [script], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolvePromise) => child.on("close", resolvePromise));
    if (code !== 0) throw new Error(`Seeding design screens failed: ${output}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Creates a design the way Studio does, names it, and writes its screens. */
async function seedDesign(key, { projectId, bbCli, pluginRpc }) {
  const design = DESIGNS[key];
  const dir = await mkdtemp(join(tmpdir(), "design-create-"));
  const inputFile = join(dir, "input.json");
  await writeFile(inputFile, JSON.stringify({ kind: "design", projectId }));
  let id;
  try {
    const output = JSON.parse(await bbCli(["plugin", "rpc", "call", "design", "studio_create", "--input-file", inputFile, "--json"]));
    id = (output.result ?? output).item.id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const cleanup = () => pluginRpc("design", "deleteDesign", { id }).catch(() => {});
  try {
    await pluginRpc("design", "renameDesign", { id, name: design.name });
    await writeScreens(id, design);
    const { design: view } = await pluginRpc("design", "getDesign", { id });
    const ids = view.rounds.flatMap((round) => round.screens.map((screen) => screen.id)).join(",");
    if (ids !== design.screens.map((screen) => screen.id).join(",")) throw new Error(`The seeded design has screens ${ids}`);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { id, cleanup };
}

/** Waits until a frame's screen has rendered `text`, read through its own route (the frame is sandboxed). */
async function waitForFrame(client, sleep, title, text) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const state = await client.evaluate(`(async () => {
      const frame = document.querySelector(${JSON.stringify(`iframe[title="${title}"]`)});
      if (!frame) return "missing";
      const box = frame.getBoundingClientRect();
      if (box.width < 50 || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) return "offscreen";
      const body = await (await fetch(frame.src.split("#")[0])).text();
      return body.includes(${JSON.stringify(text)}) ? "ok" : "wrong";
    })()`, true);
    if (state === "ok") return;
    if (Date.now() > deadline) throw new Error(`Frame "${title}" is ${state}`);
    await sleep(500);
  }
}

/** The floating pills: Select/Comment mode on the left, zoom on the right. */
async function waitForPills(client) {
  await client.waitForAriaButton("Reload screens");
  await client.waitForSelector('[role="group"][aria-label="Mode"] button[aria-pressed="true"]');
  const modes = await client.evaluate(`[...document.querySelectorAll('[role="group"][aria-label="Mode"] button')].map((b) => b.textContent.trim()).join("|")`);
  if (!/^Select\|Comment/.test(modes)) throw new Error(`The mode pill shows ${modes}`);
  await client.waitForAriaButton("Zoom out");
  await client.waitForAriaButton("Zoom in");
  await client.waitForSelector('button[title="Zoom to fit"]');
  const zoom = await client.evaluate(`document.querySelector('button[title="Zoom to fit"]').textContent.trim()`);
  if (!/^\d+%$/.test(zoom)) throw new Error(`The zoom pill shows "${zoom}"`);
  await client.waitForAriaButton("Present");
}

export default (context) => [
  {
    id: "design",
    packageDir: "bb-studio-design",
    privateSidebar: true,
    setup: async (client) => {
      const { id, cleanup } = await seedDesign("welcome", context);
      try {
        await client.navigate(`/plugins/design/designs/${id}`);
        await client.waitForInputValue("Design name", "Orbit onboarding");
        await client.waitForSelector("h2#round-1");
        await client.waitForText("Welcome screen");
        await client.waitForText("Desktop: the pitch beside the upcoming releases");
        await client.waitForText("Mobile layout");
        await waitForPills(client);
        await waitForFrame(client, context.sleep, "Screen 1a", "Plan every release in one place");
        await waitForFrame(client, context.sleep, "Screen 1b", "Plan every release in one place");
        // Let the live frames paint before the shot.
        await context.sleep(2500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "design-prototype",
    packageDir: "bb-studio-design",
    fileName: "staged-prototype.png",
    privateSidebar: true,
    setup: async (client) => {
      const { id, cleanup } = await seedDesign("prototype", context);
      try {
        await client.navigate(`/plugins/design/designs/${id}`);
        await client.waitForInputValue("Design name", "New release flow");
        await client.waitForText("Create a release");
        await client.waitForText("3 steps");
        await waitForPills(client);
        for (const step of ["Name the release", "Pick a checklist", "Release created"]) {
          await client.waitForSelector(`button[title=${JSON.stringify(`Play 1a from ${step}`)}]`);
          await waitForFrame(client, context.sleep, `Screen 1a, ${step}`, "ORBIT-45");
        }
        // Each frame opens at its own step through the URL hash.
        const hashes = await client.evaluate(`[...document.querySelectorAll('iframe[title^="Screen 1a,"]')].map((f) => new URL(f.src).hash).join(",")`);
        if (hashes !== "#name,#checklist,#done") throw new Error(`The prototype's frames open at ${hashes}`);
        await context.sleep(2500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
];
