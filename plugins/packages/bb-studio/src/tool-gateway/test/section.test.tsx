// @vitest-environment happy-dom
// The Tool Gateway settings page: read-only without the app window, every
// change sent with the app token, secrets write-only.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetUiTokenForTests } from "../../bring-over/api";
import type { ServerView, ToolGatewaySnapshot } from "../contract";
import { resetCanChangeForTests } from "../ui/api";
import { formFromServer, inputFromForm, ToolGatewaySection } from "../ui/ToolGatewaySection";

const server: ServerView = {
  id: "notes", label: "Notes", kind: "stdio", command: "/usr/local/bin/notes-mcp", args: ["--stdio"], cwd: null, url: null, envNames: ["NOTES_TOKEN"], headerNames: [],
  enabled: true, approved: true, status: "running", lastError: null, tools: 3, disabledTools: [], projects: null, toolsChanged: false, signIn: "none", memoryBytes: 12 * 1024 * 1024,
  callTimeoutMs: 60_000, source: "added", createdAt: 1, approvedAt: 1,
};
const snapshot: ToolGatewaySnapshot = {
  servers: [server],
  requests: [{ id: "tgr_1", name: "calendar", label: "Calendar", kind: "streamable-http", command: null, args: [], url: "https://calendar.example.test/mcp", envNames: [], headerNames: ["Authorization"], why: "Check the calendar", threadId: "thr_test", state: "pending", taskId: "task_1", createdAt: Date.now() }],
  providers: [{ id: "claude-code", name: "Claude Code", acp: false, access: true, servers: "all" }, { id: "acp-hermes", name: "Hermes", acp: true, access: true, servers: ["notes"] }],
  ready: 1,
  importable: 2,
  problems: [],
};

let root: Root | null = null;
let container: HTMLDivElement;
const calls: { method: string; token: string | null; body: unknown }[] = [];

function stubServer(appWindow: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = url.split("/").pop()!;
    const headers = new Headers(init?.headers);
    calls.push({ method, token: headers.get("x-bb-studio-ui-token"), body: JSON.parse(String(init?.body ?? "null")) });
    const result = method === "toolGateway.snapshot" ? snapshot
      : method === "toolGateway.whoami" ? { appWindow: appWindow && headers.get("x-bb-studio-ui-token") === "token-from-the-app" }
      : method === "toolGateway.setEnabled" ? { ...server, enabled: false }
      : { ok: true };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }));
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(<ToolGatewaySection />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent ?? "");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.length = 0;
  resetUiTokenForTests();
  resetCanChangeForTests();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
});

describe("the Tool Gateway page", () => {
  it("is read-only without BB Studio's window: no add, approve or switches", async () => {
    vi.stubGlobal("bbDesktop", undefined);
    stubServer(false);
    await mount();
    expect(container.textContent).toContain("Changes need the BB Studio app on this Mac.");
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).toContain("Calendar");
    expect(buttons()).not.toContain("Add server");
    expect(buttons()).not.toContain("Approve…");
    const switches = [...container.querySelectorAll<HTMLButtonElement>("[role=switch]")];
    expect(switches.length).toBeGreaterThan(0);
    for (const each of switches) expect(each.disabled).toBe(true);
    expect(calls.every((call) => call.token === null)).toBe(true);
  });

  it("in the app window: changes go with the app token", async () => {
    vi.stubGlobal("bbDesktop", { experimental_bringOverToken: async () => "token-from-the-app" });
    stubServer(true);
    await mount();
    expect(container.textContent).not.toContain("Changes need the BB Studio app");
    expect(buttons()).toContain("Add server");
    expect(buttons()).toContain("Approve…");
    expect(container.textContent).toContain("Import 2 servers from Agent Plugins");
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Notes on"]')!;
    await act(async () => { toggle.click(); });
    const sent = calls.find((call) => call.method === "toolGateway.setEnabled");
    expect(sent).toMatchObject({ token: "token-from-the-app", body: { id: "notes", enabled: false } });
    // Providers: an ACP agent with its own server list.
    expect(container.textContent).toContain("Hermes");
    expect(container.textContent).toContain("1 server: notes");
  });
});

describe("the server form", () => {
  it("never shows a stored secret and sends null to keep it", () => {
    const form = formFromServer(server);
    expect(form.env).toEqual([{ name: "NOTES_TOKEN", value: "", stored: true }]);
    expect(inputFromForm(form)).toMatchObject({ id: "notes", kind: "stdio", command: "/usr/local/bin/notes-mcp", args: ["--stdio"], env: { NOTES_TOKEN: null }, callTimeoutMs: 60_000 });
    expect(inputFromForm({ ...form, env: [{ name: "NOTES_TOKEN", value: "new", stored: true }] }).env).toEqual({ NOTES_TOKEN: "new" });
  });
});
