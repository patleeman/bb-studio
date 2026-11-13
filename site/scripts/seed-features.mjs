// Seeds the Studio items the site shows, on the RUNNING scratch server: a
// rich page with a chart, stats and embeds, a whiteboard, a design with
// screens, a dashboard, a mini app with records, artifacts, a recording with
// its transcript and notes, and a demo code folder. Everything is made up.
// Items go in through Studio's CLI and RPCs where those exist without an
// agent turn; the design and the recording's transcript are written to the
// stores directly, because only an agent (or a microphone and a speech
// model) makes those.
//
//   node seed-features.mjs <ids.json>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { design, dashboardWidgets, mini, artifacts, recording, dictation, codeFolder, launchPage, flow } from "./demo-features.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = join(here, "scratch.sh");
const SCRATCH = process.env.SCRATCH ?? "/tmp/bbsite";
const data = join(SCRATCH, "data");
const studioDb = join(data, "plugins/studio/data.db");
const { ids } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "bbsite-feat-"));
const bb = (...args) => execFileSync(scratch, ["bb", ...args], { encoding: "utf8" });
let n = 0;
function rpc(plugin, method, input) {
  const file = join(tmp, `in${n++}.json`);
  writeFileSync(file, JSON.stringify(input));
  return JSON.parse(bb("plugin", "rpc", "call", plugin, method, "--input-file", file, "--json"));
}
const sql = (db, text) => execFileSync("sqlite3", [db], { input: text, encoding: "utf8" });
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = Date.now();
const out = {};

// ---- The code folder (Studio Code opens it) ------------------------------
const repo = join(SCRATCH, "work/orbit-web");
for (const [path, text] of Object.entries(codeFolder)) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}
out.repo = repo;
// A project on the scratch host for that folder, and its Studio Code workspace.
const host = bb("machine", "list").split("\n").find((line) => /\bserver\b/.test(line)).trim().split(/\s+/)[2];
const project = JSON.parse(bb("project", "create", "--name", "orbit-web", "--root", repo, "--machine", host, "--json"));
out.codeProject = project.id ?? project.project?.id;
out.workspace = rpc("studio", "code.forFolder", { projectId: out.codeProject }).workspace.id;

// ---- Artifacts -----------------------------------------------------------
out.artifacts = {};
for (const art of artifacts) {
  const file = join(SCRATCH, "work/artifacts", art.file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, art.body);
  const mime = { html: "text/html", svg: "image/svg+xml", md: "text/markdown" }[art.file.split(".").pop()];
  const { id } = rpc("studio", "artifacts.importFile", { name: art.file, mime, bytes: Buffer.from(art.body).toString("base64"), projectId: null });
  rpc("studio", "artifacts.update", { id, title: art.title, description: art.description });
  out.artifacts[art.file] = id;
}

// ---- The mini app --------------------------------------------------------
const made = rpc("studio", "minis.create", { name: mini.name, projectId: null }).mini;
rpc("studio", "minis.save", { id: made.id, files: mini.files, note: "First version" });
for (const record of mini.records) rpc("studio", "minis.db.insert", { id: made.id, clientId: "site-seed-client", collection: mini.collection, data: record });
out.mini = made.id;

// ---- The dashboard -------------------------------------------------------
const dash = rpc("studio", "dashboards.create", { name: "orbit-web health", projectId: null }).dashboard;
rpc("studio", "dashboards.edit", { id: dash.id, ops: dashboardWidgets.map((w) => ({ op: "add", ...w })) });
out.dashboard = dash.id;

// ---- The design: one round of screens, written to Studio's store ---------
const designId = `dsn_${Math.random().toString(16).slice(2, 18).padEnd(16, "0")}`;
let designSql = `INSERT INTO designs (id, name, created_at, updated_at, project_id, updated_by) VALUES (${q(designId)}, ${q(design.name)}, ${now - 26 * 3_600_000}, ${now - 2 * 3_600_000}, NULL, 'agent');\n`;
design.rounds.forEach((round, r) => {
  designSql += `INSERT INTO design_rounds (design_id, round, title, intro) VALUES (${q(designId)}, ${r + 1}, ${q(round.title)}, ${q(round.intro)});\n`;
  round.screens.forEach((screen, s) => {
    designSql += `INSERT INTO design_screens (design_id, id, round, title, caption, viewport, html, created_at, updated_at) VALUES (${q(designId)}, ${q(`r${r + 1}s${s + 1}`)}, ${r + 1}, ${q(screen.title)}, ${q(screen.caption)}, ${q(screen.viewport)}, ${q(screen.html)}, ${now - 3 * 3_600_000}, ${now - 2 * 3_600_000});\n`;
  });
});
for (const [i, comment] of design.comments.entries()) {
  designSql += `INSERT INTO design_comments (id, design_id, screen_id, selector, element_text, body, created_at) VALUES (${q(`dcm_seed${i}`)}, ${q(designId)}, ${q(comment.screen)}, ${q(comment.selector)}, ${q(comment.text)}, ${q(comment.body)}, ${now - 3_600_000});\n`;
}
sql(studioDb, designSql);
out.design = designId;

// ---- The recording: a finished meeting with its transcript and notes -----
const recId = "rec_seedkitchen01";
const segMs = 42_000;
const startAt = now - 27 * 3_600_000;
let recSql = `INSERT INTO recordings (id, title, title_source, title_chars, kind, status, project_id, thread_id, created_at, updated_at, ended_at, heartbeat_at, meeting_notes) VALUES (${q(recId)}, ${q(recording.title)}, 'user', 0, 'recording', 'done', NULL, NULL, ${startAt}, ${startAt + recording.lines.length * segMs}, ${startAt + recording.lines.length * segMs}, ${startAt + recording.lines.length * segMs}, ${q(JSON.stringify({ summary: recording.summary }))});\n`;
recording.lines.forEach((line, i) => {
  recSql += `INSERT INTO segments (recording_id, id, session_id, idx, started_at, duration_ms, mime_type, bytes, file, status, text, created_at, speaker) VALUES (${q(recId)}, ${q(`seed-${i}`)}, 'seed', ${i}, ${startAt + i * segMs}, ${segMs}, 'audio/wav', 0, '', 'done', ${q(line)}, ${startAt + i * segMs}, NULL);\n`;
});
sql(studioDb, recSql);
out.recording = recId;
// A finished dictation, kept as a dictation (it has its own page).
const dicId = "rec_seeddictation1";
const dicAt = now - 3 * 3_600_000;
let dicSql = `INSERT INTO recordings (id, title, title_source, title_chars, kind, status, project_id, thread_id, created_at, updated_at, ended_at, heartbeat_at) VALUES (${q(dicId)}, ${q(dictation.title)}, 'user', 0, 'dictation', 'done', NULL, NULL, ${dicAt}, ${dicAt + 50_000}, ${dicAt + 50_000}, ${dicAt + 50_000});\n`;
dictation.lines.forEach((line, i) => {
  dicSql += `INSERT INTO segments (recording_id, id, session_id, idx, started_at, duration_ms, mime_type, bytes, file, status, text, created_at, speaker) VALUES (${q(dicId)}, ${q(`seed-${i}`)}, 'seed', ${i}, ${dicAt + i * 25_000}, 25000, 'audio/wav', 0, '', 'done', ${q(line)}, ${dicAt + i * 25_000}, NULL);\n`;
});
sql(studioDb, dicSql);
out.dictation = dicId;

// ---- The launch page, its whiteboard and its embeds -----------------------
const pageLine = bb("studio", "pages", "create", launchPage.title, "--global", "--markdown", launchPage.body({ mini: out.mini, recording: recId, artifact: out.artifacts["search-latency.html"], dashboard: dash.id }));
const pageId = /pg_[a-f0-9]+/.exec(pageLine)?.[0] ?? bb("studio", "pages", "list").split("\n").find((l) => l.includes(launchPage.title)).split("\t")[0];
const wbLine = bb("studio", "whiteboards", "create", "--page", pageId, flow.name);
const wbId = /drw_[a-f0-9]+/.exec(wbLine)?.[0] ?? bb("studio", "whiteboards", "list").split("\n").find((l) => l.includes(flow.name)).split("\t")[0];
const scene = join(tmp, "scene.json");
writeFileSync(scene, JSON.stringify(flow.elements));
bb("studio", "whiteboards", "merge", wbId, scene);
out.page = pageId;
out.whiteboard = wbId;
// The recording's notes page.
const notesLine = bb("studio", "pages", "create", `Notes: ${recording.title}`, "--global", "--markdown", recording.notes);
const notesId = /pg_[a-f0-9]+/.exec(notesLine)?.[0] ?? bb("studio", "pages", "list").split("\n").find((l) => l.includes(`Notes: ${recording.title}`)).split("\t")[0];
sql(studioDb, `UPDATE recordings SET notes_page_id = ${q(notesId)} WHERE id = ${q(recId)};`);
out.notes = notesId;

writeFileSync(join(SCRATCH, "features.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
// Studio's search and Library read its item index.
bb("studio", "reindex");
