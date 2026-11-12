import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { bundle, pageHtml, withPage } from "./presence-harness.mjs";

const codeFile = process.argv[2] ?? null;
const hits = [];
const server = createServer((request, response) => {
  hits.push(request.url);
  response.writeHead(200, { "content-type": "text/javascript", "access-control-allow-origin": "*" });
  response.end("");
});
server.on("upgrade", (request, socket) => { hits.push(`upgrade ${request.url}`); socket.destroy(); });
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const leak = `http://127.0.0.1:${server.address().port}`;
const script = await bundle("src/presence/harness/sandbox.ts", { LEAK_URL: JSON.stringify(leak), CHECK_CODE: JSON.stringify(codeFile ? readFileSync(codeFile, "utf8") : "") });
let result;
try {
  result = await withPage({ html: pageHtml(script), width: 400, height: 300, scale: 1 }, async ({ waitFor, logs }) => {
    const done = await waitFor("window.__done", 90000);
    return { ...done, logs };
  });
} finally {
  server.close();
}
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };
expect(result.good.every((line) => line.pass), `template checks: ${JSON.stringify(result.good.filter((line) => !line.pass))}`);
expect(JSON.stringify(hits) === JSON.stringify(["/control"]), `network hits: ${JSON.stringify(hits)}`);
const probe = result.outcomes.find((each) => each.name === "probe");
expect(probe.detail && typeof probe.detail === "object" && probe.detail.count >= 30, `probe did not report: ${probe.failure}`);
expect(Array.isArray(probe.detail?.odd) && probe.detail.odd.length === 0, `probe reached: ${JSON.stringify(probe.detail?.odd)}`);
for (const outcome of result.outcomes.filter((each) => each.name !== "probe")) expect(typeof outcome.failure === "string" && outcome.failure.length > 0, `${outcome.name}: not stopped`);
expect(result.outcomes.every((each) => each.ms < 4500), `slow stop: ${JSON.stringify(result.outcomes.map((each) => [each.name, each.ms]))}`);
expect(result.sandboxAttr === "allow-scripts", `sandbox attribute: ${result.sandboxAttr}`);
expect(result.cross.startsWith("threw"), `parent could read the frame: ${result.cross}`);
expect(typeof result.stalled === "string", "a stalled module passed measurement");
if (result.checked) expect(result.checked.every((line) => line.pass), `${codeFile}: ${JSON.stringify(result.checked.filter((line) => !line.pass))}`);
console.log(JSON.stringify({ hits, ...result }, null, 2));
if (failures.length) { console.error(`FAILED\n${failures.join("\n")}`); process.exit(1); }
console.log("sandbox holds");
