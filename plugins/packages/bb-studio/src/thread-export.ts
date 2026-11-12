import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const THREAD_EXPORT_FORMAT_VERSION = 1;
const EVENT_PAGE_SIZE = 100;
const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface ThreadExport {
  threadId: string;
  path: string;
  eventCount: number;
  bytes: number;
  sha256: string;
}

const headerLineSchema = z.object({
  kind: z.literal("thread"),
  formatVersion: z.literal(THREAD_EXPORT_FORMAT_VERSION),
  thread: z.object({ id: z.string() }),
});
const eventLineSchema = z.object({
  kind: z.literal("event"),
  event: z.object({ seq: z.number() }),
});

function isEventDataTooLarge(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 413
  );
}

async function readEventPage(
  bb: BbPluginApi,
  threadId: string,
  afterSeq: number | null,
  pageSize: number,
) {
  for (let limit = pageSize; ; limit = Math.ceil(limit / 2)) {
    try {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        order: "asc",
        limit: String(limit),
        ...(afterSeq === null ? {} : { afterSeq: String(afterSeq) }),
      });
      return { rows, limit };
    } catch (error) {
      if (!isEventDataTooLarge(error) || limit === 1) throw error;
    }
  }
}

async function verifyExport(
  file: string,
  expected: { threadId: string; eventCount: number; sha256: string },
) {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  stream.on("data", (chunk) => hash.update(chunk));
  let lineNumber = 0;
  let eventCount = 0;
  let lastSeq = -1;
  for await (const line of createInterface({
    input: stream,
    crlfDelay: Infinity,
  })) {
    lineNumber++;
    const parsed: unknown = JSON.parse(line);
    if (lineNumber === 1) {
      const header = headerLineSchema.parse(parsed);
      if (header.thread.id !== expected.threadId)
        throw new Error(`Export header names thread ${header.thread.id}.`);
      continue;
    }
    const { event } = eventLineSchema.parse(parsed);
    if (event.seq <= lastSeq)
      throw new Error(`Export line ${lineNumber} is out of order.`);
    lastSeq = event.seq;
    eventCount++;
  }
  if (lineNumber === 0) throw new Error("Export file is empty.");
  if (eventCount !== expected.eventCount)
    throw new Error(
      `Export holds ${eventCount} events; ${expected.eventCount} were read.`,
    );
  if (hash.digest("hex") !== expected.sha256)
    throw new Error("Export file does not match what was written.");
}

export async function exportThread(
  bb: BbPluginApi,
  args: { threadId: string; directory: string; now: number },
): Promise<ThreadExport> {
  if (!THREAD_ID_PATTERN.test(args.threadId))
    throw new Error(`Cannot export thread id ${args.threadId}.`);
  if (!path.isAbsolute(args.directory))
    throw new Error("The export folder must be an absolute path.");
  await mkdir(args.directory, { recursive: true });
  const finalPath = path.join(args.directory, `${args.threadId}.jsonl`);
  const partialPath = `${finalPath}.partial`;
  const thread = await bb.sdk.threads.get({ threadId: args.threadId });
  const hash = createHash("sha256");
  let bytes = 0;
  let eventCount = 0;
  const file = await open(partialPath, "w");
  try {
    const writeLine = async (value: unknown) => {
      const line = `${JSON.stringify(value)}\n`;
      hash.update(line);
      bytes += Buffer.byteLength(line);
      await file.write(line);
    };
    await writeLine({
      kind: "thread",
      formatVersion: THREAD_EXPORT_FORMAT_VERSION,
      exportedAt: args.now,
      thread,
    });
    let afterSeq: number | null = null;
    let pageSize = EVENT_PAGE_SIZE;
    for (;;) {
      const page = await readEventPage(bb, args.threadId, afterSeq, pageSize);
      for (const event of page.rows) await writeLine({ kind: "event", event });
      eventCount += page.rows.length;
      if (page.rows.length < page.limit) break;
      afterSeq = page.rows[page.rows.length - 1]!.seq;
      pageSize = Math.min(EVENT_PAGE_SIZE, page.limit * 2);
    }
    await file.sync();
  } catch (error) {
    await file.close();
    await rm(partialPath, { force: true });
    throw error;
  }
  await file.close();
  const sha256 = hash.digest("hex");
  try {
    await verifyExport(partialPath, {
      threadId: args.threadId,
      eventCount,
      sha256,
    });
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
  await rename(partialPath, finalPath);
  return {
    threadId: args.threadId,
    path: finalPath,
    eventCount,
    bytes,
    sha256,
  };
}
