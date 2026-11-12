// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { frameHtml, newNonce, presenceCsp, PRESENCE_SANDBOX, PresenceSandbox, WORKER_BLOCKED, workerSource, type SandboxFrame } from "./sandbox";

const NONCE = "abcdef0123456789abcdef0123456789";
const tick = { size: 36, dpr: 2, t: 1, state: { name: "idle" as const, workers: 0, clock: 1 }, palette: ["#ff0000", "#00ff00", "#0000ff"] as const };

function setup(code = "function draw() {}") {
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const onFail = vi.fn(), onReady = vi.fn(), onFrame = vi.fn<(frame: SandboxFrame) => void>();
  const sandbox = new PresenceSandbox({
    code, document, onFail, onReady, onFrame, nonce: NONCE,
    setTimer: (run, ms) => { const timer = { run, ms, live: true }; timers.push(timer); return timer; },
    clearTimer: (timer) => { (timer as { live: boolean }).live = false; },
  });
  document.body.append(sandbox.frame);
  const posted: unknown[] = [];
  vi.spyOn(sandbox.frame.contentWindow!, "postMessage").mockImplementation(((message: unknown) => { posted.push(message); }) as never);
  const say = (data: unknown, source: unknown = sandbox.frame.contentWindow) => window.dispatchEvent(new MessageEvent("message", { data, source: source as Window }));
  const fire = () => { const timer = timers.filter((each) => each.live).at(-1); timer!.live = false; timer!.run(); };
  const live = () => timers.filter((each) => each.live).map((each) => each.ms);
  return { sandbox, onFail, onReady, onFrame, posted, say, fire, live };
}

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("the sandbox document", () => {
  it("has a policy that allows the one inline script, blob workers and nothing from the network", () => {
    const csp = presenceCsp(NONCE);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'nonce-${NONCE}'`);
    expect(csp).toContain("worker-src blob:");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline'; script|https?:|\*/);
    expect(csp.split(";").find((part) => part.trim().startsWith("script-src"))).toBe(` script-src 'nonce-${NONCE}'`);
  });

  it("puts the policy before any script and gives the script the nonce", () => {
    const html = frameHtml("function draw() {}", NONCE);
    expect(html.indexOf("Content-Security-Policy")).toBeGreaterThan(0);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain(`<script nonce="${NONCE}">`);
    expect(() => frameHtml("function draw() {}", `x" onload="alert(1)`)).toThrow();
  });

  it("carries the module as data, so its text can't close the script or the page", () => {
    const hostile = `function draw() {} </script><script>parent.postMessage("x","*")</script><!--   & <img src=x onerror=1>`;
    const html = frameHtml(hostile, NONCE);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain("<img");
    expect(html).not.toContain(" ");
    const literal = /const SOURCE = ("(?:[^"\\]|\\.)*");/.exec(html)![1]!;
    expect(JSON.parse(literal)).toBe(workerSource(hostile));
  });

  it("runs the module in a worker whose network, messaging and timer globals are removed first", () => {
    const source = workerSource("function draw() {}");
    expect(source.indexOf("delete o[name]")).toBeLessThan(source.indexOf("function draw() {}"));
    expect(source.indexOf("function draw() {}")).toBeLessThan(source.indexOf("__presenceStart(typeof draw"));
    for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "navigator", "postMessage", "setTimeout", "setInterval", "indexedDB", "BroadcastChannel", "URL", "Blob"]) expect(WORKER_BLOCKED).toContain(name);
  });

  it("makes a fresh nonce each time", () => {
    expect(newNonce()).toMatch(/^[0-9a-f]{32}$/);
    expect(newNonce()).not.toBe(newNonce());
  });
});

describe("the sandbox frame", () => {
  it("is sealed: scripts only, no same origin, no pointer events, no referrer", () => {
    const { sandbox } = setup();
    expect(PRESENCE_SANDBOX).toBe("allow-scripts");
    expect(sandbox.frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(sandbox.frame.getAttribute("src")).toBeNull();
    expect(sandbox.frame.srcdoc).toContain("Content-Security-Policy");
    expect(sandbox.frame.getAttribute("style")).toContain("pointer-events:none");
    expect(sandbox.frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("is replaced when the module never starts", () => {
    const { sandbox, onFail, fire, live } = setup();
    expect(live()).toEqual([4000]);
    expect(sandbox.tick(tick)).toBe(false);
    fire();
    expect(onFail).toHaveBeenCalledWith("The presence did not start within 4000 ms.");
    expect(sandbox.failed).toBe(true);
    expect(sandbox.frame.isConnected).toBe(false);
  });

  it("ticks one frame at a time once ready, and hands back each frame", () => {
    const { sandbox, onReady, onFrame, posted, say, live } = setup();
    say({ presenceFrame: 1, type: "ready" });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(live()).toEqual([]);
    expect(sandbox.tick(tick)).toBe(true);
    expect(sandbox.tick(tick)).toBe(false);
    expect(posted).toEqual([{ type: "tick", n: 1, ...tick, read: false }]);
    expect(live()).toEqual([1500]);
    say({ presenceFrame: 1, type: "frame", n: 7, ms: 1 });
    expect(onFrame).not.toHaveBeenCalled();
    say({ presenceFrame: 1, type: "frame", n: 1, ms: 2.5 });
    expect(onFrame).toHaveBeenCalledWith({ n: 1, ms: 2.5 });
    expect(live()).toEqual([]);
    expect(sandbox.tick(tick)).toBe(true);
  });

  it("is replaced when a frame goes unanswered, when the module throws, or when it overruns its budget", () => {
    const stalled = setup();
    stalled.say({ presenceFrame: 1, type: "ready" });
    stalled.sandbox.tick(tick);
    stalled.fire();
    expect(stalled.onFail).toHaveBeenCalledWith("The presence did not answer within 1500 ms.");
    const thrown = setup();
    thrown.say({ presenceFrame: 1, type: "ready" });
    thrown.say({ presenceFrame: 1, type: "fail", reason: "A frame took longer than 120 ms." });
    expect(thrown.onFail).toHaveBeenCalledWith("A frame took longer than 120 ms.");
    expect(thrown.sandbox.tick(tick)).toBe(false);
    thrown.say({ presenceFrame: 1, type: "ready" });
    expect(thrown.sandbox.failed).toBe(true);
    expect(thrown.onFail).toHaveBeenCalledTimes(1);
  });

  it("listens only to its own frame, and only to well-formed messages", () => {
    const { sandbox, onReady, onFail, say } = setup();
    say({ presenceFrame: 1, type: "ready" }, window);
    say({ presenceFrame: 1, type: "fail", reason: "x" }, null);
    say({ type: "ready" });
    say("ready");
    say(null);
    expect(onReady).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
    expect(sandbox.ready).toBe(false);
  });

  it("reads pixels back only when they match the stated size", () => {
    const { sandbox, onFrame, say } = setup();
    say({ presenceFrame: 1, type: "ready" });
    sandbox.tick({ ...tick, read: true });
    say({ presenceFrame: 1, type: "frame", n: 1, ms: 1, width: 2, height: 2, pixels: new ArrayBuffer(16) });
    expect(onFrame.mock.calls[0]![0]).toMatchObject({ width: 2, height: 2 });
    expect(onFrame.mock.calls[0]![0].pixels).toHaveLength(16);
    sandbox.tick({ ...tick, read: true });
    say({ presenceFrame: 1, type: "frame", n: 2, ms: 1, width: 200, height: 200, pixels: new ArrayBuffer(16) });
    expect(onFrame.mock.calls[1]![0]).toEqual({ n: 2, ms: 1 });
  });

  it("stops listening and leaves the page when disposed", () => {
    const { sandbox, onReady, say, live } = setup();
    sandbox.dispose();
    say({ presenceFrame: 1, type: "ready" });
    expect(onReady).not.toHaveBeenCalled();
    expect(live()).toEqual([]);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
