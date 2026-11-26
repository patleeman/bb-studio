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
    expect(callRuns({ tool: "area", arguments: { op: "update" } }, "area_update")).toBe(true);
    expect(callRuns({ tool: "area", arguments: { op: "get" } }, "area_update")).toBe(false);
    expect(callRuns({ tool: "area_update", arguments: {} }, "area_update")).toBe(true);
  });
});

describe("mergedTools().execute()", () => {
  function makeBook() {
    const entries = new Map<string, { name: string; description: string; parameters: z.ZodType; execute: () => unknown }>([
      ["area_get", { name: "area_get", description: "Search", parameters: z.object({ query: z.string() }), execute: () => "searched" }],
      ["area_update", { name: "area_update", description: "Add", parameters: z.object({ topic: z.string(), text: z.string() }), execute: () => "added" }],
      ["area_list", { name: "area_list", description: "Update", parameters: z.object({ id: z.string(), text: z.string() }), execute: () => "updated" }],
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
    const memory = tools.find((t) => t.name === "area")!;
    expect(memory).toBeDefined();

    const result = await memory.execute({ op: "get", query: "hello" }, {});
    expect(result).toBe("ran:area_get");
    expect(ran).toEqual([{ name: "area_get", input: { query: "hello" } }]);
    expect(allowed).toHaveBeenCalledTimes(1);
    expect(allowed).toHaveBeenCalledWith({}, "area_get");
  });

  it("preserves the exact refusal message listing usable ops and ignores prototype keys (__proto__, constructor, toString)", async () => {
    const { book, ran } = makeBook();
    const allowed = vi.fn(async (_ctx: unknown, old: string) => old === "area_get");
    const tools = mergedTools({ book, allowed });
    const memory = tools.find((t) => t.name === "area")!;

    const refused = await memory.execute({ op: "update", topic: "t", text: "x" }, {});
    expect(refused).toBe("area: op must be one of: get (needs query).");
    // Should not re-check area_update after it already returned false.
    expect(allowed.mock.calls.filter(([, name]) => name === "area_update")).toHaveLength(1);

    for (const badOp of ["toString", "__proto__", "constructor"]) {
      const protoRefused = await memory.execute({ op: badOp }, {});
      expect(protoRefused).toBe("area: op must be one of: get (needs query).");
    }
    expect(ran).toEqual([]);
  });

  it("isolates two ctx objects with different allow-sets", async () => {
    const { book, ran } = makeBook();
    const ctxA = { threadId: "thr_a" };
    const ctxB = { threadId: "thr_b" };
    const allowed = vi.fn(async (ctx: unknown, old: string) => {
      if (ctx === ctxA) return old === "area_get";
      if (ctx === ctxB) return old === "area_update";
      return false;
    });
    const tools = mergedTools({ book, allowed });
    const memory = tools.find((t) => t.name === "area")!;

    expect(await memory.execute({ op: "get", query: "q" }, ctxA)).toBe("ran:area_get");
    expect(await memory.execute({ op: "update", topic: "t", text: "x" }, ctxA)).toBe("area: op must be one of: get (needs query).");
    expect(await memory.execute({ op: "update", topic: "t", text: "x" }, ctxB)).toBe("ran:area_update");
    expect(await memory.execute({ op: "get", query: "q" }, ctxB)).toBe("area: op must be one of: update (needs topic, text).");
    expect(ran).toEqual([
      { name: "area_get", input: { query: "q" } },
      { name: "area_update", input: { topic: "t", text: "x" } },
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
