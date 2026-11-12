import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { compile, CompileError } from "./server/compile";
import { frameCsp } from "./server/frame";
import { isPrivateAddress, type Transport } from "../guarded-fetch";
import { proxyFetch } from "./server/net";
import { MINI_SECRET_HOSTS, MINI_TABLES, RecordConflict } from "./server/store";
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
  const get = { method: "GET", headers: {}, body: null, auth: null };
  it("refuses hosts the user didn't approve and private networks", async () => {
    await expect(proxyFetch({ ...get, url: "https://api.example.com/x" }, { granted: [], secret: () => null, resolve })).rejects.toThrow(/needs approval/);
    await expect(proxyFetch({ ...get, url: "http://inside.example.com/" }, { granted: ["fetch:inside.example.com"], secret: () => null, resolve: async () => ["10.0.0.5"] })).rejects.toThrow(/private network/);
  });

  it("connects to the addresses it checked, on every hop", async () => {
    const answers: Record<string, string[][]> = { "api.example.com": [["93.184.216.34"], ["127.0.0.1"]], "cdn.example.com": [["93.184.216.35"], ["10.0.0.1"]] };
    const pinned: [string, readonly string[]][] = [];
    const transport: Transport = async (url, _init, addresses) => {
      pinned.push([url.host, addresses]);
      return pinned.length === 1 ? new Response(null, { status: 302, headers: { location: "https://cdn.example.com/b" } }) : new Response("ok");
    };
    const deps = { granted: ["fetch:*.example.com"], secret: () => null, resolve: async (host: string) => answers[host]!.shift()!, transport };
    expect(await proxyFetch({ ...get, url: "https://api.example.com/a" }, deps)).toMatchObject({ status: 200, body: "ok" });
    expect(pinned).toEqual([["api.example.com", ["93.184.216.34"]], ["cdn.example.com", ["93.184.216.35"]]]);
  });

  const gh = { header: "Authorization", value: "Bearer s3cret", hosts: ["api.example.com"] };
  const recording = (respond: (url: URL, count: number) => Response) => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const transport: Transport = async (url, init) => {
      seen.push({ url: url.toString(), headers: init.headers });
      return respond(url, seen.length);
    };
    return { seen, transport };
  };

  it("adds a stored secret's header, drops cookies, and checks each redirect", async () => {
    const { seen, transport } = recording((_url, count) => (count === 1 ? new Response(null, { status: 302, headers: { location: "https://evil.example.org/" } }) : new Response("ok")));
    const deps = { granted: ["fetch:api.example.com", "secret:gh"], secret: () => gh, transport, resolve };
    await expect(proxyFetch({ url: "https://api.example.com/a", method: "GET", headers: { Cookie: "x=1", Accept: "application/json" }, body: null, auth: "gh" }, deps)).rejects.toThrow(/may not reach evil.example.org/);
    expect(seen[0]!.headers).toEqual({ Accept: "application/json", Authorization: "Bearer s3cret" });
  });

  it("needs the secret capability approved", async () => {
    await expect(proxyFetch({ ...get, url: "https://api.example.com/a", auth: "gh" }, { granted: ["fetch:api.example.com"], secret: () => null, resolve })).rejects.toThrow(/secret:gh/);
  });

  it("sends a secret only to the hosts it was stored for", async () => {
    const { seen, transport } = recording(() => new Response("ok"));
    const deps = { granted: ["fetch:api.example.com", "fetch:files.example.net", "secret:gh"], secret: () => gh, transport, resolve };
    await expect(proxyFetch({ ...get, url: "https://files.example.net/upload", auth: "gh" }, deps)).rejects.toThrow(/only sent to api.example.com/);
    expect(seen).toEqual([]);
    expect(await proxyFetch({ ...get, url: "https://api.example.com/user", auth: "gh" }, deps)).toMatchObject({ status: 200 });
  });

  it("asks for a secret stored before secrets were tied to hosts to be stored again", async () => {
    const { seen, transport } = recording(() => new Response("ok"));
    const deps = { granted: ["fetch:api.example.com", "secret:gh"], secret: () => ({ ...gh, hosts: null }), transport, resolve };
    await expect(proxyFetch({ ...get, url: "https://api.example.com/user", auth: "gh" }, deps)).rejects.toThrow(/Store the secret "gh" again/);
    expect(seen).toEqual([]);
  });

  it("sends a secret only over https", async () => {
    const { seen, transport } = recording(() => new Response("ok"));
    const deps = { granted: ["fetch:api.example.com", "secret:gh"], secret: () => gh, transport, resolve };
    await expect(proxyFetch({ ...get, url: "http://api.example.com/user", auth: "gh" }, deps)).rejects.toThrow(/only over https/);
    expect(seen).toEqual([]);
  });

  it("drops the secret when a redirect changes the scheme, host or port", async () => {
    for (const location of ["http://api.example.com/next", "https://api.example.com:8443/next", "https://other.example.com/next"]) {
      const { seen, transport } = recording((_url, count) => (count === 1 ? new Response(null, { status: 302, headers: { location } }) : new Response("ok")));
      const deps = { granted: ["fetch:*.example.com", "secret:gh"], secret: () => ({ ...gh, hosts: ["*.example.com"] }), transport, resolve };
      expect(await proxyFetch({ ...get, url: "https://api.example.com/a", auth: "gh" }, deps)).toMatchObject({ status: 200 });
      expect(seen[0]!.headers, location).toHaveProperty("Authorization");
      expect(seen[1]!.headers, location).not.toHaveProperty("Authorization");
    }
    const { seen, transport } = recording((_url, count) => (count === 1 ? new Response(null, { status: 302, headers: { location: "/same-origin" } }) : new Response("ok")));
    await proxyFetch({ ...get, url: "https://api.example.com/a", auth: "gh" }, { granted: ["fetch:api.example.com", "secret:gh"], secret: () => gh, transport, resolve });
    expect(seen[1]!.headers).toHaveProperty("Authorization", "Bearer s3cret");
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
    expect(MIGRATIONS).toContain(MINI_SECRET_HOSTS);
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
    }, { now: () => now, transport: async () => new Response("hello"), resolve: async () => ["93.184.216.34"] });
  });

  it("ties a stored secret to the hosts approved when it was stored", async () => {
    let now = 1_700_000_000_000;
    const sent: { host: string; auth: string | undefined }[] = [];
    const approve = async (host: Host, id: string) => {
      const prompt = await call(host, "minis.requestApproval", { id });
      now += 1000;
      await call(host, "minis.approve", { id, nonce: prompt.nonce, capabilities: prompt.capabilities });
    };
    await withHost(async (host) => {
      const manifest = (capabilities: string[]) => ({ ...APP, "mini.json": JSON.stringify({ entry: "main.jsx", libs: ["charts@1"], collections: { tasks: {} }, capabilities }) });
      const created = text(await tool(host, "minis_create", { name: "Repos", files: manifest(["fetch:api.github.com", "secret:github"]) }));
      const id = /id (mini_[0-9a-f]{16})/.exec(created)![1]!;
      await call(host, "minis.live.open", { id, clientId: CLIENT, actions: [] });
      await expect(call(host, "minis.setSecret", { id, name: "github", header: "Authorization", value: "Bearer gh" })).rejects.toThrow(/Approve the app's network access first/);
      await approve(host, id);
      await call(host, "minis.setSecret", { id, name: "github", header: "Authorization", value: "Bearer gh" });
      // Later the app asks for another host, and the user approves it.
      await tool(host, "minis_update", { miniId: id, files: manifest(["fetch:api.github.com", "fetch:files.example.net", "secret:github"]) });
      await approve(host, id);
      const fetch = (url: string) => call(host, "minis.fetch", { id, url, method: "GET", headers: {}, body: null, auth: "github" });
      await expect(fetch("https://files.example.net/upload")).rejects.toThrow(/only sent to api.github.com/);
      expect(await fetch("https://api.github.com/user")).toMatchObject({ status: 200 });
      expect(sent).toEqual([{ host: "api.github.com", auth: "Bearer gh" }]);
    }, { now: () => now, transport: async (url, init) => { sent.push({ host: url.host, auth: init.headers.Authorization }); return new Response("ok"); }, resolve: async () => ["93.184.216.34"] });
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

  it("makes a mini app from a live HTML artifact, keeping its page and state", async () => {
    await withHost(async (host) => {
      const result = text(await tool(host, "minis_create", { name: "Report", fromArtifactId: "art_1" }));
      const id = /id (mini_[0-9a-f]{16})/.exec(result)![1]!;
      const { mini } = await call(host, "minis.get", { id });
      expect(mini.manifest.entry).toBe("index.html");
      expect(mini.files["index.html"]).toBe("<h1>Q3</h1>");
      expect(text(await tool(host, "minis_live", { miniId: id, op: "state" }))).toContain('"filter": "EU"');
      expect(text(await tool(host, "minis_create", { name: "Nope", fromArtifactId: "art_missing" }))).toContain("not found");
    }, { artifactSource: (artifactId) => (artifactId === "art_1" ? { title: "Q3 report", html: "<h1>Q3</h1>", state: { filter: "EU" }, projectId: null } : null) });
  });
});
