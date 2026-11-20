import type { DynamicTool } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  compactAcpToolSchema,
  forkCheckAcpToolCall,
  forkThreadToken,
  forkThreadTokenMatches,
} from "./acp-tools.fork.js";

function tool(
  name: string,
  inputSchema: unknown = { type: "object" },
): DynamicTool {
  return { name, description: `${name} tool`, inputSchema };
}

describe("compactAcpToolSchema", () => {
  it("keeps parameters named after JSON Schema keywords", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob to search for" },
        format: { enum: ["json", "csv"] },
        type: { type: "string", examples: ["page"] },
        properties: {
          type: "object",
          properties: {
            examples: { type: "array", items: { type: "string" } },
          },
        },
        $comment: { type: "string" },
        q: { type: "string" },
      },
      required: ["pattern", "format", "type", "properties"],
      additionalProperties: false,
    };
    expect(compactAcpToolSchema(schema)).toEqual({
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob to search for" },
        format: { enum: ["json", "csv"] },
        type: { type: "string" },
        properties: {
          type: "object",
          properties: {
            examples: { type: "array", items: { type: "string" } },
          },
        },
        $comment: { type: "string" },
        q: { type: "string" },
      },
      required: ["pattern", "format", "type", "properties"],
      additionalProperties: false,
    });
  });

  it("keeps every validation constraint and every null", () => {
    const schema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 40,
          pattern: "^[a-z]+$",
        },
        size: { type: "integer", minimum: 0, maximum: 10, multipleOf: 2 },
        tags: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: { type: "string", format: "uri" },
        },
        themeId: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "null removes the theme",
        },
        note: { type: ["string", "null"] },
        extra: {
          type: "object",
          additionalProperties: { type: "number", $comment: "x" },
        },
        map: {
          type: "object",
          patternProperties: { "^x-": { type: "string", examples: ["a"] } },
        },
      },
      $defs: { pattern: { type: "string", $comment: "a def named pattern" } },
    };
    expect(compactAcpToolSchema(schema)).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 40,
          pattern: "^[a-z]+$",
        },
        size: { type: "integer", minimum: 0, maximum: 10, multipleOf: 2 },
        tags: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: { type: "string", format: "uri" },
        },
        themeId: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "null removes the theme",
        },
        note: { type: ["string", "null"] },
        extra: { type: "object", additionalProperties: { type: "number" } },
        map: {
          type: "object",
          patternProperties: { "^x-": { type: "string" } },
        },
      },
      $defs: { pattern: { type: "string" } },
    });
  });

  it("leaves values inside const, enum and default alone", () => {
    const schema = {
      type: "object",
      properties: {
        filter: {
          type: "object",
          default: { $schema: "kept", examples: [1] },
          const: { $comment: "kept" },
        },
        mode: { enum: [{ examples: "kept" }] },
      },
    };
    expect(compactAcpToolSchema(schema)).toEqual(schema);
  });

  it("does not change the schema it was given", () => {
    const schema = {
      $schema: "x",
      type: "object",
      properties: { a: { type: "string", examples: ["b"] } },
    };
    const before = JSON.stringify(schema);
    compactAcpToolSchema(schema);
    expect(JSON.stringify(schema)).toBe(before);
  });
});

describe("compactAcpToolSchema and $schema", () => {
  it("drops a draft 2020-12 $schema and keeps an older draft's", () => {
    expect(
      compactAcpToolSchema({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      }),
    ).toEqual({ type: "object" });
    const tuple = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: [{ type: "string" }, { type: "number", examples: [1] }],
    };
    expect(compactAcpToolSchema(tuple)).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: [{ type: "string" }, { type: "number" }],
    });
  });

  it("walks draft-07 dependencies by name", () => {
    expect(
      compactAcpToolSchema({
        type: "object",
        dependencies: {
          pattern: { $comment: "x", required: ["format"] },
          format: ["pattern"],
        },
      }),
    ).toEqual({
      type: "object",
      dependencies: {
        pattern: { required: ["format"] },
        format: ["pattern"],
      },
    });
  });
});

describe("forkCheckAcpToolCall", () => {
  const tools = [tool("pages_read"), tool("agent_plugins_call")];

  it("lets a call to an offered tool through, whatever its arguments", () => {
    expect(forkCheckAcpToolCall(tools, "pages_read")).toBeNull();
    expect(forkCheckAcpToolCall(tools, "agent_plugins_call")).toBeNull();
  });

  it("refuses a tool the session was not offered, matched exactly", () => {
    for (const name of [
      "tool_gateway_call",
      "Pages_read",
      "pages_read ",
      "agent_plugins_",
    ]) {
      expect(forkCheckAcpToolCall(tools, name)).toBe(
        `Tool "${name}" is not available in this session.`,
      );
    }
    expect(forkCheckAcpToolCall(undefined, "pages_read")).toMatch(
      /not available/u,
    );
  });
});

describe("forkThreadToken", () => {
  const secret = "a".repeat(64);

  it("gives each thread its own token", () => {
    const a = forkThreadToken(secret, "thr_a");
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(a).not.toBe(forkThreadToken(secret, "thr_b"));
    expect(a).not.toBe(secret);
  });

  it("accepts a token only for the thread it was made for", () => {
    const a = forkThreadToken(secret, "thr_a");
    expect(forkThreadTokenMatches(secret, "thr_a", a)).toBe(true);
    expect(forkThreadTokenMatches(secret, "thr_b", a)).toBe(false);
    expect(forkThreadTokenMatches(secret, "thr_a", secret)).toBe(false);
    expect(forkThreadTokenMatches(secret, "thr_a", "")).toBe(false);
    expect(forkThreadTokenMatches(secret, "thr_a", `${a}0`)).toBe(false);
  });
});
