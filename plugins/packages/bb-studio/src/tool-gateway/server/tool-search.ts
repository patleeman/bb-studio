// Ported from Agent Plugins (tool-search.ts): compact search results, no schemas.
import type { CatalogTool } from "./engine";

export const DEFAULT_TOOL_SEARCH_LIMIT = 25;
export const MAX_TOOL_SEARCH_LIMIT = 200;
export const MAX_DESCRIBE_TOOLS = 20;
const SUMMARY_MAX_CHARS = 200;

export interface ToolSearchOptions {
  query?: string;
  serverId?: string;
  limit?: number;
  offset?: number;
}

/** A tool entry without schemas, small enough to list hundreds at once. */
export interface ToolSummary {
  opaqueId: string;
  serverLabel: string;
  serverId: string;
  name: string;
  summary: string;
  status: CatalogTool["status"];
  error?: string;
}

export interface ServerToolCount {
  serverLabel: string;
  serverId: string;
  tools: number;
}

export interface ToolSearchResult {
  /** Tools that matched the query and server filter, before paging. */
  total: number;
  offset: number;
  tools: ToolSummary[];
  /** Every server in the catalog with its tool count, so agents can narrow by serverId. */
  servers: ServerToolCount[];
  /** True when no tool matched every query term and results fell back to any-term matches. */
  partialMatch?: boolean;
}

export interface ToolDescribeResult {
  tools: CatalogTool[];
  notFound: string[];
}

/** First sentence or line of a description, capped for compact listings. */
export function summarizeDescription(description: string): string {
  const text = description.trim();
  const firstLine = text.split(/\n\s*\n|\n/, 1)[0] ?? "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine;
  if (sentence.length <= SUMMARY_MAX_CHARS) return sentence;
  return `${sentence.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

export function toolSummary(tool: CatalogTool): ToolSummary {
  return {
    opaqueId: tool.opaqueId,
    serverLabel: tool.serverLabel,
    serverId: tool.serverId,
    name: tool.name,
    summary: summarizeDescription(tool.description),
    status: tool.status,
    ...(tool.error ? { error: tool.error } : {}),
  };
}

/** Lowercased terms; underscores, dashes, and dots split so "get_logs" and "get logs" match alike. */
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[\s_\-.,:/]+/).filter(Boolean))];
}

function scoreTool(tool: CatalogTool, terms: string[]): { matched: number; score: number } {
  const name = tool.name.toLowerCase();
  const server = `${tool.serverId} ${tool.serverLabel}`.toLowerCase();
  const description = tool.description.toLowerCase();
  let matched = 0;
  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    if (name === term) termScore += 10;
    else if (name.split(/[_\-.]+/).includes(term)) termScore += 6;
    else if (name.includes(term)) termScore += 4;
    if (server.includes(term)) termScore += 2;
    if (description.includes(term)) termScore += 1;
    if (termScore > 0) matched += 1;
    score += termScore;
  }
  return { matched, score };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_TOOL_SEARCH_LIMIT;
  return Math.min(MAX_TOOL_SEARCH_LIMIT, Math.max(1, Math.floor(limit)));
}

function serverCounts(catalog: CatalogTool[]): ServerToolCount[] {
  const counts = new Map<string, ServerToolCount>();
  for (const tool of catalog) {
    const key = `${tool.serverLabel}\u0000${tool.serverId}`;
    const entry = counts.get(key) ?? { serverLabel: tool.serverLabel, serverId: tool.serverId, tools: 0 };
    entry.tools += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => a.serverId.localeCompare(b.serverId) || a.serverLabel.localeCompare(b.serverLabel));
}

/**
 * Filter and rank the bridge catalog. Without a query, tools keep catalog order.
 * With a query, tools matching every term rank first by score; if none match every
 * term, tools matching any term are returned instead and `partialMatch` is set.
 */
export function searchTools(catalog: CatalogTool[], options: ToolSearchOptions = {}): ToolSearchResult {
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const serverId = options.serverId?.trim();
  const scoped = serverId ? catalog.filter((tool) => tool.serverId === serverId) : catalog;
  const terms = queryTerms(options.query ?? "");

  let ranked = scoped;
  let partialMatch = false;
  if (terms.length > 0) {
    const scored = scoped
      .map((tool, index) => ({ tool, index, ...scoreTool(tool, terms) }))
      .filter((entry) => entry.matched > 0);
    const complete = scored.filter((entry) => entry.matched === terms.length);
    const pool = complete.length > 0 ? complete : scored;
    partialMatch = complete.length === 0 && scored.length > 0;
    ranked = pool
      .sort((a, b) => b.matched - a.matched || b.score - a.score || a.index - b.index)
      .map((entry) => entry.tool);
  }

  return {
    total: ranked.length,
    offset,
    tools: ranked.slice(offset, offset + limit).map(toolSummary),
    servers: serverCounts(catalog),
    ...(partialMatch ? { partialMatch } : {}),
  };
}

/** Full catalog entries (with input schemas) for the requested opaque IDs, in request order. */
export function describeTools(catalog: CatalogTool[], opaqueIds: string[]): ToolDescribeResult {
  const byId = new Map(catalog.map((tool) => [tool.opaqueId, tool]));
  const tools: CatalogTool[] = [];
  const notFound: string[] = [];
  for (const id of [...new Set(opaqueIds)]) {
    const tool = byId.get(id);
    if (tool) tools.push(tool);
    else notFound.push(id);
  }
  return { tools, notFound };
}
