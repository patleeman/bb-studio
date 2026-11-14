import { describe, expect, it, vi } from "vitest";
import { resolveLink, type LinkResolveDeps } from "./server";

const deps = (): LinkResolveDeps => ({
  threadTitle: vi.fn(async (threadId: string) => (threadId === "thr_1" ? "Fix login" : null)),
  itemTitle: vi.fn((id: string) => (id === "pg_0123456789abcdef" ? "Plan" : id === "art_0123456789abcdef" ? "  " : null)),
  botName: vi.fn((id: string) => (id === "bot_main" ? "Dot" : null)),
  entryTitle: vi.fn(async (kind: string, id: string) => (`${kind}/${id}` === "todo/loop_1" ? "Pay the bill" : `${kind}/${id}` === "automation/bot_main:aut_1" ? "Morning card" : `${kind}/${id}` === "record/mem_1" ? " " : null)),
  fileTarget: vi.fn(async (_threadId: string, path: string) => (path.startsWith("/") ? { kind: "host" as const, hostId: "h1", path } : null)),
  workspacePath: vi.fn(async (_threadId: string, path: string) => path.replace(/^\.\//, "")),
});

describe("links.resolve", () => {
  it("finds threads, items and Bots by the lookups workbench_open uses, and reports what is gone", async () => {
    const lookups = deps();
    expect(await resolveLink({ kind: "conversation", id: "thr_1", threadId: null }, lookups)).toEqual({ found: true, title: "Fix login", spec: null });
    expect(await resolveLink({ kind: "worker", id: "thr_gone", threadId: null }, lookups)).toEqual({ found: false, title: null, spec: null });
    expect(await resolveLink({ kind: "board", id: "thr_1", threadId: null }, lookups)).toMatchObject({ found: true, title: "Fix login" });
    expect(await resolveLink({ kind: "page", id: "pg_0123456789abcdef", threadId: null }, lookups)).toEqual({ found: true, title: "Plan", spec: null });
    expect(await resolveLink({ kind: "artifact", id: "art_0123456789abcdef", threadId: null }, lookups)).toEqual({ found: true, title: "Untitled", spec: null });
    expect(await resolveLink({ kind: "page", id: "pg_deleted", threadId: null }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "page", id: "dsn_0123456789abcdef", threadId: null }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "bot", id: "bot_main", threadId: null }, lookups)).toEqual({ found: true, title: "Dot", spec: null });
    expect(await resolveLink({ kind: "bot", id: "bot_x", threadId: null }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "bot", id: null, threadId: null }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "memory", id: "bot_main", threadId: null }, lookups)).toEqual({ found: true, title: "Memory", spec: null });
    expect(await resolveLink({ kind: "memory", id: null, threadId: null }, lookups)).toEqual({ found: true, title: "Memory", spec: null });
    expect(await resolveLink({ kind: "memory", id: "bot_x", threadId: null }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "vscode", id: null, threadId: null }, lookups)).toEqual({ found: true, title: "VS Code", spec: null });
    expect(await resolveLink({ kind: "workflow", id: "wfr_0123abcd", threadId: null }, lookups)).toMatchObject({ found: true });
    expect(await resolveLink({ kind: "workflow", id: "run-1", threadId: null }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "widget", id: "w", threadId: null }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "todo", id: "loop_1", threadId: null }, lookups)).toEqual({ found: true, title: "Pay the bill", spec: null });
    expect(await resolveLink({ kind: "automation", id: "bot_main:aut_1", threadId: null }, lookups)).toEqual({ found: true, title: "Morning card", spec: null });
    expect(await resolveLink({ kind: "record", id: "mem_1", threadId: null }, lookups)).toEqual({ found: true, title: "Memory record", spec: null });
    expect(await resolveLink({ kind: "todo", id: "loop_deleted", threadId: null }, lookups)).toEqual({ found: false, title: null, spec: null });
    expect(await resolveLink({ kind: "automation", id: "bot_main:aut_deleted", threadId: null }, lookups)).toEqual({ found: false, title: null, spec: null });
    expect(await resolveLink({ kind: "automation", id: null, threadId: null }, lookups)).toMatchObject({ found: false });
  });

  it("gives bb's own kinds the workbench spec that opens them, from the conversation's place", async () => {
    const lookups = deps();
    expect(await resolveLink({ kind: "file", id: "/Users/p/a.ts", threadId: "thr_1" }, lookups)).toEqual({ found: true, title: "/Users/p/a.ts", spec: { kind: "file", target: { kind: "host", hostId: "h1", path: "/Users/p/a.ts" }, location: null } });
    expect(await resolveLink({ kind: "file", id: "a.ts", threadId: "thr_1" }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "file", id: "/Users/p/a.ts", threadId: null }, lookups)).toMatchObject({ found: false });
    const checked = { ...deps(), fileExists: vi.fn(async (_threadId: string, path: string) => path !== "/work/gone.md") };
    expect(await resolveLink({ kind: "file", id: "/work/gone.md", threadId: "thr_1" }, checked)).toEqual({ found: false, title: null, spec: null });
    expect(await resolveLink({ kind: "file", id: "/work/here.md", threadId: "thr_1" }, checked)).toMatchObject({ found: true, title: "/work/here.md" });
    expect(await resolveLink({ kind: "diff", id: "./src/a.ts", threadId: "thr_1" }, lookups)).toEqual({ found: true, title: "Diff of src/a.ts", spec: { kind: "diff", path: "src/a.ts" } });
    expect(await resolveLink({ kind: "browser", id: "https://example.com/", threadId: null }, lookups)).toEqual({ found: true, title: "https://example.com/", spec: { kind: "url", url: "https://example.com/" } });
    expect(await resolveLink({ kind: "browser", id: "javascript:alert(1)", threadId: null }, lookups)).toMatchObject({ found: false });
    expect(await resolveLink({ kind: "terminal", id: null, threadId: null }, lookups)).toEqual({ found: true, title: "Terminal", spec: null });
  });
});
