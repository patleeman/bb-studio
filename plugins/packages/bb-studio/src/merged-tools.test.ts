import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callRuns, createMergedShownCache, mergedTools } from "./merged-tools";

describe("callRuns()", () => {
  it("matches absorbed tools (pages_list, pages_comments, code_comment_reply) as well as MERGES", () => {
    // pages_list via pages_read (no page, no comments)
    expect(callRuns({ tool: "pages_read", arguments: {} }, "pages_list")).toBe(true);
    expect(callRuns({ tool: "pages_read", arguments: { query: "spec" } }, "pages_list")).toBe(true);
    expect(callRuns({ tool: "pages_read", arguments: { page: "pg_1" } }, "pages_list")).toBe(false);
    expect(callRuns({ tool: "pages_read", arguments: { comments: { op: "list" } } }, "pages_list")).toBe(false);

    // pages_comments via pages_read (page + comments)
    expect(callRuns({ tool: "pages_read", arguments: { page: "pg_1", comments: { op: "list" } } }, "pages_comments")).toBe(true);
    expect(callRuns({ tool: "pages_read", arguments: { page: "pg_1" } }, "pages_comments")).toBe(false);
    expect(callRuns({ tool: "pages_read", arguments: { comments: { op: "list" } } }, "pages_comments")).toBe(false);

    // code_comment_reply via code_comments (op: "reply")
    expect(callRuns({ tool: "code_comments", arguments: { op: "reply", id: "c1", body: "ok" } }, "code_comment_reply")).toBe(true);
    expect(callRuns({ tool: "code_comments", arguments: { op: "list" } }, "code_comment_reply")).toBe(false);
    expect(callRuns({ tool: "code_comments", arguments: {} }, "code_comment_reply")).toBe(false);

    // Standard MERGES
    expect(callRuns({ tool: "memory", arguments: { op: "add" } }, "memory_add")).toBe(true);
    expect(callRuns({ tool: "memory", arguments: { op: "search" } }, "memory_add")).toBe(false);
    expect(callRuns({ tool: "memory_add", arguments: {} }, "memory_add")).toBe(true);
  });
});

describe("mergedTools().execute()", () => {
  function makeBook() {
    const entries = new Map<string, { name: string; description: string; parameters: z.ZodType; execute: () => unknown }>([
      ["memory_search", { name: "memory_search", description: "Search", parameters: z.object({ query: z.string() }), execute: () => "searched" }],
      ["memory_add", { name: "memory_add", description: "Add", parameters: z.object({ topic: z.string(), text: z.string() }), execute: () => "added" }],
      ["memory_update", { name: "memory_update", description: "Update", parameters: z.object({ id: z.string(), text: z.string() }), execute: () => "updated" }],
    ]);
    const ran: Array<{ name: string; input: unknown }> = [];
    const book = {
      get: (name: string) => entries.get(name) ?? null,
      run: async (name: string, input: unknown) => {
        ran.push({ name, input });
        return `ran:${name}`;
      },
    };
    return { book, ran };
  }

  it("checks only the requested op's allowed() on the happy path", async () => {
    const { book, ran } = makeBook();
    const allowed = vi.fn(async (_ctx: unknown, _old: string) => true);
    const tools = mergedTools({ book, allowed });
    const memory = tools.find((t) => t.name === "memory")!;
    expect(memory).toBeDefined();

    const result = await memory.execute({ op: "search", query: "hello" }, {});
    expect(result).toBe("ran:memory_search");
    expect(ran).toEqual([{ name: "memory_search", input: { query: "hello" } }]);
    expect(allowed).toHaveBeenCalledTimes(1);
    expect(allowed).toHaveBeenCalledWith({}, "memory_search");
  });

  it("preserves the exact refusal message listing usable ops and ignores prototype keys (__proto__, constructor, toString)", async () => {
    const { book, ran } = makeBook();
    const allowed = vi.fn(async (_ctx: unknown, old: string) => old === "memory_search");
    const tools = mergedTools({ book, allowed });
    const memory = tools.find((t) => t.name === "memory")!;

    const refused = await memory.execute({ op: "add", topic: "t", text: "x" }, {});
    expect(refused).toBe("memory: op must be one of: search (needs query).");
    // Should not re-check memory_add after it already returned false.
    expect(allowed.mock.calls.filter(([, name]) => name === "memory_add")).toHaveLength(1);

    for (const badOp of ["toString", "__proto__", "constructor"]) {
      const protoRefused = await memory.execute({ op: badOp }, {});
      expect(protoRefused).toBe("memory: op must be one of: search (needs query).");
    }
    expect(ran).toEqual([]);
  });

  it("isolates two ctx objects with different allow-sets", async () => {
    const { book, ran } = makeBook();
    const ctxA = { threadId: "thr_a" };
    const ctxB = { threadId: "thr_b" };
    const allowed = vi.fn(async (ctx: unknown, old: string) => {
      if (ctx === ctxA) return old === "memory_search";
      if (ctx === ctxB) return old === "memory_add";
      return false;
    });
    const tools = mergedTools({ book, allowed });
    const memory = tools.find((t) => t.name === "memory")!;

    expect(await memory.execute({ op: "search", query: "q" }, ctxA)).toBe("ran:memory_search");
    expect(await memory.execute({ op: "add", topic: "t", text: "x" }, ctxA)).toBe("memory: op must be one of: search (needs query).");
    expect(await memory.execute({ op: "add", topic: "t", text: "x" }, ctxB)).toBe("ran:memory_add");
    expect(await memory.execute({ op: "search", query: "q" }, ctxB)).toBe("memory: op must be one of: add (needs topic, text).");
    expect(ran).toEqual([
      { name: "memory_search", input: { query: "q" } },
      { name: "memory_add", input: { topic: "t", text: "x" } },
    ]);
  });
});

describe("createMergedShownCache()", () => {
  it("keys pages_read by allow-set (['page'] vs ['page', 'list']), freezes cached schemas, and never caches null", () => {
    let available = false;
    const baseSchema = () => (available ? {
      type: "object",
      properties: {
        page: { type: "string" },
        query: { type: "string" },
        type: { type: "string" },
        after: { type: "string" },
        comments: { type: "object" },
      },
    } : null);
    const base = vi.fn((name: string) => (name === "pages_read" ? baseSchema() : null));
    const shown = createMergedShownCache({
      base,
      slim: (s) => s,
      book: { get: () => null, run: async () => null },
    });

    // When base returns null, nothing is cached; once available, the schema resolves.
    const pageOnly = new Map([["pages_read", ["page"]]]);
    expect(shown("pages_read", pageOnly)).toBeNull();
    available = true;
    const sPageOnly = shown("pages_read", pageOnly)!;
    expect(sPageOnly).not.toBeNull();
    expect(Object.keys(sPageOnly.properties as Record<string, unknown>)).toEqual(["page"]);
    expect(sPageOnly.required).toEqual(["page"]);

    // Repeated call hits the cache and returns the same deeply frozen object.
    expect(shown("pages_read", pageOnly)).toBe(sPageOnly);
    expect(Object.isFrozen(sPageOnly)).toBe(true);
    expect(Object.isFrozen(sPageOnly.properties)).toBe(true);
    expect(Object.isFrozen(sPageOnly.required)).toBe(true);

    // Different allow-set (["page", "list"]) gets its own cached schema with list fields and no required page.
    const pageAndList = new Map([["pages_read", ["page", "list"]]]);
    const sPageAndList = shown("pages_read", pageAndList)!;
    expect(sPageAndList).not.toBe(sPageOnly);
    expect(Object.keys(sPageAndList.properties as Record<string, unknown>).sort()).toEqual(["after", "page", "query", "type"]);
    expect(sPageAndList.required).toBeUndefined();
    expect(Object.isFrozen(sPageAndList)).toBe(true);
    expect(shown("pages_read", new Map([["pages_read", ["list", "page"]]]))).toBe(sPageAndList);
  });
});
