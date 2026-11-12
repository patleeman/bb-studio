// After the scratch server starts it settles threads that have no live agent:
// a running worker becomes failed and its pending approval interrupted. For
// the screenshots, put the demo's running worker and its approval back, and
// link the forked conversation to the message it came from.
//
//   node fixups.mjs <ids.json>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { threads } from "./demo-data.mjs";

const { ids, messageIds, lastSeq } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const data = process.env.SCRATCH ? join(process.env.SCRATCH, "data") : "/tmp/bbsite/data";
const sql = (db, text) => execFileSync("sqlite3", [db], { input: text, encoding: "utf8" });
const bbdb = join(data, "bb.db");
const studio = join(data, "plugins/studio/data.db");

// Drop anything the server or Studio added after the seeded events (an
// interrupted turn, a resume or a report that could not start), and put each
// thread's status and approval back.
let out = "DELETE FROM queued_thread_messages;\n";
for (const spec of threads) {
  const id = ids[spec.key];
  out += `DELETE FROM events WHERE thread_id = '${id}' AND sequence > ${lastSeq[spec.key]};\n`;
  out += `UPDATE threads SET status = '${spec.status ?? "idle"}' WHERE id = '${id}';\n`;
  if (spec.approval) {
    out += `UPDATE pending_interactions SET status = 'pending', resolution = NULL, status_reason = NULL, resolved_at = NULL WHERE thread_id = '${id}';\n`;
  }
}
sql(bbdb, out);

// Put each thread with its own Bot, as a conversation or a worker.
const botIds = Object.fromEntries(sql(studio, "SELECT name, id FROM bots;").trim().split("\n").map((line) => line.split("|")));
const nameOf = { atlas: "Atlas", juniper: "Juniper", scout: "Scout" };
let studioSql = "";
for (const spec of threads) {
  const botId = botIds[nameOf[spec.bot]];
  if (spec.main) continue;
  if (spec.workerOf) studioSql += `UPDATE bot_threads SET bot_id = '${botId}', kind = 'worker', owner_conversation_id = '${ids[spec.workerOf]}' WHERE thread_id = '${ids[spec.key]}';\n`;
  else studioSql += `UPDATE bot_threads SET bot_id = '${botId}', kind = 'conversation', owner_conversation_id = NULL WHERE thread_id = '${ids[spec.key]}';\n`;
}
for (const spec of threads.filter((t) => t.forkOf)) {
  // The timeline's id for the source's first reply, which the replies row is keyed on.
  const source = ids[spec.forkOf];
  const message = `${source}:assistant:kind:assistant|turn:turn_${spec.forkOf}_0|parent:root|item:${messageIds[spec.forkOf][0]}`;
  const replies = spec.turns.length * 2;
  studioSql += `UPDATE bot_threads SET forked_from_thread_id = '${source}', forked_from_message_id = '${message}' WHERE thread_id = '${ids[spec.key]}';\n`;
  studioSql += `UPDATE bot_side_threads SET message_id = '${message}', replies = ${replies}, last_reply_role = 'assistant' WHERE thread_id = '${ids[spec.key]}';\n`;
}
for (const spec of threads.filter((t) => t.status === "active")) {
  studioSql += `UPDATE live_activity SET state = 'running' WHERE thread_id = '${ids[spec.key]}';\n`;
}
sql(studio, studioSql);
console.log("fixups applied");
