// The result cap, shared by Studio's server and the host worker: the worker
// cuts a result before it crosses to the server, and the server cuts again.
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

export interface CallResult {
  content: JsonRecord[];
  isError?: boolean;
  structuredContent?: unknown;
  truncated?: boolean;
}

/** The result an agent gets: content blocks, capped at the result limit with a note. */
export function capResult(result: unknown, maxBytes: number): CallResult {
  const record = asRecord(result) ?? {};
  const content = (Array.isArray(record.content) ? record.content : []).filter((item): item is JsonRecord => asRecord(item) !== undefined);
  const out: CallResult = { content };
  if (typeof record.isError === "boolean") out.isError = record.isError;
  if (record.structuredContent !== undefined) out.structuredContent = record.structuredContent;
  const size = Buffer.byteLength(JSON.stringify(out), "utf8");
  if (size <= maxBytes) return out;
  // Keep text blocks in order until the cap, then a note.
  const kept: JsonRecord[] = [];
  let used = 0;
  for (const block of content) {
    const text = typeof block.text === "string" ? block.text : null;
    const blockSize = Buffer.byteLength(JSON.stringify(block), "utf8");
    if (used + blockSize <= maxBytes) {
      kept.push(block);
      used += blockSize;
      continue;
    }
    if (text !== null && maxBytes - used > 256) {
      const room = maxBytes - used - 256;
      kept.push({ ...block, text: Buffer.from(text, "utf8").subarray(0, room).toString("utf8").replace(/�$/u, "") });
    }
    break;
  }
  kept.push({ type: "text", text: `[Tool Gateway: the result was ${Math.round(size / 1024)} KB, over the ${Math.round(maxBytes / 1024)} KB limit; this is the first part.]` });
  return { content: kept, ...(out.isError === undefined ? {} : { isError: out.isError }), truncated: true };
}
