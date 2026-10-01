import { createTestStore } from "./test-store";
import { test } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  createFakePluginHost,
  makeThreadResponse,
  makePluginAgentConfigurationContext,
  makeMessageDispatchHookContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { agentAuthor, requestStatus } from "../agent-channels";
import { channelWork } from "../channel-work";
import { Store, document, saveDocument } from "../store";
import { Runtime, jobPrompt, mentioned, recipients } from "../runtime";
import { profileInput, roomSchema, type Bot, type Conversation, type Room } from "../contract";
import { channelHandoffText } from "../handoff-draft";
import { directMessageId } from "../direct-messages";

export const bot = (
  home: string,
  id = "bot_0123456789abcdef",
  name = "Atlas",
): Bot => ({
  ...profileInput.parse({ name }),
  id,
  handle: name.toLowerCase(),
  home,
  hostId: "host_test",
  projectId: "proj_test",
  createdAt: 1,
  updatedAt: 1,
  lastWakeAt: Date.now(),
  error: null,
});
export const setup = () => {
  let sequence = 0;
  const pendingDirectStarts = new Map<string, string>();
  const host = createFakePluginHost({
    pluginId: "bot-teams",
    agentSkillIds: ["bots"],
    sdk: {
      plugins: { callRpc: async (args) => args.outputSchema.parse([]) },
      projects: {
        list: async () => [{ id: "proj_personal", kind: "personal", name: "Personal", sources: [], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 }],
        attachments: {
          upload: async (args) => ({
            path: `uploaded-${args.filename}`,
            name: args.filename!,
            type: "localFile" as const,
            mimeType: "text/plain",
            sizeBytes: 5,
          }),
        },
      },
      threads: {
        spawn: async (args) => {
          assert.equal(args.executionInputSources?.providerId, "explicit");
          assert.equal(args.executionInputSources?.reasoningLevel, "explicit");
          if (args.model)
            assert.equal(args.executionInputSources?.model, "explicit");
          assert.ok(args.input?.length, "BB requires an input entry");
          const emptyDirect = args.input?.length === 1 &&
            args.input[0]?.type === "text" && args.input[0].text === "";
          if (!emptyDirect)
            assert.ok(
              args.input?.some((i) => i.type === "text" && i.text.trim()),
              "BB requires nonempty first input",
            );
          if (args.origin === "sdk" && args.visibility === "hidden")
            assert.equal(
              args.sendAt,
              undefined,
              "Title work should run immediately",
            );
          else
            assert.ok(
              args.sendAt! > Date.now(),
              "Registration must precede dispatch",
            );
          const id = `thr_bot_${++sequence}`;
          if (emptyDirect) pendingDirectStarts.set(id, `start_${id}`);
          return makeThreadResponse({
            id,
            status: "idle",
          });
        },
        send: async () => ({ ok: true, delivery: "sent" }),
        get: async () => makeThreadResponse({ status: "idle" }),
        list: async () => [],
        stop: async () => ({ ok: true }),
        update: async () => makeThreadResponse({ status: "idle" }),
        queuedMessages: {
          list: async ({ threadId }) => {
            const id = pendingDirectStarts.get(threadId);
            return id ? [{
              id,
              content: [{ type: "text", text: "" }],
              model: "default-model",
              reasoningLevel: "medium",
            }] : [];
          },
          delete: async ({ threadId }) => {
            pendingDirectStarts.delete(threadId);
            return { ok: true };
          },
        },
      },
    },
  });
  const store = createTestStore(host.bb.storage.database()),
    a = bot("/tmp/a"),
    b = bot("/tmp/b", "bot_1123456789abcdef", "Scribe");
  store.put(a);
  store.put(b);
  const runtime = new Runtime(host.bb, store),
    room: Room = {
      id: randomUUID(),
      name: "Research",
      memberIds: [a.id, b.id],
      paused: false,
      createdAt: 1,
      updatedAt: 1,
    };
  store.putRoom(room);
  const close = async () => {
    await runtime.dispose();
    await host.harness.lifecycle.dispose();
  };
  return { ...host, store, a, b, runtime, room, close };
};


export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
