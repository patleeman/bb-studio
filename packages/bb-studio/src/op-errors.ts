// The error a tool with ops returns when an op is missing a field it needs.
// The schema can't say which fields each op needs without growing a lot (a
// discriminated union per op), so each tool checks in execute and answers
// the same way: an error result naming the op and the fields.

export type OpError = { content: { type: "text"; text: string }[]; isError: true };

const list = (fields: readonly string[]) =>
  fields.length <= 1 ? (fields[0] ?? "") : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`;

/** `op "create" needs block and text.`, as an error result. */
export function opNeeds(op: string, fields: readonly string[], hint?: string): OpError {
  return { content: [{ type: "text", text: `op "${op}" needs ${list(fields)}.${hint ? ` ${hint}` : ""}` }], isError: true };
}
