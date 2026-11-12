// The fictional Studio items for the site's feature screenshots. Every name,
// number, file and line here is made up. Nothing comes from a real install.

// ---- The launch page --------------------------------------------------------
export const launchPage = {
  title: "orbit-web 2.4: launch plan",
  body: ({ mini, recording, artifact, dashboard }) => [
    "> [!TIP] 2.4 ships Thursday. Offline sync is the headline; search on large workspaces is the second story.",
    "",
    "```stats",
    JSON.stringify([
      { label: "Weekly active teams", value: "1,284", delta: "+6%", trend: "up", caption: "vs last week" },
      { label: "Beta teams on 2.4", value: "212", delta: "+38", trend: "up", caption: "since Monday" },
      { label: "Sync conflicts", value: "0.4%", delta: "-1.1 pts", trend: "down", caption: "of sessions" },
      { label: "p95 search", value: "180 ms", delta: "-62%", trend: "down", caption: "50k-note workspaces" },
    ]),
    "```",
    "",
    "## Beta adoption",
    "",
    "```chart",
    JSON.stringify({ type: "area", title: "Teams on the 2.4 beta, by day", x: "day", series: ["Teams"], data: [
      { day: "Oct 30", Teams: 18 }, { day: "Nov 2", Teams: 41 }, { day: "Nov 4", Teams: 77 }, { day: "Nov 6", Teams: 119 },
      { day: "Nov 8", Teams: 151 }, { day: "Nov 10", Teams: 188 }, { day: "Nov 12", Teams: 212 },
    ] }),
    "```",
    "",
    "## Checklist",
    "",
    "- [x] Release notes drafted",
    "- [x] Team note drafted",
    "- [x] Docs links fixed",
    "- [ ] Settings form refactor merged",
    "- [ ] Changelog reviewed by Wednesday noon",
    "- [ ] Announcement scheduled for Thursday 10:00",
    "",
    "## Rollout",
    "",
    "The whiteboard below is the rollout plan. The beta feedback tracker is live; votes come in from the beta channel.",
    "",
    "```embed",
    JSON.stringify({ kind: "mini", target: mini }),
    "```",
    "",
    "## Search latency",
    "",
    "```embed",
    JSON.stringify({ kind: "artifact", target: artifact, title: "Search latency report" }),
    "```",
    "",
    "Live numbers are on the [orbit-web health](/plugins/studio/studio/dashboards/" + dashboard + ") dashboard.",
  ].join("\n"),
};

// ---- The rollout whiteboard (Excalidraw elements) ---------------------------
const base = { angle: 0, strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false };
const box = (id, x, y, w, h, bg, label) => [
  { ...base, id, type: "rectangle", x, y, width: w, height: h, strokeColor: "#1e1e1e", backgroundColor: bg, fillStyle: "solid", roundness: { type: 3 }, seed: x + y },
  { ...base, id: `${id}-t`, type: "text", x: x + 14, y: y + h / 2 - 13, width: w - 28, height: 26, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", roundness: null, text: label, originalText: label, fontSize: 20, fontFamily: 1, textAlign: "center", verticalAlign: "middle", containerId: null, lineHeight: 1.25, autoResize: true, baseline: 18 },
];
const arrow = (id, x, y, w, h) => ({ ...base, id, type: "arrow", x, y, width: w, height: h, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", roundness: { type: 2 }, points: [[0, 0], [w, h]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false });
const note = (id, x, y, text) => ({ ...base, id, type: "text", x, y, width: 260, height: 50, strokeColor: "#6741d9", backgroundColor: "transparent", fillStyle: "solid", roundness: null, text, originalText: text, fontSize: 16, fontFamily: 1, textAlign: "left", verticalAlign: "top", containerId: null, lineHeight: 1.25, autoResize: true, baseline: 14 });
export const flow = {
  name: "2.4 rollout",
  elements: [
    ...box("b1", 40, 60, 200, 80, "#ffec99", "Beta: 212 teams"),
    arrow("a1", 250, 100, 90, 0),
    ...box("b2", 350, 60, 200, 80, "#b2f2bb", "10% of teams"),
    arrow("a2", 560, 100, 90, 0),
    ...box("b3", 660, 60, 200, 80, "#a5d8ff", "Everyone, Thu"),
    ...box("b4", 350, 220, 200, 80, "#ffc9c9", "Roll back"),
    arrow("a3", 450, 150, 0, 60),
    note("n1", 40, 170, "Watch sync conflicts\nand p95 search"),
    note("n2", 600, 200, "Announce at 10:00\nafter the team note"),
  ],
};

// ---- The design ---------------------------------------------------------------
const css = `*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2330;background:#f6f7fb}
.wrap{max-width:880px;margin:0 auto;padding:40px 32px}h1{font-size:26px;margin:0 0 4px}p.sub{color:#5b6275;margin:0 0 28px}
.card{background:#fff;border:1px solid #e3e6ee;border-radius:14px;padding:20px 22px;margin-bottom:16px}
.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid #eef0f5}.row:first-of-type{border-top:0}
.row b{display:block;font-weight:600}.row span{color:#5b6275;font-size:13px}
.toggle{width:44px;height:26px;border-radius:13px;background:#4f46e5;position:relative;flex:none}.toggle:after{content:"";position:absolute;right:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff}
.toggle.off{background:#cfd3de}.toggle.off:after{right:auto;left:3px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:4px 10px;border-radius:999px;background:#e8f7ee;color:#18794e}
.bar{height:8px;border-radius:4px;background:#eef0f5;overflow:hidden}.bar i{display:block;height:100%;background:#4f46e5;border-radius:4px}
button{font:inherit;border:0;border-radius:10px;padding:10px 16px;background:#4f46e5;color:#fff;font-weight:600}button.ghost{background:#eef0f5;color:#1f2330}`;
const page = (body) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
export const design = {
  name: "Offline sync settings",
  rounds: [{
    title: "Round 1",
    intro: "Settings for offline sync in 2.4: a desktop panel, the phone's status sheet, and the conflict prompt.",
    screens: [
      { title: "Settings: Offline sync", caption: "One switch per kind of content, with what is stored on this device.", viewport: "desktop", html: page(`<div class="wrap"><h1>Offline sync</h1><p class="sub">Keep notes on this device and sync them when you are back online.</p>
<div class="card"><div class="row"><div><b>Sync notes offline</b><span>All notes in your workspaces</span></div><div class="toggle"></div></div>
<div class="row"><div><b>Include attachments</b><span>Images and files up to 25 MB each</span></div><div class="toggle off"></div></div>
<div class="row"><div><b>Sync on cellular</b><span>Phones and tablets only</span></div><div class="toggle"></div></div></div>
<div class="card"><div class="row"><div><b>Stored on this device</b><span>1.2 GB of 4 GB</span></div><span class="pill">● Up to date</span></div><div class="bar"><i style="width:30%"></i></div></div>
<div style="display:flex;gap:10px;justify-content:flex-end"><button class="ghost">Clear offline copy</button><button>Sync now</button></div></div>`) },
      { title: "Phone: sync status", caption: "The sheet the sync chip opens.", viewport: "mobile", html: page(`<div class="wrap" style="padding:28px 20px"><h1 style="font-size:22px">Sync</h1><p class="sub">Last synced 2 minutes ago</p>
<div class="card"><div class="row"><div><b>Notes</b><span>3,412 on this phone</span></div><span class="pill">● Synced</span></div>
<div class="row"><div><b>Waiting to upload</b><span>2 edits made offline</span></div><span style="color:#b45309;font-size:13px">Queued</span></div>
<div class="row"><div><b>Attachments</b><span>Off on this phone</span></div><div class="toggle off"></div></div></div>
<button style="width:100%">Sync now</button></div>`) },
      { title: "Conflict prompt", caption: "When the same note changed in two places.", viewport: "desktop", html: page(`<div class="wrap"><h1>This note changed in two places</h1><p class="sub">“Q4 planning” was edited on this laptop and on your phone while offline.</p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div class="card"><b>This laptop</b><p style="color:#5b6275;font-size:13px;margin:4px 0 12px">Today, 9:12 AM</p><p>Ship offline sync first, then search.</p></div>
<div class="card"><b>Phone</b><p style="color:#5b6275;font-size:13px;margin:4px 0 12px">Today, 9:20 AM</p><p>Ship offline sync first, then search and the new editor toolbar.</p></div></div>
<div style="display:flex;gap:10px;justify-content:flex-end"><button class="ghost">Keep both</button><button class="ghost">Keep laptop</button><button>Keep phone</button></div></div>`) },
    ],
  }],
  comments: [{ screen: "r1s1", selector: ".card:nth-of-type(2) .pill", text: "● Up to date", body: "Show the time of the last sync here too." }],
};

// ---- The dashboard -------------------------------------------------------------
export const dashboardWidgets = [
  { type: "stat", title: "Weekly active teams", x: 0, y: 0, w: 3, h: 4, source: { kind: "static", data: { value: 1284, delta: "+6%", trend: "up", series: [1050, 1102, 1131, 1170, 1199, 1212, 1284] } } },
  { type: "stat", title: "Sync conflicts", x: 3, y: 0, w: 3, h: 4, options: { unit: "%", decimals: 1, invert: true }, source: { kind: "static", data: { value: 0.4, delta: "-1.1 pts", trend: "down", series: [1.9, 1.6, 1.4, 1.1, 0.8, 0.6, 0.4] } } },
  { type: "stat", title: "p95 search", x: 6, y: 0, w: 3, h: 4, options: { unit: " ms", invert: true }, source: { kind: "static", data: { value: 180, delta: "-62%", trend: "down", series: [480, 470, 455, 300, 240, 200, 180] } } },
  { type: "progress", title: "2.4 checklist", x: 9, y: 0, w: 3, h: 4, options: { style: "gauge" }, source: { kind: "static", data: { value: 3, max: 6, label: "3 of 6 done" } } },
  { type: "line", title: "Errors per 1k sessions", x: 0, y: 4, w: 6, h: 8, options: { x: "day", series: ["2.3", "2.4 beta"] }, source: { kind: "static", data: [
    { day: "Mon", "2.3": 4.1, "2.4 beta": 3.2 }, { day: "Tue", "2.3": 4.4, "2.4 beta": 2.9 }, { day: "Wed", "2.3": 3.9, "2.4 beta": 2.1 },
    { day: "Thu", "2.3": 4.2, "2.4 beta": 1.8 }, { day: "Fri", "2.3": 4.0, "2.4 beta": 1.6 }, { day: "Sat", "2.3": 3.7, "2.4 beta": 1.2 }, { day: "Sun", "2.3": 3.8, "2.4 beta": 1.1 },
  ] } },
  { type: "bar", title: "Beta teams by plan", x: 6, y: 4, w: 6, h: 8, options: { x: "plan", series: ["Teams"] }, source: { kind: "static", data: [
    { plan: "Free", Teams: 64 }, { plan: "Team", Teams: 101 }, { plan: "Business", Teams: 39 }, { plan: "Enterprise", Teams: 8 },
  ] } },
  { type: "table", title: "Open beta issues", x: 0, y: 12, w: 8, h: 7, source: { kind: "static", data: { columns: ["Issue", "Area", "Teams", "Owner"], rows: [
    ["Attachments re-download after sync", "Sync", 7, "Scout"], ["Search misses notes edited offline", "Search", 4, "Atlas"],
    ["Conflict prompt on unchanged note", "Sync", 3, "Atlas"], ["Toolbar overlaps on small windows", "Editor", 2, "Juniper"],
  ] } } },
  { type: "note", title: "This week", x: 8, y: 12, w: 4, h: 7, options: { markdown: "**Thursday:** 2.4 to everyone at 10:00.\n\n**Wednesday noon:** changelog review.\n\nRoll back if sync conflicts pass **1%**." } },
];

// ---- The mini app ------------------------------------------------------------
export const mini = {
  name: "Beta feedback",
  collection: "items",
  files: {
    "mini.json": JSON.stringify({ entry: "main.jsx", description: "Beta feedback with votes.", collections: { items: { indexes: ["votes", "area"] } }, size: { minHeight: 300, maxHeight: 520 } }),
    "main.jsx": `import { Badge, Button, Input, useRecords, useCollection } from "@studio/kit";
import { useState } from "react";
export default function App() {
  const { records } = useRecords("items", { order: "-votes" });
  const items = useCollection("items");
  const [text, setText] = useState("");
  const add = () => { if (text.trim()) { items.insert({ title: text.trim(), area: "Other", votes: 1, status: "new" }); setText(""); } };
  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex items-center justify-between"><div className="font-medium">Beta feedback</div><div className="text-muted-foreground">{records.length} items</div></div>
      <div className="flex flex-col gap-1.5">
        {records.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2">
            <Button size="sm" variant="outline" onClick={() => items.patch(r.id, { votes: r.data.votes + 1 })}>▲ {r.data.votes}</Button>
            <div className="flex-1">{r.data.title}</div>
            <Badge tone="outline">{r.data.area}</Badge>
            <Badge tone={r.data.status === "fixed" ? "success" : r.data.status === "planned" ? "warning" : "muted"}>{r.data.status}</Badge>
          </div>
        ))}
      </div>
      <div className="flex gap-2"><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add feedback" /><Button onClick={add}>Add</Button></div>
    </div>
  );
}
`,
  },
  records: [
    { title: "Show when the last sync happened", area: "Sync", votes: 24, status: "planned" },
    { title: "Search should find notes edited offline", area: "Search", votes: 19, status: "fixed" },
    { title: "Attachments re-download after every sync", area: "Sync", votes: 12, status: "planned" },
    { title: "Keyboard shortcut for Sync now", area: "Editor", votes: 7, status: "new" },
    { title: "Offline badge on shared notes", area: "Sync", votes: 4, status: "new" },
  ],
};

// ---- Artifacts -------------------------------------------------------------------
const bars = [["Small", 40, 38], ["Medium", 120, 64], ["Large", 310, 120], ["50k notes", 480, 180]];
export const artifacts = [
  {
    file: "search-latency.html", title: "Search latency report", description: "p95 search time by workspace size, 2.3 against 2.4.",
    body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font:14px -apple-system,sans-serif;color:#1f2330;background:transparent}@media (prefers-color-scheme:dark){body{color:#e8e9f0}}h2{margin:0 0 4px;font-size:18px}p{margin:0 0 18px;opacity:.7}
.r{display:grid;grid-template-columns:90px 1fr;gap:10px;align-items:center;margin:10px 0}.b{height:14px;border-radius:7px}.o{background:#a0a7ba}.n{background:#6d5dfc;margin-top:4px}small{opacity:.7}</style></head><body>
<h2>p95 search, by workspace size</h2><p>Grey: 2.3. Purple: 2.4 beta. Lower is better.</p>
${bars.map(([label, a, b]) => `<div class="r"><div>${label}</div><div><div class="b o" style="width:${a / 5}%"></div><div class="b n" style="width:${b / 5}%"></div><small>${a} ms → ${b} ms</small></div></div>`).join("")}
</body></html>`,
  },
  {
    file: "release-timeline.svg", title: "2.4 release timeline", description: "From beta to general release.",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="200" viewBox="0 0 720 200" font-family="-apple-system,sans-serif"><rect width="720" height="200" rx="16" fill="#14112b"/>
<line x1="60" y1="100" x2="660" y2="100" stroke="#6d5dfc" stroke-width="4"/>
${[["Oct 30", "Beta opens", 60], ["Nov 6", "Search fix", 260], ["Nov 12", "Docs links", 460], ["Nov 14", "2.4 for everyone", 660]].map(([d, t, x]) => `<circle cx="${x}" cy="100" r="10" fill="#ff7ee0"/><text x="${x}" y="70" fill="#fff" font-size="15" text-anchor="middle">${t}</text><text x="${x}" y="135" fill="#c7bedc" font-size="13" text-anchor="middle">${d}</text>`).join("")}
</svg>`,
  },
  {
    file: "changelog-2.4.md", title: "Changelog 2.4", description: "The changelog for review.",
    body: "# orbit-web 2.4\n\n## New\n- Offline sync for notes, with a conflict prompt when a note changed in two places.\n- Faster search on large workspaces: p95 is 180 ms on 50k notes.\n\n## Fixed\n- Three broken links in the docs.\n- The settings form keeps its scroll position.\n",
  },
];

// ---- The recording ----------------------------------------------------------------
export const recording = {
  title: "Kitchen walkthrough with the contractor",
  summary: "Walked the kitchen with the contractor. Quartz is the pick for the counters; the choice between two slabs is open. Cabinets stay; the doors get refinished. Electrical needs two new circuits. Demolition can start on the 2nd if the countertop is chosen by Friday.",
  lines: [
    "Okay, so this wall stays, and the sink stays where it is.",
    "Right. Moving the sink would mean new plumbing under the floor, and that's another two weeks.",
    "Fine. What about the counters? We were leaning toward quartz.",
    "Quartz is a good call for a kitchen you cook in. I'd look at the two slabs from the yard, the white with the grey vein and the warmer one.",
    "What's the difference in price?",
    "About four hundred dollars for this size. The warmer one is the cheaper of the two.",
    "And the cabinets?",
    "The boxes are solid. I'd keep them and refinish the doors. That saves you most of the cabinet budget.",
    "Good. Electrical?",
    "You need two new circuits for the induction range and the dishwasher. The panel has room.",
    "When could you start?",
    "Demolition on the 2nd, if the countertop is picked by Friday. The fabricator needs a week.",
  ],
  notes: [
    "## Decisions",
    "",
    "- Quartz counters.",
    "- Keep the cabinet boxes; refinish the doors.",
    "- The sink stays where it is.",
    "",
    "## To do",
    "",
    "- [ ] Pick a countertop slab by Friday",
    "- [ ] Confirm the start date of the 2nd",
    "- [ ] Ask for the electrical quote in writing",
    "",
    "## Numbers",
    "",
    "| Item | Note |",
    "|---|---|",
    "| Countertop | the warmer slab is about $400 less |",
    "| Electrical | two new circuits |",
    "| Fabrication | one week after the slab is picked |",
  ].join("\n"),
};

// ---- The Visual Chat board ------------------------------------------------------------
export const board = {
  prompt: "Lisbon in March: what's the weather like, what will four days cost, and what should each day be?",
  title: "Lisbon in March",
  caption: "Mild and a little rainy. About €1,150 for two for four days without flights. Day plans are below.",
  page: `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--ink:#f1eff8;--muted:#b9b4cc;--line:rgba(255,255,255,.12);--card:rgba(20,16,40,.72);--accent:#ff8a3d}
body{margin:0;padding:36px;font:15px/1.5 Georgia,serif;color:var(--ink);background:transparent}
h1{font-size:40px;margin:0 0 6px;font-weight:600}p.lede{color:var(--muted);margin:0 0 28px;font-size:17px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.k{font:12px -apple-system,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.v{font-size:30px;margin-top:4px}
.two{display:grid;grid-template-columns:1.2fr 1fr;gap:16px}
.bars div{display:grid;grid-template-columns:110px 1fr 60px;gap:10px;align-items:center;margin:8px 0;font:14px -apple-system,sans-serif}
.bars i{display:block;height:12px;border-radius:6px;background:var(--accent)}
ol{margin:0;padding-left:20px}li{margin:8px 0}li b{font-family:-apple-system,sans-serif}
</style></head><body>
<h1 data-cv-id="title">Lisbon in March</h1><p class="lede" data-cv-id="lede">Mild days, cool evenings, a few rainy afternoons. Four days for two, without flights.</p>
<div class="grid" data-cv-id="stats"><div class="card"><div class="k">Highs</div><div class="v">18°C</div></div><div class="card"><div class="k">Lows</div><div class="v">10°C</div></div><div class="card"><div class="k">Rainy days</div><div class="v">8 of 31</div></div><div class="card"><div class="k">Four days</div><div class="v">€1,150</div></div></div>
<div class="two"><div class="card" data-cv-id="costs"><div class="k">Where the money goes</div><div class="bars">
<div><span>Hotel, 4 nights</span><i style="width:100%"></i><span>€560</span></div><div><span>Food</span><i style="width:57%"></i><span>€320</span></div>
<div><span>Sintra day</span><i style="width:21%"></i><span>€120</span></div><div><span>Transit</span><i style="width:11%"></i><span>€60</span></div><div><span>Museums</span><i style="width:16%"></i><span>€90</span></div></div></div>
<div class="card" data-cv-id="days"><div class="k">The four days</div><ol><li><b>Alfama.</b> The castle, the tram 28 loop, fado at night.</li><li><b>Belém.</b> The monastery, the tower, pastéis.</li><li><b>Sintra.</b> Pena Palace by train; back for dinner.</li><li><b>Baixa and LX Factory.</b> Shops, the river, an easy last day.</li></ol></div></div>
</body></html>`,
};

// ---- The code folder Studio Code opens ---------------------------------------------------
export const codeFolder = {
  "package.json": JSON.stringify({ name: "orbit-web", version: "2.4.0", private: true, scripts: { dev: "vite", test: "vitest" } }, null, 2) + "\n",
  "README.md": "# orbit-web\n\nNotes for teams, online and offline.\n",
  "src/sync/queue.ts": `// Edits made offline wait here until the device is back online.
export interface PendingEdit {
  noteId: string;
  revision: number;
  patch: string;
  madeAt: number;
}

export class SyncQueue {
  private edits: PendingEdit[] = [];

  add(edit: PendingEdit): void {
    // A newer edit to the same note replaces the older one.
    this.edits = this.edits.filter((e) => e.noteId !== edit.noteId || e.revision > edit.revision);
    this.edits.push(edit);
  }

  async flush(send: (edit: PendingEdit) => Promise<"ok" | "conflict">): Promise<string[]> {
    const conflicts: string[] = [];
    for (const edit of this.edits) {
      if ((await send(edit)) === "conflict") conflicts.push(edit.noteId);
    }
    this.edits = [];
    return conflicts;
  }

  get size(): number {
    return this.edits.length;
  }
}
`,
  "src/sync/conflict.ts": `export type Choice = "laptop" | "phone" | "both";

export function resolve(local: string, remote: string, choice: Choice): string[] {
  if (choice === "both") return [local, remote];
  return [choice === "laptop" ? local : remote];
}
`,
  "src/settings/SettingsForm.tsx": `import { Switch } from "@radix-ui/react-switch";

export function SettingsForm({ offline, onChange }: { offline: boolean; onChange: (on: boolean) => void }) {
  return (
    <form className="settings">
      <label>
        Sync notes offline
        <Switch checked={offline} onCheckedChange={onChange} />
      </label>
    </form>
  );
}
`,
};
