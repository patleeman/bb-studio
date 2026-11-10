import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEnvironment, getThread, listEvents } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  threadResponseSchema,
  threadTimelineResponseSchema,
} from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import {
  MIRRORED_THREAD_MESSAGE,
  setForkImportDataDir,
} from "../../src/services/fork-import/index.js";
import {
  closeForkImportDatabases,
  FORK_IMPORT_STATE_FILE_NAME,
  openForkImportDatabase,
} from "../../src/services/fork-import/state.js";
import { ensureThreadIsWritable } from "../../src/services/threads/thread-send.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedEvent,
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const BB_HOST = "host-bb";
const STUDIO_HOST = "host-studio";
const SESSION = "provider-mirrored-conversation";
const TURNS = 30;
const PATH = "/tmp/mirrored-conversation";

afterEach(() => {
  setForkImportDataDir(null);
  closeForkImportDatabases();
});

function seedTurn(
  harness: TestAppHarness,
  base: { environmentId: string; threadId: string },
  turn: number,
  sequence: number,
): number {
  const ids = { ...base, providerThreadId: SESSION };
  const turnId = `turn-${turn}`;
  const requestId = encodeClientTurnRequestIdNumber({ value: turn });
  if (turn > 1) {
    seedEvent(harness.deps, {
      ...ids,
      sequence: sequence++,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId,
        input: [{ type: "text", text: `question ${turn}` }],
        target: { kind: "new-turn" },
        execution: {
          model: "claude-opus",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
        initiator: "user",
        senderThreadId: null,
        request: { method: "turn/start", params: {} },
        source: "tell",
      },
    });
  }
  seedTurnStarted(harness.deps, { ...ids, sequence: sequence++, turnId });
  seedEvent(harness.deps, {
    ...ids,
    sequence: sequence++,
    type: "turn/input/accepted",
    scope: turnScope(turnId),
    data: { providerThreadId: SESSION, clientRequestId: requestId },
  });
  seedEvent(harness.deps, {
    ...ids,
    sequence: sequence++,
    type: "item/completed",
    scope: turnScope(turnId),
    data: {
      providerThreadId: SESSION,
      item: {
        type: "agentMessage",
        id: `reply-${turn}`,
        text: `reply ${turn}`,
      },
    },
  });
  seedEvent(harness.deps, {
    ...ids,
    sequence: sequence++,
    type: "turn/completed",
    scope: turnScope(turnId),
    data: {
      providerThreadId: SESSION,
      status: "completed",
      providerCheckpointId: `checkpoint-${turn}`,
    },
  });
  return sequence;
}

function seedMirroredConversation(harness: TestAppHarness) {
  seedHostSession(harness.deps, { id: STUDIO_HOST });
  seedPrimaryHost(harness.deps, STUDIO_HOST);
  seedHost(harness.deps, { id: BB_HOST });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: BB_HOST,
    path: PATH,
  });
  const mirrored = seedEnvironment(harness.deps, {
    hostId: BB_HOST,
    projectId: project.id,
    path: PATH,
  });
  const here = seedEnvironment(harness.deps, {
    hostId: STUDIO_HOST,
    projectId: project.id,
    path: PATH,
  });
  const conversation = (title: string) => {
    const thread = seedThread(harness.deps, {
      environmentId: mirrored.id,
      projectId: project.id,
      providerId: "claude-code",
      title,
    });
    seedThreadRuntimeState(harness.deps, {
      environmentId: mirrored.id,
      inputText: "question 1",
      providerThreadId: SESSION,
      threadId: thread.id,
    });
    let sequence = 3;
    for (let turn = 1; turn <= TURNS; turn++) {
      sequence = seedTurn(
        harness,
        { environmentId: mirrored.id, threadId: thread.id },
        turn,
        sequence,
      );
    }
    return thread;
  };
  const thread = conversation("Chief of Staff");
  const unmirrored = conversation("Not mirrored");
  const dataDir = harness.config.dataDir;
  writeFileSync(
    join(dataDir, FORK_IMPORT_STATE_FILE_NAME),
    JSON.stringify({
      version: 1,
      sourceDataDir: join(dataDir, "no-bb-here"),
      sourceServerHostId: BB_HOST,
      importedAt: 1,
      sourceEventRowid: 0,
    }),
  );
  openForkImportDatabase(dataDir)
    .prepare(
      "INSERT INTO mirrored_threads (thread_id, source_updated_at, source_status, taken_over_at) VALUES (?, 1, 'idle', NULL)",
    )
    .run(thread.id);
  setForkImportDataDir(dataDir);
  return { here, mirrored, thread, unmirrored };
}

async function findReply(
  harness: TestAppHarness,
  threadId: string,
  text: string,
) {
  let cursor: { anchorSeq: number; anchorId: string } | null = null;
  let pages = 0;
  for (;;) {
    const query = new URLSearchParams({ segmentLimit: "20" });
    if (cursor) {
      query.set("beforeAnchorSeq", String(cursor.anchorSeq));
      query.set("beforeAnchorId", cursor.anchorId);
    }
    const response = await harness.app.request(
      `/api/v1/threads/${threadId}/timeline?${query}`,
    );
    expect(response.status).toBe(200);
    const body = (await readJson(response)) as {
      timelinePage: Record<string, unknown>;
    };
    expect(body.timelinePage).not.toHaveProperty("hasOlderRows");
    const page = threadTimelineResponseSchema.parse(body);
    pages++;
    const row = page.rows.find(
      (each) =>
        each.kind === "conversation" &&
        each.role === "assistant" &&
        each.text === text,
    );
    if (row) return { row, pages };
    cursor = page.timelinePage?.olderCursor ?? null;
    if (!cursor) throw new Error(`No reply "${text}"`);
  }
}

async function fork(harness: TestAppHarness, body: Record<string, unknown>) {
  return harness.app.request("/api/v1/threads/fork", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function conversationTexts(harness: TestAppHarness, threadId: string) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline?segmentLimit=100`,
  );
  const page = threadTimelineResponseSchema.parse(await readJson(response));
  return page.rows.flatMap((row) =>
    row.kind === "conversation" ? [row.text] : [],
  );
}

describe("a thread from a mirrored conversation's message", () => {
  it("finds an older Bot reply past the first page and seeds a thread on this machine up to it", async () => {
    await withTestHarness(async (harness) => {
      const { here, mirrored, thread } = seedMirroredConversation(harness);

      const { row, pages } = await findReply(harness, thread.id, "reply 3");
      expect(pages).toBeGreaterThan(1);
      expect(row.id.startsWith(`${thread.id}:assistant:`)).toBe(true);

      const reused = await fork(harness, {
        sourceThreadId: thread.id,
        sourceSeqEnd: row.sourceSeqEnd,
        visibility: "visible",
      });
      expect(reused.status).toBe(502);

      const response = await fork(harness, {
        sourceThreadId: thread.id,
        sourceSeqEnd: row.sourceSeqEnd,
        visibility: "visible",
        environment: { type: "reuse", environmentId: here.id },
      });
      expect(response.status).toBe(201);
      const seeded = threadResponseSchema.parse(await readJson(response));
      expect(seeded.sourceThreadId).toBe(thread.id);
      expect(seeded.environmentId).toBe(here.id);
      expect(getEnvironment(harness.db, here.id)?.hostId).toBe(STUDIO_HOST);
      expect(getThread(harness.db, seeded.id)?.status).not.toBe("active");

      expect(await conversationTexts(harness, seeded.id)).toEqual([
        "question 1",
        "reply 1",
        "question 2",
        "reply 2",
        "question 3",
        "reply 3",
      ]);
      const copied = listEvents(harness.db, { threadId: seeded.id });
      expect(
        copied.filter((event) => event.type === "turn/started"),
      ).toHaveLength(3);

      expect(getEnvironment(harness.db, mirrored.id)?.hostId).toBe(BB_HOST);
      expect(() =>
        ensureThreadIsWritable(getThread(harness.db, thread.id)!),
      ).toThrow(MIRRORED_THREAD_MESSAGE);
      expect(() =>
        ensureThreadIsWritable(getThread(harness.db, seeded.id)!),
      ).not.toThrow();
    });
  });

  it("keeps a thread that is not mirrored on its own machine", async () => {
    await withTestHarness(async (harness) => {
      const { here, unmirrored } = seedMirroredConversation(harness);
      const { row } = await findReply(harness, unmirrored.id, "reply 3");

      const response = await fork(harness, {
        sourceThreadId: unmirrored.id,
        sourceSeqEnd: row.sourceSeqEnd,
        visibility: "visible",
        environment: { type: "reuse", environmentId: here.id },
      });
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        message: `Fork environment must use the source thread's host (${BB_HOST}), not ${STUDIO_HOST}`,
      });
    });
  });
});
