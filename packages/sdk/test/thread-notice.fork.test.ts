import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

describe("threads.send with a notice (BB Studio)", () => {
  it("sends experimental_notice in the body, and nothing extra without one", async () => {
    const bodies: unknown[] = [];
    const fetch: FetchImplementation = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ ok: true, delivery: "sent", messageSequence: 1 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch,
        runtime: "node",
      }),
    });
    const input = [
      {
        type: "text" as const,
        text: "Watcher Kensico health: ok",
        mentions: [],
      },
    ];
    await sdk.threads.send({
      threadId: "thr_1",
      mode: "auto",
      input,
      experimental_notice: { source: "watcher", label: "Kensico health" },
    });
    await sdk.threads.send({ threadId: "thr_1", mode: "auto", input });
    expect(bodies[0]).toMatchObject({
      experimental_notice: { source: "watcher", label: "Kensico health" },
    });
    expect(bodies[1]).not.toHaveProperty("experimental_notice");
  });
});
