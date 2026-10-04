import { describe, expect, it } from "vitest";
import { audioResponse } from "./audio-response";

const bytes = new TextEncoder().encode("0123456789");
describe("seekable audio responses", () => {
  it("serves a complete clip with its size and range support", async () => {
    const response = audioResponse(bytes, "audio/webm;codecs=opus");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/webm");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("0123456789");
  });
  it.each([["bytes=3-5", "345", "bytes 3-5/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-99", "89", "bytes 8-9/10"]])("serves %s", async (range, body, contentRange) => {
    const response = audioResponse(bytes, "audio/mp4", range);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(await response.text()).toBe(body);
  });
  it.each(["bytes=10-", "bytes=8-2", "bytes=-0", "bytes=-"])("rejects unsatisfiable %s", (range) => {
    const response = audioResponse(bytes, "audio/mp4", range);
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });
});
