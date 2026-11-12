// Mini apps are built into Studio. A seeded "Deal pipeline" mini app (Kit
// components, Tailwind, a chart, records) as a Studio tab in dark mode, the
// same app embedded in a page in light mode sharing its records, and the
// access approval dialog for an app that asks to reach an API.
const FILES = {
  "mini.json": JSON.stringify({
    entry: "main.jsx",
    libs: ["charts@1", "icons@1"],
    description: "Open deals by stage, with a chart and a quick add form.",
    collections: { deals: { indexes: ["stage"] } },
    size: { minHeight: 420, maxHeight: 760 },
  }, null, 2),
  "main.jsx": `import { useState } from "react";
import { Badge, Button, Card, CardContent, DataTable, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger, usePlaygroundState, useRecords } from "@studio/kit";
import { Chart, Stats } from "@studio/kit/charts";
import { Rocket } from "lucide-react";
import { STAGES, money } from "./stages";

export default function App() {
  const { records, collection } = useRecords("deals", { order: "-amount" });
  const [tab, setTab] = usePlaygroundState("pipeline");
  const [draft, setDraft] = useState({ title: "", amount: "", stage: "lead" });
  const deals = records.map((record) => ({ id: record.id, ...record.data }));
  const total = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const won = deals.filter((deal) => deal.stage === "won").reduce((sum, deal) => sum + deal.amount, 0);
  const add = async (event) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    await collection.insert({ title: draft.title.trim(), amount: Number(draft.amount) || 0, stage: draft.stage });
    setDraft({ title: "", amount: "", stage: "lead" });
  };
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Rocket className="size-4 text-primary" />
        <h1 className="text-base font-semibold">Deal pipeline</h1>
        <Badge tone="secondary">{deals.length} deals</Badge>
      </header>
      <Stats items={[{ label: "Open pipeline", value: money(total), delta: "+18%", trend: "up" }, { label: "Won this quarter", value: money(won) }, { label: "Deals", value: deals.length }]} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="chart">By stage</TabsTrigger>
        </TabsList>
        <TabsContent value="pipeline">
          <DataTable rows={deals} columns={[
            { key: "title", header: "Deal" },
            { key: "stage", header: "Stage", cell: (deal) => <Badge tone={STAGES[deal.stage].tone}>{STAGES[deal.stage].label}</Badge> },
            { key: "amount", header: "Amount", cell: (deal) => money(deal.amount), className: "text-right tabular-nums" },
          ]} />
        </TabsContent>
        <TabsContent value="chart">
          <Chart type="bar" unit="$" data={Object.entries(STAGES).map(([stage, info]) => ({ label: info.label, Amount: deals.filter((deal) => deal.stage === stage).reduce((sum, deal) => sum + deal.amount, 0) }))} />
        </TabsContent>
      </Tabs>
      <Card>
        <CardContent className="pt-4">
          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <Field label="Deal" className="min-w-40 flex-1"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Company and product" /></Field>
            <Field label="Amount" className="w-28"><Input inputMode="numeric" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="0" /></Field>
            <Select value={draft.stage} onValueChange={(stage) => setDraft({ ...draft, stage })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(STAGES).map(([stage, info]) => <SelectItem key={stage} value={stage}>{info.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="submit">Add deal</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
`,
  "stages.ts": `export const STAGES: Record<string, { label: string; tone: "muted" | "secondary" | "warning" | "success" }> = {
  lead: { label: "Lead", tone: "muted" },
  demo: { label: "Demo", tone: "secondary" },
  proposal: { label: "Proposal", tone: "warning" },
  won: { label: "Won", tone: "success" },
};

export const money = (value: number) => "$" + value.toLocaleString("en-US");
`,
};

const DEALS = [
  ["Acme · annual renewal", 48000, "won"],
  ["Globex · analytics add-on", 22500, "proposal"],
  ["Initech · team plan", 12800, "demo"],
  ["Umbrella · pilot", 9600, "lead"],
  ["Hooli · enterprise seats", 31000, "proposal"],
];

const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

export default ({ pluginRpc, projectId, sleep }) => {
  /** A mini app with FILES and DEALS, removed (and its tab closed) by the returned cleanup. */
  async function seeded(files = FILES) {
    const { mini } = await pluginRpc("studio", "minis.create", { name: "Deal pipeline", projectId });
    const cleanup = async () => {
      await pluginRpc("studio", "closeTabs", { items: [{ pluginId: "minis", id: mini.id }] }).catch(() => {});
      await pluginRpc("studio", "provider.call", { pluginId: "minis", method: "studio_delete", input: { ids: [mini.id] } }).catch(() => {});
    };
    try {
      const { mini: saved } = await pluginRpc("studio", "minis.save", { id: mini.id, files, note: "Seeded" });
      for (const [title, amount, stage] of DEALS) await pluginRpc("studio", "minis.db.insert", { id: mini.id, clientId: "capture-seed", collection: "deals", data: { title, amount, stage } });
      return { mini: saved, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  /** Waits for the frame and checks what it drew, from inside it. */
  async function frameShows(client, selector, texts) {
    await client.waitForSelector(selector, 30000);
    const seen = await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute("src")`);
    if (!seen.includes("/api/v1/plugins/studio/http/minis/frame")) throw new Error(`The mini app frame doesn't load from Studio: ${seen}`);
    const sandbox = await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute("sandbox")`);
    if (sandbox.includes("allow-same-origin")) throw new Error(`The mini app frame isn't isolated: ${sandbox}`);
    await client.waitForFrameText(texts, 30000);
  }

  return [
    {
      id: "minis",
      packageDir: "bb-studio",
      fileName: "minis-preview.png",
      privateSidebar: true,
      setup: async (client) => {
        await scheme(client, "dark");
        const { mini, cleanup } = await seeded();
        const done = async () => { await cleanup(); await scheme(client, ""); await sleep(1500); };
        try {
          const path = `/plugins/studio/studio/minis/${mini.id}`;
          await client.navigate(path);
          await client.waitForSelector(`[data-studio-workspace-editor="${path}"] [data-mini-view="${mini.id}"]`, 30000);
          for (const text of ["App", "Data", "Source", "Settings"]) await client.waitForText(text);
          await frameShows(client, `[data-mini-view="${mini.id}"] iframe[data-mini-frame]`, ["Deal pipeline", "Open pipeline", "$123,900", "Acme · annual renewal", "Proposal", "Add deal"]);
          await sleep(1500);
        } catch (error) {
          await done();
          throw error;
        }
        return done;
      },
    },
    {
      id: "minis-page",
      packageDir: "bb-studio",
      fileName: "minis-page.png",
      privateSidebar: true,
      setup: async (client) => {
        await scheme(client, "light");
        const { mini, cleanup: removeMini } = await seeded();
        const { page } = await pluginRpc("studio", "pages.create", {
          projectId,
          parentId: null,
          title: "Q4 sales review",
          markdown: `Where the quarter stands. The pipeline below is live: add a deal and it shows up everywhere this app does.\n\n\`\`\`embed\n${JSON.stringify({ kind: "mini", target: mini.id })}\n\`\`\`\n\nNext review on Friday.\n`,
        });
        const cleanup = async () => {
          await pluginRpc("studio", "closeTabs", { items: [{ pluginId: "pages", id: page.id }] }).catch(() => {});
          await pluginRpc("studio", "provider.call", { pluginId: "pages", method: "studio_delete", input: { ids: [page.id] } }).catch(() => {});
          await removeMini();
        };
        const done = async () => { await cleanup(); await scheme(client, ""); await sleep(1500); };
        try {
          await client.navigate(`/plugins/studio/studio/pages/${page.id}`);
          await client.waitForText("Q4 sales review", 30000);
          await client.waitForText("Where the quarter stands.", 30000);
          await frameShows(client, `[data-mini-embed="${mini.id}"] iframe[data-mini-frame]`, ["Deal pipeline", "Open pipeline", "Hooli · enterprise seats"]);
          // The page block shares the app's records: one the agent adds shows here.
          await pluginRpc("studio", "minis.db.insert", { id: mini.id, clientId: "capture-agent", collection: "deals", data: { title: "Stark · renewal", amount: 15400, stage: "demo" } });
          await client.waitForFrameText(["Stark · renewal", "$139,300"], 30000);
          await sleep(1500);
        } catch (error) {
          await done();
          throw error;
        }
        return done;
      },
    },
    {
      id: "minis-approval",
      packageDir: "bb-studio",
      fileName: "minis-approval.png",
      privateSidebar: true,
      setup: async (client) => {
        await scheme(client, "dark");
        const manifest = { ...JSON.parse(FILES["mini.json"]), capabilities: ["fetch:api.hubspot.com", "secret:hubspot"] };
        const { mini, cleanup } = await seeded({ ...FILES, "mini.json": JSON.stringify(manifest, null, 2) });
        const done = async () => { await cleanup(); await scheme(client, ""); await sleep(1500); };
        try {
          const path = `/plugins/studio/studio/minis/${mini.id}`;
          await client.navigate(path);
          await client.waitForSelector(`[data-mini-view="${mini.id}"] [data-mini-approval]`, 30000);
          await client.waitForText("This mini app asks for access", 30000);
          // An approval needs the dialog's nonce: one made up is refused.
          const forged = await pluginRpc("studio", "minis.approve", { id: mini.id, nonce: "forged-nonce-0000000000", capabilities: manifest.capabilities }).then(() => "approved", (error) => String(error.message ?? error));
          if (!/expired/.test(forged)) throw new Error(`A forged approval wasn't refused: ${forged}`);
          await client.clickButtonText("Review");
          for (const text of ["Allow “Deal pipeline” to…", "Reach api.hubspot.com over the internet, through Studio", "Send the secret “hubspot” you store for it", "Not now", "Approve"]) await client.waitForText(text, 30000);
          await sleep(1500);
        } catch (error) {
          await done();
          throw error;
        }
        return done;
      },
    },
  ];
};
