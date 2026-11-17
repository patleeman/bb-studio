import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

function recordingSdk() {
  const urls: string[] = [];
  const fetch: FetchImplementation = async (input) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  });
  return { sdk, urls };
}

describe("threads.compact (BB Studio)", () => {
  it("sends the reason as the compact route's query", async () => {
    const { sdk, urls } = recordingSdk();
    await sdk.threads.compact({
      threadId: "thr_1",
      reason: "cache warming ended",
    });
    const url = new URL(urls[0]!);
    expect(url.pathname).toBe("/api/v1/threads/thr_1/compact");
    expect(url.searchParams.get("reason")).toBe("cache warming ended");
  });

  it("sends no query without a reason", async () => {
    const { sdk, urls } = recordingSdk();
    await sdk.threads.compact({ threadId: "thr_1" });
    expect(new URL(urls[0]!).search).toBe("");
  });
});
