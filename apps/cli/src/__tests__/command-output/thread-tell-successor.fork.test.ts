import { describe, expect, it, vi } from "vitest";
import * as fixtures from "../helpers/command-output-fixtures.js";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

function archivedRefusal(successor: { id: string; title: string } | null) {
  return new Response(
    JSON.stringify({
      code: "thread_not_writable",
      message:
        successor === null
          ? "Thread is archived"
          : `Thread is archived. It continues in thread ${successor.id}.`,
      details: {
        reason: "archived",
        archivedAt: 1,
        threadStatus: "idle",
        ...(successor === null
          ? {}
          : {
              successorThreadId: successor.id,
              successorTitle: successor.title,
            }),
      },
    }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

const errors = () =>
  vi.mocked(console.error).mock.calls.map((call) => String(call[0]));

describe("bb thread tell to an archived thread", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("names the live thread that continues it", async () => {
    const post = vi.fn(async () =>
      archivedRefusal({ id: "thread-live", title: "Lead (v2)" }),
    );
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await expect(
      runCommand(["thread", "tell", "thread-old", "hello"], register),
    ).rejects.toThrow("process.exit:1");

    expect(post).toHaveBeenCalledTimes(1);
    expect(errors()).toEqual([
      'Error: Thread thread-old is archived. It continues in thread thread-live ("Lead (v2)").',
      "Send there with `bb thread tell thread-live`, or add --follow-successor.",
    ]);
  });

  it("sends to the successor with --follow-successor, once", async () => {
    const post = vi.fn(async (request: { param: { id: string } }) =>
      request.param.id === "thread-old"
        ? archivedRefusal({ id: "thread-live", title: "Lead (v2)" })
        : { ok: true, delivery: "sent" },
    );
    stubServerApi({ "v1.threads.:id.send.$post": post });

    await runCommand(
      ["thread", "tell", "thread-old", "hello", "--follow-successor", "--json"],
      register,
    );

    expect(post.mock.calls.map(([request]) => request.param.id)).toEqual([
      "thread-old",
      "thread-live",
    ]);
    expect(errors()).toEqual([
      "Thread thread-old is archived; sent to thread thread-live, which continues it.",
    ]);
    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual({
      threadId: "thread-live",
      redirectedFrom: "thread-old",
      ok: true,
      delivery: "sent",
      mode: "steer",
    });
  });

  it("says how to find the live thread when no handoff names one", async () => {
    const post = vi.fn(async () => archivedRefusal(null));
    stubServerApi({
      "v1.threads.:id.$get": async () =>
        fixtures.makeThread({
          id: "thread-old",
          projectId: "proj-1",
          providerId: "codex",
        }),
      "v1.threads.:id.send.$post": post,
    });

    await expect(
      runCommand(
        ["thread", "tell", "thread-old", "hello", "--follow-successor"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(post).toHaveBeenCalledTimes(1);
    expect(errors()).toEqual([
      "Error: Thread thread-old is archived, and no handoff names a thread that continues it.",
      "Find the live thread with `bb thread list --project proj-1`, or unarchive this one with `bb thread unarchive thread-old`.",
    ]);
  });

  it("leaves other refusals as they were", async () => {
    stubServerApi({
      "v1.threads.:id.send.$post": async () =>
        new Response(
          JSON.stringify({
            code: "thread_not_writable",
            message: "Thread is stopping",
            details: {
              reason: "stopping",
              archivedAt: null,
              threadStatus: "stopping",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    });

    await expect(
      runCommand(["thread", "tell", "thread-old", "hello"], register),
    ).rejects.toThrow("process.exit:1");

    expect(errors()).toEqual(["Error: HTTP 409: Thread is stopping"]);
  });
});
