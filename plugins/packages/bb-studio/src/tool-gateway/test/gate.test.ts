// Only BB Studio's app window may add, approve or change a server or a
// provider's access. Everyone else, the CLI and agents included, may only ask.
import { afterEach, describe, expect, it } from "vitest";
import { APP_WINDOW_ONLY, GATED_METHODS, TOOL_GATEWAY_PREFIX, TOOL_GATEWAY_TOOLS, toolGatewayContract } from "../contract";
import { isAppWindow } from "../server/caller";
import { APP_WINDOW, CLIENT, PLUGIN_CALLER, harness, stdioServer, type Harness } from "./harness";

let h: Harness | null = null;
afterEach(async () => { await h?.close(); h = null; });

const sampleInput: Record<string, unknown> = {
  "toolGateway.addServer": { server: stdioServer("one") },
  "toolGateway.editServer": { server: stdioServer("one") },
  "toolGateway.approve": { id: "one" },
  "toolGateway.decline": { requestId: "tgr_x" },
  "toolGateway.setEnabled": { id: "one", enabled: false },
  "toolGateway.setToolEnabled": { id: "one", tool: "echo", enabled: false },
  "toolGateway.setScope": { id: "one", projects: ["prj_a"] },
  "toolGateway.remove": { id: "one" },
  "toolGateway.signIn": { id: "one" },
  "toolGateway.finishSignIn": { id: "one", callbackUrl: "http://localhost:39999/x" },
  "toolGateway.signOut": { id: "one" },
  "toolGateway.testTool": { id: "one", tool: "echo", args: { pattern: "abc" } },
  "toolGateway.setProvider": { providerId: "codex", access: false, servers: "all" },
  "toolGateway.import": { ids: ["one"] },
  "toolGateway.removeOldPlugin": null,
};

describe("the app-window gate", () => {
  it("shares the doorway prefix with the ACP bridge (acp-tools.fork.ts GATEWAY_TOOL_PREFIXES)", () => {
    expect(TOOL_GATEWAY_PREFIX).toBe("tool_gateway_");
    for (const tool of TOOL_GATEWAY_TOOLS) expect(tool.startsWith(TOOL_GATEWAY_PREFIX)).toBe(true);
  });

  it("reads the flag only from a client caller the fork marked", () => {
    expect(isAppWindow(APP_WINDOW)).toBe(true);
    expect(isAppWindow(CLIENT)).toBe(false);
    expect(isAppWindow(PLUGIN_CALLER)).toBe(false);
    expect(isAppWindow({ experimental_caller: { kind: "plugin", pluginId: "x", studioAppWindow: true } })).toBe(false);
    expect(isAppWindow({ experimental_caller: { kind: "client", studioAppWindow: "yes" } })).toBe(false);
    expect(isAppWindow(undefined)).toBe(false);
  });

  it("refuses every gated RPC without the flag, and changes nothing", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const before = JSON.stringify(h.gateway.store.listServers());
    for (const method of GATED_METHODS) {
      expect(sampleInput, method).toHaveProperty([method]);
      const input = toolGatewayContract[method].input.parse(sampleInput[method]);
      for (const context of [CLIENT, PLUGIN_CALLER, null, { experimental_caller: { kind: "client", studioAppWindow: false } }]) {
        await expect(h.rpc(method, input, context), method).rejects.toMatchObject({ code: "forbidden", message: APP_WINDOW_ONLY });
      }
    }
    expect(JSON.stringify(h.gateway.store.listServers())).toBe(before);
    expect(h.kv.get("tool-gateway:providers")).toBeUndefined();
    expect(h.removedPlugins).toEqual([]);
  });

  it("lets the app window add a server, and that is its approval", async () => {
    h = await harness();
    const server = await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    expect(server).toMatchObject({ id: "one", approved: true, enabled: true, envNames: ["FAKE_TOKEN"], source: "added" });
    expect((await h.rpc("toolGateway.whoami", null)).appWindow).toBe(true);
    expect((await h.rpc("toolGateway.whoami", null, CLIENT)).appWindow).toBe(false);
  });

  it("turns a request from the CLI or an RPC into a pending request and a Todo, never a server", async () => {
    h = await harness();
    const cli = await h.gateway.cli(["request", "--name", "notes", "--command", "notes-mcp", "--arg", "--stdio", "--env", "NOTES_TOKEN", "--why", "To read the user's notes"], { threadId: "thr_claude" });
    expect(cli.exitCode).toBe(0);
    expect(cli.stdout).toContain("Only the user can approve it");
    const rpc = await h.rpc("toolGateway.request", { name: "calendar", url: "https://calendar.example.test/mcp", why: "Check the calendar" }, CLIENT);
    expect(rpc).toMatchObject({ name: "calendar", state: "pending", kind: "streamable-http" });
    expect(h.gateway.store.listServers()).toEqual([]);
    const snapshot = await h.rpc("toolGateway.snapshot", null, CLIENT);
    expect(snapshot.requests.map((request: { name: string }) => request.name).sort()).toEqual(["calendar", "notes"]);
    expect(snapshot.ready).toBe(0);
    expect(h.todos.created.map((todo) => todo.title)).toEqual(["Approve MCP server notes?", "Approve MCP server calendar?"]);
    expect(h.todos.created[0]!.threadId).toBe("thr_claude");
    expect(h.gateway.agentConfiguration({ providerId: "claude-code", projectId: "prj_a" }).tools).toEqual([]);
    // A request carries names only: there is no field for a value.
    expect(() => toolGatewayContract["toolGateway.request"].input.parse({ name: "x", command: "x", why: "y", env: { A: "secret" } })).toThrow();
  });

  it("closes the request's Todo when the app window approves or declines it", async () => {
    h = await harness();
    const one = await h.rpc("toolGateway.request", { name: "one", command: process.execPath, why: "Testing" }, CLIENT);
    const two = await h.rpc("toolGateway.request", { name: "two", command: process.execPath, why: "Testing" }, CLIENT);
    await h.rpc("toolGateway.addServer", { server: stdioServer("one"), requestId: one.id });
    await h.rpc("toolGateway.decline", { requestId: two.id });
    expect(h.todos.closed).toEqual([{ taskId: one.taskId, state: "done" }, { taskId: two.taskId, state: "dropped" }]);
    expect((await h.rpc("toolGateway.snapshot", null)).requests).toEqual([]);
    expect(h.gateway.store.getServer("one")?.source).toBe("request");
  });

  it("refuses a provider access change without the flag and takes it with the flag", async () => {
    h = await harness();
    await expect(h.rpc("toolGateway.setProvider", { providerId: "codex", access: false, servers: "all" }, CLIENT)).rejects.toMatchObject({ code: "forbidden" });
    const { providers } = await h.rpc("toolGateway.setProvider", { providerId: "codex", access: false, servers: "all" });
    expect(providers.find((provider: { id: string }) => provider.id === "codex")).toMatchObject({ access: false });
    expect(h.kv.get("tool-gateway:providers")).toEqual({ codex: { access: false, servers: "all" } });
  });
});
