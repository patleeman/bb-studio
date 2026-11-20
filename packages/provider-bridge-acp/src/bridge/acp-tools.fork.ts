// BB Studio fork: the checks BB runs on each call an ACP agent sends to
// bb-bridge before the bridge relays it, and the trimmed schemas the agent
// sees. See STUDIO_FORK.md, "ACP agent tools (`acp-tools`)".
//
// Which BB tools a session offers is decided before the bridge, per provider
// (Studio's Tool Gateway gives each provider, each ACP agent included, its own
// switch), and can differ between threads. The agent can read its bb-bridge
// token, so the bridge enforces that choice: a call is relayed only for the
// thread its token was made for, and only for a tool that thread was offered.
// Arguments are left to the tool's own validation, as upstream does.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DynamicTool } from "@bb/domain";

/**
 * The token one thread's bb-bridge gets: derived from the bridge process's
 * secret and the thread id, so it is good for that thread only. All threads of
 * one ACP agent share a bridge process and its secret.
 */
export function forkThreadToken(bridgeToken: string, threadId: string): string {
  return createHmac("sha256", bridgeToken).update(threadId).digest("hex");
}

/** Whether a request's token was made for the thread the request names. */
export function forkThreadTokenMatches(
  bridgeToken: string,
  threadId: string,
  token: string,
): boolean {
  const expected = Buffer.from(forkThreadToken(bridgeToken, threadId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Refuses a call for a tool this session was not offered. Returns an error
 * message, or null when the call may go ahead.
 */
export function forkCheckAcpToolCall(
  tools: readonly DynamicTool[] | undefined,
  name: string,
): string | null {
  return (tools ?? []).some((candidate) => candidate.name === name)
    ? null
    : `Tool "${name}" is not available in this session.`;
}

// Keys that hold one subschema.
const SCHEMA_KEYS = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "items",
  "additionalItems",
  "unevaluatedItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
]);
// Keys that hold an array of subschemas.
const SCHEMA_ARRAY_KEYS = new Set([
  "anyOf",
  "oneOf",
  "allOf",
  "prefixItems",
  "items",
]);
// Keys that hold a map from a name (any name, even "pattern") to a subschema.
const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
]);
// Pure annotations: no effect on which values are valid. `$schema` is dropped
// only when it names draft 2020-12, the default reading; an older draft's
// marker stays, since it changes how keywords such as `items` are read.
const DROPPED_KEYS = new Set(["$comment", "examples"]);
const DEFAULT_DRAFT =
  /^https?:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/u;

/**
 * A smaller copy of a tool's input schema for the agent. It drops only the
 * annotations `$comment`, `examples` and a draft 2020-12 `$schema`, and only
 * where a schema keyword can stand. Names inside `properties` and the other
 * name maps are parameter names, not keywords, so they are kept whatever they
 * are called. Every validation keyword, every description and every `null`
 * stays.
 */
export function compactAcpToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(compactAcpToolSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED_KEYS.has(key)) continue;
    if (
      key === "$schema" &&
      typeof value === "string" &&
      DEFAULT_DRAFT.test(value)
    )
      continue;
    if (SCHEMA_MAP_KEYS.has(key) && isPlainObject(value)) {
      const mapped: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value)) {
        mapped[name] = compactAcpToolSchema(sub);
      }
      out[key] = mapped;
    } else if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      out[key] = value.map(compactAcpToolSchema);
    } else if (SCHEMA_KEYS.has(key) && isPlainObject(value)) {
      out[key] = compactAcpToolSchema(value);
    } else {
      // const, enum, default, required and every other keyword: kept as is.
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
