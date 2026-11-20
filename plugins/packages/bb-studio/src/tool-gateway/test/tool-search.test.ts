// Ported from Agent Plugins (tool-search.test.ts).
import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_SEARCH_LIMIT, describeTools, queryTerms, searchTools, summarizeDescription } from "../server/tool-search";
import type { CatalogTool } from "../server/engine";

function tool(serverId: string, name: string, description: string, extra: Partial<CatalogTool> = {}): CatalogTool {
  return {
    opaqueId: `plugin__${serverId}__${name}`,
    serverLabel: "example",
    serverId,
    name,
    description,
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    status: "ready",
    ...extra,
  };
}

const catalog: CatalogTool[] = [
  tool("slack", "slack_search_public_and_private", "Search messages in public and private Slack channels. Supports filters."),
  tool("slack", "slack_send_message", "Send a message to a Slack channel."),
  tool("slack", "slack_list_channels", "List Slack channels by name."),
  tool("gmail", "search_messages", "Search Gmail messages using Gmail search syntax."),
];

describe("summarizeDescription", () => {
  it("keeps the first sentence of the first line", () => {
    expect(summarizeDescription("Search logs. Supports facets.\n\nMore detail.")).toBe("Search logs.");
    expect(summarizeDescription("REQUIRED: pass an id\nThen read it")).toBe("REQUIRED: pass an id");
  });

  it("caps long sentences", () => {
    const summary = summarizeDescription("x".repeat(500));
    expect(summary.length).toBe(200);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("queryTerms", () => {
  it("splits on separators, lowercases, and dedupes", () => {
    expect(queryTerms("Search_Slack messages, messages")).toEqual(["search", "slack", "messages"]);
    expect(queryTerms("   ")).toEqual([]);
  });
});

describe("searchTools", () => {
  it("returns compact entries without schemas and per-server counts", () => {
    const result = searchTools(catalog);
    expect(result.total).toBe(catalog.length);
    expect(result.tools[0]).toEqual({
      opaqueId: "plugin__slack__slack_search_public_and_private",
      serverLabel: "example",
      serverId: "slack",
      name: "slack_search_public_and_private",
      summary: "Search messages in public and private Slack channels.",
      status: "ready",
    });
    expect(result.tools[0]).not.toHaveProperty("inputSchema");
    expect(result.servers).toEqual([
      { serverLabel: "example", serverId: "gmail", tools: 1 },
      { serverLabel: "example", serverId: "slack", tools: 3 },
    ]);
  });

  it("requires every term and ranks name matches first", () => {
    const result = searchTools(catalog, { query: "search messages" });
    expect(result.tools.map((t) => t.name)).toEqual(["search_messages", "slack_search_public_and_private"]);
    expect(result.partialMatch).toBeUndefined();
  });

  it("matches the server id as a term", () => {
    const result = searchTools(catalog, { query: "slack send" });
    expect(result.tools.map((t) => t.name)).toEqual(["slack_send_message"]);
  });

  it("falls back to any-term matches when nothing matches every term", () => {
    const result = searchTools(catalog, { query: "list kubernetes" });
    expect(result.partialMatch).toBe(true);
    expect(result.tools.map((t) => t.name)).toEqual(["slack_list_channels"]);
  });

  it("returns nothing when no term matches", () => {
    const result = searchTools(catalog, { query: "zzz" });
    expect(result).toMatchObject({ total: 0, tools: [] });
    expect(result.partialMatch).toBeUndefined();
  });

  it("filters by server and pages with limit and offset", () => {
    const page = searchTools(catalog, { serverId: "slack", limit: 2, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.tools.map((t) => t.name)).toEqual(["slack_send_message", "slack_list_channels"]);
    expect(page.servers).toHaveLength(2);
  });

  it("defaults and clamps the limit", () => {
    const many = Array.from({ length: 300 }, (_, i) => tool("big", `tool_${i}`, "A tool."));
    expect(searchTools(many).tools).toHaveLength(DEFAULT_TOOL_SEARCH_LIMIT);
    expect(searchTools(many, { limit: 10_000 }).tools).toHaveLength(200);
    expect(searchTools(many, { limit: 0 }).tools).toHaveLength(1);
  });

  it("keeps error status for failed servers", () => {
    const failed = tool("broken", "__error_broken", "Server failed to start.", { status: "error", error: "boom" });
    expect(searchTools([failed], { query: "broken" }).tools[0]).toMatchObject({ status: "error", error: "boom" });
  });
});

describe("describeTools", () => {
  it("returns full definitions in request order and reports unknown ids", () => {
    const result = describeTools(catalog, ["plugin__slack__slack_send_message", "missing", "plugin__gmail__search_messages", "missing"]);
    expect(result.tools.map((t) => t.name)).toEqual(["slack_send_message", "search_messages"]);
    expect(result.tools[0]!.inputSchema).toEqual(catalog[1]!.inputSchema);
    expect(result.notFound).toEqual(["missing"]);
  });
});
