import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { compile, CompileError } from "./server/compile";
import { frameCsp } from "./server/frame";
import { isPrivateAddress, proxyFetch } from "./server/net";
import { MINI_TABLES, RecordConflict } from "./server/store";
import { hostAllowed, resolveLibs } from "./shared";
import { memoryStore, miniHost } from "./test/host";

type Host = ReturnType<typeof miniHost>;
const call = (host: Host, method: string, input: unknown) => host.harness.behavior.callRpc(method, input) as Promise<any>;
const tool = (host: Host, name: string, input: unknown, ctx: Record<string, unknown> = {}) => host.harness.behavior.callAgentTool(name, input, ctx);
const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));
const CLIENT = "client-0001";

async function withHost<T>(work: (host: Host) => Promise<T>, options: Parameters<typeof miniHost>[0] = {}) {
  const host = miniHost(options);
  try {
    return await work(host);
  } finally {
    await host.harness.lifecycle.dispose();
  }
}

const APP = {
  "mini.json": JSON.stringify({ entry: "main.jsx", libs: ["charts@1"], collections: { tasks: { indexes: ["stage"] } } }),
  "main.jsx": `import { Button } from "@studio/kit";\nimport { Chart } from "@studio/kit/charts";\nimport { label } from "./lib/label";\nexport default function App() { return <div><Button>{label}</Button><Chart data={[{ x: "a", y: 1 }]} /></div>; }`,
  "lib/label.ts": `export const label: string = "Hi";`,
};

describe("compile", () => {
  it("turns JSX, TypeScript and imports into modules the frame can load", () => {
    const compiled = compile(APP);
    expect(Object.keys(compiled.modules).sort()).toEqual(["lib/label.ts", "main.jsx"]);
    expect(compiled.modules["main.jsx"]).toMatch(/require\(["']react\/jsx-runtime["']\)/);
    expect(compiled.modules["main.jsx"]).toMatch(/require\(["']@studio\/kit["']\)/);
    expect(compiled.modules["lib/label.ts"]).not.toContain(": string");
    expect(compiled.html).toBeNull();
  });

  it("refuses an import that isn't on the shelf, a lib the manifest doesn't list, and a missing file", () => {
    expect(() => compile({ "main.jsx": `import _ from "lodash";` })).toThrow(/isn't on the shelf/);
    expect(() => compile({ "main.jsx": `import { Chart } from "@studio/kit/charts";` })).toThrow(/add "charts@1" to "libs"/);
    expect(() => compile({ "main.jsx": `import x from "./nope";` })).toThrow(/isn't one of the files/);
  });

  it("checks the manifest, the entry and paths", () => {
    expect(() => compile({ "mini.json": "{", "main.jsx": "" })).toThrow(CompileError);
    expect(() => compile({ "mini.json": JSON.stringify({ libs: ["jquery@3"] }), "main.jsx": "" })).toThrow(/No shelf library/);
    expect(() => compile({ "mini.json": JSON.stringify({ entry: "app.jsx" }), "main.jsx": "" })).toThrow(/entry app.jsx/);
    expect(() => compile({ "../evil.jsx": "" })).toThrow(/Bad file path/);
    expect(() => compile({ "mini.json": JSON.stringify({ capabilities: ["fetch:localhost"] }), "main.jsx": "" })).toThrow(/mini.json/);
  });

  it("keeps an HTML entry's markup", () => {
    const compiled = compile({ "mini.json": JSON.stringify({ entry: "index.html" }), "index.html": "<p>Hi</p>" });
    expect(compiled.html).toBe("<p>Hi</p>");
  });
});

describe("shelf and capabilities", () => {
  it("loads React, Tailwind and Kit always, and a lib's needs before it", () => {
    expect(resolveLibs(["charts@1"]).map((lib) => lib.id)).toEqual(["react@19", "tailwind@4", "kit@1", "charts@1"]);
  });

  it("matches fetch hosts exactly or by a wildcard subdomain", () => {
    expect(hostAllowed("api.example.com", ["fetch:api.example.com"])).toBe(true);
    expect(hostAllowed("evil.com", ["fetch:api.example.com"])).toBe(false);
    expect(hostAllowed("a.example.com", ["fetch:*.example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["fetch:*.example.com"])).toBe(false);
    expect(hostAllowed("badexample.com", ["fetch:*.example.com"])).toBe(false);
  });

  it("blocks private and local addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) expect(isPrivateAddress(address), address).toBe(true);
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) expect(isPrivateAddress(address), address).toBe(false);
  });

  it("lets the frame reach no network, and images only from approved hosts", () => {
    const csp = frameCsp("http://127.0.0.1:4000", ["fetch:api.example.com", "bb.open"]);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("img-src http://127.0.0.1:4000 data: blob: https://api.example.com");
  });
});

describe("proxyFetch", () => {
  const resolve = async () => ["93.184.216.34"];
  it("refuses hosts the user didn't approve and private networks", async () => {
    await expect(proxyFetch({ url: "https://api.example.com/x", method: "GET", headers: {}, body: null, auth: null }, { granted: [], secret: () => null, resolve })).rejects.toThrow(/needs approval/);
    await expect(proxyFetch({ url: "http://inside.example.com/", method: "GET", headers: {}, body: null, auth: null }, { granted: ["fetch:inside.example.com"], secret: () => null, resolve: async () => ["10.0.0.5"] })).rejects.toThrow(/private network/);
  });

  it("adds a stored secret's header, drops cookies, and checks each redirect", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      if (seen.length === 1) return new Response(null, { status: 302, headers: { location: "https://evil.example.org/" } });
      return new Response("ok");
    }) as typeof fetch;
    const deps = { granted: ["fetch:api.example.com", "secret:gh"], secret: () => ({ header: "Authorization", value: "Bearer s3cret" }), fetch: fake, resolve };
    await expect(proxyFetch({ url: "https://api.example.com/a", method: "GET", headers: { Cookie: "x=1", Accept: "application/json" }, body: null, auth: "gh" }, deps)).rejects.toThrow(/may not reach evil.example.org/);
    expect(seen[0]!.headers).toEqual({ Accept: "application/json", Authorization: "Bearer s3cret" });
  });

  it("needs the secret capability approved", async () => {
    await expect(proxyFetch({ url: "https://api.example.com/a", method: "GET", headers: {}, body: null, auth: "gh" }, { granted: ["fetch:api.example.com"], secret: () => null, resolve })).rejects.toThrow(/secret:gh/);
  });
});

describe("records", () => {
  it("filters, orders and counts by any field, and refuses a stale rev", () => {
    let now = 1000;
    const { store } = memoryStore(() => now++);
    const mini = store.create({ name: "Board", projectId: null, by: "user" });
    for (const [title, stage, score] of [["a", "todo", 3], ["b", "done", 1], ["c", "todo", 2]] as const) store.insert(mini.id, "tasks", { title, stage, score }, "user");
    expect(store.find(mini.id, "tasks", { where: { stage: "todo" }, order: "score" }).map((record) => record.data.title)).toEqual(["c", "a"]);
    expect(store.find(mini.id, "tasks", { where: { score: { gte: 2 } }, order: "-score" }).map((record) => record.data.title)).toEqual(["a", "c"]);
    expect(store.count(mini.id, "tasks", { stage: { in: ["done"] } })).toBe(1);
    const [first] = store.find(mini.id, "tasks", { where: { title: "a" } });
    store.update(mini.id, "tasks", first!.id, { ...first!.data, stage: "done" }, first!.rev);
    expect(() => store.update(mini.id, "tasks", first!.id, { title: "a" }, first!.rev)).toThrow(RecordConflict);
    expect(store.patch(mini.id, "tasks", first!.id, { score: null }).data).toEqual({ title: "a", stage: "done" });
  });

  it("keeps one schema with the migrations", () => {
    expect(MIGRATIONS).toContain(MINI_TABLES);
  });
});

describe("mini apps on Studio", () => {
  it("creates a mini app with a tool, compiles it, and serves its frame with the shelf", async () => {
    await withHost(async (host) => {
      const created = text(await tool(host, "minis_create", { name: "Board", files: APP }, { threadId: "thr_1", projectId: null }));
      const id = /id (mini_[0-9a-f]{16})/.exec(created)![1]!;
      expect(created).toContain(`::mini{id="${id}"}`);
      const { mini } = await call(host, "minis.get", { id });
      expect(mini.manifest.libs).toEqual(["charts@1"]);
      const frame = await host.harness.behavior.fetchHttp("GET", `/minis/frame?mini=${id}&version=${mini.versionId}&theme=dark`);
      expect(frame.status).toBe(200);
      expect(frame.headers.get("content-security-policy")).toContain("connect-src 'none'");
      const html = await frame.text();
      for (const file of ["runtime-1.js", "react-19.js", "tailwind-4.js", "kit-1.js", "charts-1.js"]) expect(html).toContain(`file=${file}`);
      expect(html).toContain('__mini.run("main.jsx")');
      const script = await (await host.harness.behavior.fetchHttp("GET", `/minis/app?mini=${id}&version=${mini.versionId}`)).text();
      expect(script).toContain('__mini.define("main.jsx"');
      const shelf = await host.harness.behavior.fetchHttp("GET", "/minis/shelf?file=react-19.js");
      expect(shelf.status).toBe(200);
      expect((await host.harness.behavior.fetchHttp("GET", "/minis/shelf?file=../package.json")).status).toBe(404);
    });
  });

  it("won't save source that doesn't compile, and keeps the last good version", async () => {
    await withHost(async (host) => {
      const id = /id (mini_[0-9a-f]{16})/.exec(text(await tool(host, "minis_create", { name: "Board", files: APP })))![1]!;
      const result = text(await tool(host, "minis_update", { miniId: id, files: { "main.jsx": `import x from "left-pad";` } }));
      expect(result).toContain("didn't compile");
      const { mini } = await call(host, "minis.get", { id });
      expect(mini.versions).toHaveLength(1);
      expect(mini.files["main.jsx"]).toBe(APP["main.jsx"]);
    });
  });

  it("shares records between the frame and the agent, in declared collections only", async () => {
    await withHost(async (host) => {
      const id = /id (mini_[0-9a-f]{16})/.exec(text(await tool(host, "minis_create", { name: "Board", files: APP })))![1]!;
      const { record } = await call(host, "minis.db.insert", { id, clientId: CLIENT, collection: "tasks", data: { title: "Ship", stage: "todo" } });
      expect(host.harness.realtimeSignals.some((signal) => JSON.stringify(signal.payload).includes(record.id))).toBe(true);
      const found = text(await tool(host, "minis_data", { miniId: id, op: "find", collection: "tasks", query: { where: { stage: "todo" } } }));
      expect(found).toContain("Ship");
      await tool(host, "minis_data", { miniId: id, op: "patch", collection: "tasks", recordId: record.id, fields: { stage: "done" } });
      expect((await call(host, "minis.db.get", { id, collection: "tasks", recordId: record.id })).record.data.stage).toBe("done");
      await expect(call(host, "minis.db.insert", { id, clientId: CLIENT, collection: "other", data: {} })).rejects.toThrow(/No collection "other"/);
    });
  });

  it("asks the user to approve network access, with a dialog nonce an agent can't fake", async () => {
    let now = 1_700_000_000_000;
    await withHost(async (host) => {
      const files = { ...APP, "mini.json": JSON.stringify({ entry: "main.jsx", libs: ["charts@1"], collections: { tasks: {} }, capabilities: ["fetch:api.example.com"] }) };
      const created = text(await tool(host, "minis_create", { name: "Board", files }));
      expect(created).toContain("Waiting for the user's approval: fetch:api.example.com");
      const id = /id (mini_[0-9a-f]{16})/.exec(created)![1]!;
      await expect(call(host, "minis.fetch", { id, url: "https://api.example.com/x", method: "GET", headers: {}, body: null, auth: null })).rejects.toThrow(/needs approval/);
      await expect(call(host, "minis.requestApproval", { id })).rejects.toThrow(/Open the mini app/);
      await call(host, "minis.live.open", { id, clientId: CLIENT, actions: [] });
      const prompt = await call(host, "minis.requestApproval", { id });
      expect(prompt.capabilities).toEqual(["fetch:api.example.com"]);
      await expect(call(host, "minis.approve", { id, nonce: "x".repeat(20), capabilities: prompt.capabilities })).rejects.toThrow(/expired/);
      const again = await call(host, "minis.requestApproval", { id });
      now += 1000;
      await call(host, "minis.approve", { id, nonce: again.nonce, capabilities: again.capabilities });
      const response = await call(host, "minis.fetch", { id, url: "https://api.example.com/x", method: "GET", headers: {}, body: null, auth: null });
      expect(response).toMatchObject({ status: 200, body: "hello" });
      expect((await call(host, "minis.fetchLog", { id })).entries[0]).toMatchObject({ status: 200, url: "https://api.example.com/x" });
    }, { now: () => now, fetch: (async () => new Response("hello")) as typeof fetch, resolve: async () => ["93.184.216.34"] });
  });

  it("runs an action in the open copy and returns its result", async () => {
    await withHost(async (host) => {
      const id = /id (mini_[0-9a-f]{16})/.exec(text(await tool(host, "minis_create", { name: "Board", files: APP })))![1]!;
      await call(host, "minis.live.open", { id, clientId: CLIENT, actions: ["addTask"] });
      const running = tool(host, "minis_live", { miniId: id, op: "do", action: "addTask", args: ["Ship"] });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const command = host.harness.realtimeSignals.map((signal) => signal.payload as { type?: string; commandId?: string }).find((event) => event?.type === "do")!;
      await call(host, "minis.live.result", { commandId: command.commandId!, clientId: CLIENT, ok: true, value: { added: 1 } });
      expect(text(await running)).toContain('"added": 1');
    });
  });
});
