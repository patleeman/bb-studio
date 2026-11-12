// Seeds Studio's side of the demo on the RUNNING scratch server, through
// Studio's own RPCs and CLI (scratch.sh bb ...). Nothing here starts a turn:
// Bots are made on threads seed-db.mts already wrote, and todos are written
// to Studio's database directly, because `loops.add` asks the Bot to fill
// them in.
//
//   node seed-studio.mjs <ids.json>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bots, pages, memory, automations, todos, threads, skills } from "./demo-data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = join(here, "scratch.sh");
const { ids } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "bbsite-rpc-"));
const data = process.env.SCRATCH ? join(process.env.SCRATCH, "data") : "/tmp/bbsite/data";

const bb = (...args) => execFileSync(scratch, ["bb", ...args], { encoding: "utf8" });
let n = 0;
function rpc(method, input) {
  const file = join(tmp, `in${n++}.json`);
  writeFileSync(file, JSON.stringify(input));
  return JSON.parse(bb("plugin", "rpc", "call", "studio", method, "--input-file", file, "--json"));
}

// The Bot sidebar.
bb("settings", "ui", "set", "sidebar.threadListProvider", "studio/everything");

// Bots: Atlas is the primary Bot; the others get their own Main thread.
const botIds = {};
const existing = rpc("bot_list", {}).bots;
for (const spec of bots) {
  const found = existing.find((bot) => bot.name === spec.name);
  botIds[spec.key] = found?.id ?? rpc("bot_create", { name: spec.name, avatar: "✨", threadId: ids[`${spec.key}-main`] }).bot.id;
}
for (const spec of bots) {
  const theme = rpc("themes_list", {}).themes?.find((t) => t.theme.id === spec.theme)?.theme;
  const defaults = theme?.defaults ?? {};
  rpc("bot_set_appearance", {
    botId: botIds[spec.key],
    appearance: {
      themeId: spec.theme,
      intensity: defaults.intensity ?? 0.8,
      glass: defaults.glass ?? 0.5,
      motion: defaults.motion ?? 1,
      effects: { workers: true, finished: true, needsYou: true, error: true },
    },
  });
  rpc("bot_set_presence", { botId: botIds[spec.key], presence: { form: spec.presence, color: { source: "theme" }, motion: 1 } });
}

// Pages
const listed = bb("studio", "pages", "list");
for (const page of pages) {
  if (listed.includes(page.title)) continue;
  bb("studio", "pages", "create", page.title, "--global", "--markdown", page.body);
}

// A whiteboard on the trip page.
const tripPage = bb("studio", "pages", "list").split("\n").find((line) => line.includes("Lisbon: four days"))?.split("\t")[0];
if (tripPage && !bb("studio", "whiteboards", "list").includes("Lisbon: route sketch")) bb("studio", "whiteboards", "create", "--page", tripPage, "Lisbon: route sketch");

// Memory
const known = JSON.stringify(rpc("memory.list", { botId: botIds.atlas }));
for (const record of memory) {
  if (known.includes(record.text)) continue;
  rpc("memory.add", { botId: botIds[record.bot], topic: record.topic, text: record.text });
}

// Automations, paused at once so none ever runs.
const haveAutomations = execFileSync("sqlite3", [join(data, "plugins/studio/data.db"), "SELECT name FROM bot_automations"], { encoding: "utf8" });
for (const auto of automations) {
  if (haveAutomations.split("\n").includes(auto.name)) continue;
  const made = rpc("bot_automation_create", {
    botId: botIds[auto.bot], kind: "checkin", name: auto.name, instruction: auto.instruction,
    schedule: { type: "cron", cron: auto.cron }, model: null,
  });
  const id = made.id ?? made.automation?.id;
  if (id) rpc("bot_automation_pause", { botId: botIds[auto.bot], id });
}

// Todos on and resume-after-restart off (it would try to restart the demo's running worker), then the todos themselves, written to Studio's store directly.
rpc("settings.set", { values: { loopsEnabled: true, autoResumeThreads: false, decisions_enabled: false } });
const now = Date.now();
const insert = todos.map((todo, index) => {
  const record = {
    id: `loop_demo_${index}`, title: todo.title, why: todo.why ?? "", source: null, kind: todo.kind ?? "do",
    // "patrick" is the owner value Studio's todo schema uses for the user.
    options: todo.options ?? [], owner: "patrick",
    trigger: todo.trigger.in ? { type: "time", at: now + todo.trigger.in * 3_600_000 } : todo.trigger,
    priority: "normal", push: false, status: todo.status, due: null, area: todo.area ?? null,
    createdAt: now - (index + 1) * 3_600_000, updatedAt: now - index * 600_000, closedAt: null, closedBy: null,
  };
  return `INSERT OR REPLACE INTO bot_loops VALUES ('${record.id}', '${JSON.stringify(record).replace(/'/g, "''")}');`;
}).join("\n");
execFileSync("sqlite3", [join(data, "plugins/studio/data.db")], { input: insert });

// Skills the Bots saved, written to Studio's store directly (bot_skill_write is a tool only the Bot's own thread has).
const q = (text) => `'${String(text).replace(/'/g, "''")}'`;
execFileSync("sqlite3", [join(data, "plugins/studio/data.db")], {
  input: skills.map((skill, index) => `INSERT OR REPLACE INTO bot_skills (bot_id, name, description, body, created_at, updated_at, state, pinned, used_at) VALUES (${q(botIds[skill.bot])}, ${q(skill.name)}, ${q(skill.description)}, ${q(skill.body)}, ${now - (20 + index) * 86_400_000}, ${now - (2 + index) * 86_400_000}, 'active', ${skill.pinned ? 1 : 0}, ${now - skill.usedAgo});`).join("\n"),
});

// Reload Studio so it sorts the seeded threads into conversations and workers,
// then mark the conversation that needs you.
bb("plugin", "reload", "studio");
await new Promise((done) => setTimeout(done, 15_000));
for (const spec of threads.filter((t) => t.needsYou)) rpc("bot_needs_you_set", { threadId: ids[spec.key], reason: spec.needsYou });

writeFileSync(join(tmp, "bots.json"), JSON.stringify(botIds));
console.log(JSON.stringify({ botIds, todos: todos.length, data }));
