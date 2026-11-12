import { collectMeasurement, measurePresence, tickFor } from "../measure";
import { PresenceSandbox } from "../sandbox";
import { PRESENCE_TEMPLATE_CODE } from "../template";

declare const LEAK_URL: string;
declare const CHECK_CODE: string;

interface Outcome { name: string; failure: string | null; ms: number; detail?: unknown }

function run(name: string, code: string, frames = 3): Promise<Outcome> {
  return new Promise((resolve) => {
    const started = performance.now();
    let drawn = 0;
    const finish = (failure: string | null) => { sandbox.dispose(); resolve({ name, failure, ms: Math.round(performance.now() - started) }); };
    const next = () => { if (!sandbox.tick(tickFor("idle", 36, 3 + drawn, false))) finish("tick refused"); };
    const sandbox: PresenceSandbox = new PresenceSandbox({
      code, document,
      onFail: (reason) => finish(reason),
      onReady: next,
      onFrame: () => { drawn++; if (drawn >= frames) setTimeout(() => finish(null), 400); else setTimeout(next, 150); },
    });
    document.body.append(sandbox.frame);
  });
}

const PROBE = `
var report = {};
var seen = 0;
function attempt(name, run) { try { report[name] = String(run()); } catch (error) { report[name] = "threw " + error.name; } }
function draw(ctx, t, state, palette, size) {
  seen++;
  if (seen === 1) {
    attempt("typeof fetch", function () { return typeof fetch; });
    attempt("typeof XMLHttpRequest", function () { return typeof XMLHttpRequest; });
    attempt("typeof WebSocket", function () { return typeof WebSocket; });
    attempt("typeof EventSource", function () { return typeof EventSource; });
    attempt("typeof importScripts", function () { return typeof importScripts; });
    attempt("typeof Worker", function () { return typeof Worker; });
    attempt("typeof navigator", function () { return typeof navigator; });
    attempt("typeof postMessage", function () { return typeof postMessage; });
    attempt("typeof setTimeout", function () { return typeof setTimeout; });
    attempt("typeof setInterval", function () { return typeof setInterval; });
    attempt("typeof document", function () { return typeof document; });
    attempt("typeof window", function () { return typeof window; });
    attempt("typeof parent", function () { return typeof parent; });
    attempt("typeof location", function () { return typeof location; });
    attempt("typeof indexedDB", function () { return typeof indexedDB; });
    attempt("typeof caches", function () { return typeof caches; });
    attempt("typeof BroadcastChannel", function () { return typeof BroadcastChannel; });
    attempt("typeof URL", function () { return typeof URL; });
    attempt("typeof Blob", function () { return typeof Blob; });
    attempt("typeof Request", function () { return typeof Request; });
    attempt("eval", function () { return eval("1 + 1"); });
    attempt("Function", function () { return (function () {}).constructor("return typeof fetch")(); });
    attempt("global fetch", function () { return typeof ctx.canvas.constructor.constructor("return this")().fetch; });
    attempt("leak fetch", function () { return fetch("${"${LEAK}"}/fetch"); });
    attempt("leak xhr", function () { var x = new XMLHttpRequest(); x.open("GET", "${"${LEAK}"}/xhr"); x.send(); return "sent"; });
    attempt("leak importScripts", function () { importScripts("${"${LEAK}"}/import-scripts"); return "loaded"; });
    attempt("leak websocket", function () { new WebSocket("${"${LEAK}"}/ws".replace("http", "ws")); return "opened"; });
    attempt("leak eventsource", function () { new EventSource("${"${LEAK}"}/sse"); return "opened"; });
    attempt("leak beacon", function () { return navigator.sendBeacon("${"${LEAK}"}/beacon"); });
    attempt("leak worker", function () { new Worker("${"${LEAK}"}/worker.js"); return "started"; });
    attempt("parent", function () { return parent.location.href; });
    attempt("top document", function () { return top.document.cookie; });
    attempt("post", function () { postMessage({ type: "ready" }); return "posted"; });
    report["dynamic import"] = "pending";
    try { import("${"${LEAK}"}/dynamic-import.js").then(function () { report["dynamic import"] = "loaded"; }, function (error) { report["dynamic import"] = "rejected " + error.name; }); } catch (error) { report["dynamic import"] = "threw " + error.name; }
  }
  ctx.fillStyle = palette[0];
  ctx.fillRect(4, 4, size - 8, size - 8);
  if (seen === 3) {
    var odd = [], count = 0;
    for (var key in report) {
      count++;
      var fine = key.indexOf("typeof ") === 0 ? report[key] === "undefined" : report[key].indexOf("threw ") === 0 || report[key].indexOf("rejected ") === 0;
      if (!fine) odd.push(key + "=" + report[key].slice(0, 30));
    }
    throw new Error(JSON.stringify({ count: count, odd: odd }));
  }
}
`;

async function main() {
  const leak = LEAK_URL;
  const outcomes: Outcome[] = [];
  await fetch(`${leak}/control`, { mode: "no-cors" }).catch(() => {});
  const good = await measurePresence(PRESENCE_TEMPLATE_CODE, document);
  const probe = await run("probe", PROBE.split("${LEAK}").join(leak), 3);
  let probed: unknown = null;
  try { probed = JSON.parse(probe.failure ?? "null"); } catch { probed = probe.failure; }
  outcomes.push({ ...probe, detail: probed });
  outcomes.push(await run("draw loops forever", "function draw() { for (;;) {} }"));
  outcomes.push(await run("module loops forever", "for (;;) {}\nfunction draw() {}"));
  outcomes.push(await run("draw throws", "function draw() { throw new Error('boom'); }"));
  outcomes.push(await run("syntax error", "function draw( {"));
  outcomes.push(await run("no draw", "var x = 1;"));
  outcomes.push(await run("escapes the wrapper", "})(); self.__presenceStart = null; (() => {\nfunction draw() {}"));
  outcomes.push(await run("allocates without end", "var hoard = [];\nfunction draw() { for (;;) hoard.push(new Float64Array(1e6)); }"));
  const frame = document.createElement("div");
  const live = new PresenceSandbox({ code: PRESENCE_TEMPLATE_CODE, document, onFail: () => {} });
  frame.append(live.frame);
  document.body.append(frame);
  await new Promise((done) => setTimeout(done, 300));
  let reach = "";
  try { reach = String(live.frame.contentDocument === null ? "contentDocument null" : "contentDocument readable"); } catch (error) { reach = `threw ${(error as Error).name}`; }
  let cross = "";
  try { cross = String((live.frame.contentWindow as Window).document.body.innerHTML.length); } catch (error) { cross = `threw ${(error as Error).name}`; }
  const sandboxAttr = live.frame.getAttribute("sandbox");
  live.dispose();
  const checked = CHECK_CODE ? await measurePresence(CHECK_CODE, document) : null;
  const stalled = await collectMeasurement("function draw() { for (;;) {} }", document);
  (window as unknown as { __done: unknown }).__done = { good, outcomes, reach, cross, sandboxAttr, checked, stalled: stalled.failure };
}

void main();
