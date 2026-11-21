// The input schema a tool shows the agent, made smaller. BB still checks every
// call against the tool's own zod schema (configure()'s `parameters` override
// changes only what the agent reads), so a looser shown schema never lets bad
// input through: the agent gets the zod error and tries again.
//
// - A union of objects told apart by one `const` field (pages_edit's ops,
//   minis_data's actions…) becomes one object: that field an enum, every
//   other field optional (its schema as the variants give it: anyOf when
//   they differ), and a one-line note saying which fields each value needs.
// - `additionalProperties: false` and `$schema` go.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** The const value of a variant's discriminator field, if it has exactly one such field in common. */
function discriminator(variants: Json[]): string | null {
  const first = variants[0];
  if (!first || !isObject(first.properties)) return null;
  for (const key of Object.keys(first.properties)) {
    if (variants.every((variant) => isObject(variant.properties) && isObject((variant.properties as Json)[key]) && "const" in ((variant.properties as Json)[key] as Json))) return key;
  }
  return null;
}

function flattenUnion(variants: Json[]): Json | null {
  if (variants.length < 2 || !variants.every((variant) => variant.type === "object" && isObject(variant.properties))) return null;
  const key = discriminator(variants);
  if (!key) return null;
  const values: string[] = [];
  const properties: Json = {};
  // Each field's schema in every variant that has it: one when they agree, else anyOf of the distinct ones.
  const fieldSchemas: Record<string, unknown[]> = {};
  // Which fields each value needs, grouped: "insert_after, replace: block, markdown".
  const needs = new Map<string, string[]>();
  for (const variant of variants) {
    const props = variant.properties as Json;
    const value = String((props[key] as Json).const);
    values.push(value);
    for (const [name, schema] of Object.entries(props)) if (name !== key) (fieldSchemas[name] ??= []).push(slim(schema));
    const required = (Array.isArray(variant.required) ? variant.required : []).filter((name): name is string => typeof name === "string" && name !== key);
    const label = required.join(", ") || "nothing else";
    needs.set(label, [...(needs.get(label) ?? []), value]);
  }
  for (const [name, schemas] of Object.entries(fieldSchemas)) {
    const distinct = [...new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values()];
    properties[name] = distinct.length === 1 ? distinct[0] : { anyOf: distinct };
  }
  const note = [...needs.entries()].map(([fields, ops]) => `${ops.join("/")}: ${fields}`).join("; ");
  return { type: "object", properties: { [key]: { type: "string", enum: values, description: `Needs: ${note}` }, ...properties }, required: [key] };
}

/** A smaller JSON schema with the same meaning for a careful reader. */
export function slim(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(slim);
  if (!isObject(schema)) return schema;
  for (const unionKey of ["oneOf", "anyOf"] as const) {
    const union = schema[unionKey];
    if (Array.isArray(union) && union.every(isObject)) {
      const flat = flattenUnion(union as Json[]);
      if (flat) {
        const { [unionKey]: _drop, ...rest } = schema;
        return slim({ ...rest, ...flat });
      }
    }
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema") continue;
    if (key === "additionalProperties" && value === false) continue;
    out[key] = key === "properties" && isObject(value) ? Object.fromEntries(Object.entries(value).map(([name, each]) => [name, slim(each)])) : slim(value);
  }
  return out;
}

/** The slimmed schema when it is meaningfully smaller (at least 15% and 200 characters), else null. */
export function slimmedIfSmaller(schema: unknown): Json | null {
  if (!isObject(schema)) return null;
  const before = JSON.stringify(schema).length;
  const after = slim(schema) as Json;
  const size = JSON.stringify(after).length;
  return before - size >= 200 && size <= before * 0.85 ? after : null;
}
