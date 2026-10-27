#!/usr/bin/env python3
"""The three mini apps MiniCardUITests and MiniAppUITests expect, on a staged BB
(never your own): a task counter ("Add task", "Count <n>", "Fetch"), a "Long
list" taller than its card and a note ("Tap note", "Note taps: <n>"). Prints
their ids for TEST_RUNNER_BBGO_QA_MINI_IDS.

    . "$TMPDIR/bb-studio-staged/capture.env"
    python3 -I apps/ios/scripts/seed-staged-minis.py "$BB_SERVER_URL"
"""
import json, urllib.request, sys

if len(sys.argv) != 2: raise SystemExit("usage: seed-staged-minis.py <staged server url>")
server = sys.argv[1].rstrip("/")

def rpc(method, body):
    req = urllib.request.Request(f"{server}/api/v1/plugins/studio/rpc/{method}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    answer = json.load(urllib.request.urlopen(req))
    if not answer.get("ok"): raise SystemExit(f"{method}: {answer}")
    return answer["result"]
counter = """import * as React from "react";
import { Button, usePlaygroundState, useRecords } from "@studio/kit";
export default function App() {
  const [count, setCount] = usePlaygroundState(0);
  const { records, collection } = useRecords("tasks", { order: "createdAt" });
  const [message, setMessage] = React.useState("");
  const fetchIt = async () => {
    try { await window.playground.fetch("https://example.com"); setMessage("Fetched"); }
    catch (error) { setMessage(String((error && error.message) || error)); }
  };
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => collection.insert({ title: "Task " + (records.length + 1) })}>Add task</Button>
        <Button onClick={() => setCount((c) => (c || 0) + 1)}>{"Count " + (count || 0)}</Button>
        <Button onClick={fetchIt}>Fetch</Button>
      </div>
      {message ? <p>{message}</p> : null}
      {records.map((r) => <p key={r.id}>{String(r.data.title)}</p>)}
    </div>
  );
}
"""
longlist = """export default function App() {
  const rows = Array.from({ length: 40 }, (_, i) => "Row " + (i + 1));
  return <div className="flex flex-col gap-1 p-2">{rows.map((r) => <p key={r} className="py-2">{r}</p>)}</div>;
}
"""
note = """import { Button, usePlaygroundState } from "@studio/kit";
export default function App() {
  const [taps, setTaps] = usePlaygroundState(0);
  return (
    <div className="flex items-center gap-3 p-2">
      <Button onClick={() => setTaps((t) => (t || 0) + 1)}>Tap note</Button>
      <p>{"Note taps: " + (taps || 0)}</p>
    </div>
  );
}
"""
apps = [
    ("Task counter", {"mini.json": json.dumps({"entry": "main.jsx", "collections": {"tasks": {}}}), "main.jsx": counter}),
    ("Long list", {"mini.json": json.dumps({"entry": "main.jsx", "size": {"maxHeight": 320}}), "main.jsx": longlist}),
    ("Note", {"mini.json": json.dumps({"entry": "main.jsx"}), "main.jsx": note}),
]
ids = []
for name, files in apps:
    mini = rpc("minis.create", {"name": name})["mini"]
    rpc("minis.save", {"id": mini["id"], "files": files})
    ids.append(mini["id"])
print(",".join(ids))
