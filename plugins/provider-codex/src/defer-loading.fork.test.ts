import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { DEFER_LOADING_MIN_CODEX, FORK_DEFER_LOADING_KEY, forkCodexDeferLoading, forkNoteCodexVersion } from "./defer-loading.fork.js";
import { toCodexDynamicTools } from "./session-params.js";

describe("deferred dynamic tools (defer-loading.fork.ts)", () => {
  afterEach(() => forkNoteCodexVersion(null));

  it("on the checked Codex, puts marked tools, deferred, into one namespace per name and keeps the key out of their schema", () => {
    forkNoteCodexVersion(DEFER_LOADING_MIN_CODEX);
    const schema = (extra: Record<string, unknown>) => ({ type: "object", properties: { q: { type: "string" } }, ...extra });
    expect(toCodexDynamicTools([
      { name: "pages_read", description: "Read a page.", inputSchema: { type: "object" } },
      { name: "design_ask", description: "Ask design questions.", inputSchema: schema({ [FORK_DEFER_LOADING_KEY]: "studio" }) },
      { name: "talk_read", description: "Read a recording.", inputSchema: schema({ [FORK_DEFER_LOADING_KEY]: "studio" }) },
      { name: "other_tool", description: "Another plugin's.", inputSchema: schema({ [FORK_DEFER_LOADING_KEY]: true }) },
    ])).toEqual([
      { type: "function", name: "pages_read", description: "Read a page.", inputSchema: { type: "object" } },
      { type: "namespace", name: "studio", description: "More studio tools, loaded when searched for.", tools: [
        { type: "function", name: "design_ask", description: "Ask design questions.", inputSchema: schema({}), deferLoading: true },
        { type: "function", name: "talk_read", description: "Read a recording.", inputSchema: schema({}), deferLoading: true },
      ] },
      { type: "namespace", name: "bb", description: "More bb tools, loaded when searched for.", tools: [
        { type: "function", name: "other_tool", description: "Another plugin's.", inputSchema: schema({}), deferLoading: true },
      ] },
    ]);
  });

  it("on an older or unknown Codex, sends every tool eagerly without the key", () => {
    const tools = [
      { name: "pages_read", description: "Read a page.", inputSchema: { type: "object" } },
      { name: "design_ask", description: "Ask design questions.", inputSchema: { type: "object", [FORK_DEFER_LOADING_KEY]: "studio" } },
    ];
    const eager = [
      { type: "function", name: "pages_read", description: "Read a page.", inputSchema: { type: "object" } },
      { type: "function", name: "design_ask", description: "Ask design questions.", inputSchema: { type: "object" } },
    ];
    for (const version of ["0.170.9", "0.136.0", "0.171.0-alpha.2", null, "not-a-version"]) {
      forkNoteCodexVersion(version);
      expect(toCodexDynamicTools(tools), String(version)).toEqual(eager);
    }
    forkNoteCodexVersion("0.172.1");
    expect(toCodexDynamicTools(tools)?.map((spec) => spec.type)).toEqual(["function", "namespace"]);
  });

  it("leaves a schema without a usable marker as it is", () => {
    expect(forkCodexDeferLoading({ type: "object", [FORK_DEFER_LOADING_KEY]: "bad name!" })).toEqual({ inputSchema: { type: "object", [FORK_DEFER_LOADING_KEY]: "bad name!" } });
    expect(forkCodexDeferLoading({ type: "object", [FORK_DEFER_LOADING_KEY]: false })).toEqual({ inputSchema: { type: "object", [FORK_DEFER_LOADING_KEY]: false } });
    expect(forkCodexDeferLoading(null)).toEqual({ inputSchema: null });
    expect(toCodexDynamicTools(undefined)).toBeUndefined();
  });
});
