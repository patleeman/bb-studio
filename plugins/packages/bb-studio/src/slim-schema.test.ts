import { describe, expect, it } from "vitest";
import { z } from "zod";
import { slim, slimmedIfSmaller } from "./slim-schema";

const block = z.string().describe("Block id or 8-char prefix");
const edit = z.object({
  page: z.string(),
  ops: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("insert_after"), block, markdown: z.string() }).strict(),
    z.object({ op: z.literal("replace"), block, markdown: z.string() }).strict(),
    z.object({ op: z.literal("append"), markdown: z.string() }).strict(),
    z.object({ op: z.literal("delete"), block }).strict(),
    z.object({ op: z.literal("set_checked"), block, checked: z.boolean() }).strict(),
  ])),
}).strict();

describe("slim schemas", () => {
  it("turns a union told apart by one const field into one object with an enum and a needs note", () => {
    const out = slim(edit.toJSONSchema()) as { properties: { ops: { items: Record<string, unknown> } } };
    expect(out.properties.ops.items).toEqual({
      type: "object",
      properties: {
        op: { type: "string", enum: ["insert_after", "replace", "append", "delete", "set_checked"], description: "Needs: insert_after/replace: block, markdown; append: markdown; delete: block; set_checked: block, checked" },
        block: { type: "string", description: "Block id or 8-char prefix" },
        markdown: { type: "string" },
        checked: { type: "boolean" },
      },
      required: ["op"],
    });
    expect(JSON.stringify(out)).not.toContain("additionalProperties");
    expect(JSON.stringify(out)).not.toContain("$schema");
  });

  it("keeps every variant's shape for a field they type differently", () => {
    const union = z.object({ action: z.discriminatedUnion("op", [
      z.object({ op: z.literal("set"), value: z.string(), key: z.string() }),
      z.object({ op: z.literal("count"), value: z.number().int(), key: z.string() }),
      z.object({ op: z.literal("clear") }),
    ]) });
    const out = slim(union.toJSONSchema()) as { properties: { action: { properties: Record<string, unknown> } } };
    expect(out.properties.action.properties.value).toEqual({ anyOf: [{ type: "string" }, { type: "integer", minimum: expect.any(Number), maximum: expect.any(Number) }] });
    expect(out.properties.action.properties.key).toEqual({ type: "string" });
  });

  it("is used only when it saves enough", () => {
    expect(slimmedIfSmaller(edit.toJSONSchema())).not.toBeNull();
    expect(slimmedIfSmaller(z.object({ query: z.string() }).toJSONSchema())).toBeNull();
    expect(slimmedIfSmaller(undefined)).toBeNull();
  });

  it("leaves a union without a shared const field as it was", () => {
    const either = z.object({ value: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]) });
    expect(slim(either.toJSONSchema())).toMatchObject({ properties: { value: { anyOf: [{ properties: { a: { type: "string" } } }, { properties: { b: { type: "number" } } }] } } });
  });

  it("still lets the tool's own schema refuse what the shown one allows", () => {
    // The agent reads the slim schema; BB checks the call against the zod one.
    expect(edit.safeParse({ page: "p", ops: [{ op: "delete" }] }).success).toBe(false);
    expect(edit.safeParse({ page: "p", ops: [{ op: "delete", block: "abc" }] }).success).toBe(true);
  });
});
