import type { PresenceStateName } from "./forms";

export const PRESENCE_SANDBOX = "allow-scripts";
export const SANDBOX_TIMING = { startMs: 1500, frameMs: 120, readyMs: 4000, ackMs: 1500 } as const;
export type SandboxTiming = { [K in keyof typeof SANDBOX_TIMING]: number };

export const WORKER_BLOCKED = [
  "fetch", "XMLHttpRequest", "WebSocket", "WebSocketStream", "WebTransport", "EventSource", "importScripts", "Worker", "SharedWorker", "ServiceWorker",
  "navigator", "indexedDB", "caches", "BroadcastChannel", "MessageChannel", "MessagePort", "postMessage", "close", "setTimeout", "setInterval",
  "requestAnimationFrame", "queueMicrotask", "Request", "Response", "Headers", "RTCPeerConnection", "RTCDataChannel", "Notification", "FileReader",
  "FileReaderSync", "Blob", "File", "URL", "FontFace", "fonts", "location", "origin", "createImageBitmap", "reportError", "console", "crypto", "scheduler", "WebAssembly",
] as const;

const WORKER_PRE = `(() => {
  "use strict";
  const g = self;
  const post = g.postMessage.bind(g);
  const listen = g.addEventListener.bind(g);
  const Canvas = g.OffscreenCanvas;
  for (const name of ${JSON.stringify(WORKER_BLOCKED)}) {
    for (let o = g; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) { try { delete o[name]; } catch (e) {} }
    try { Object.defineProperty(g, name, { value: undefined, writable: false, configurable: false }); } catch (e) {}
  }
  let canvas = null, ctx = null, draw = null;
  const text = (error) => String((error && error.message) || error).slice(0, 300);
  listen("message", (event) => {
    const m = event.data;
    if (!m || m.type !== "tick" || !draw) return;
    try {
      const px = Math.max(1, Math.round(m.size * m.dpr));
      if (!canvas || canvas.width !== px) { canvas = new Canvas(px, px); ctx = canvas.getContext("2d"); }
      if (typeof ctx.reset === "function") ctx.reset(); else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, px, px); }
      ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
      draw(ctx, m.t, m.state, m.palette, m.size);
      const bitmap = canvas.transferToImageBitmap();
      post({ type: "frame", n: m.n, bitmap }, [bitmap]);
    } catch (error) {
      post({ type: "error", message: text(error) });
    }
  });
  Object.defineProperty(g, "__presenceStart", { configurable: false, writable: false, value: (fn) => {
    if (draw) return;
    if (typeof fn !== "function") { post({ type: "error", message: "The module has no draw function." }); return; }
    draw = fn;
    post({ type: "ready" });
  } });
})();
`;

const WORKER_POST = `
;__presenceStart(typeof draw === "function" ? draw : null);
`;

export function workerSource(code: string): string {
  return `${WORKER_PRE}\n${code}\n${WORKER_POST}`;
}

function frameScript(timing: SandboxTiming): string {
  return `(() => {
  "use strict";
  const view = document.getElementById("view");
  const shown = view.getContext("bitmaprenderer");
  const host = window.parent;
  const up = (message, transfer) => host.postMessage(Object.assign({ presenceFrame: 1 }, message), "*", transfer || []);
  let worker = null, dead = false, pending = null, timer = 0;
  const fail = (reason) => {
    if (dead) return;
    dead = true;
    clearTimeout(timer);
    try { if (worker) worker.terminate(); } catch (e) {}
    up({ type: "fail", reason: String(reason).slice(0, 300) });
  };
  try {
    worker = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" })));
  } catch (error) {
    fail("The module could not start: " + ((error && error.message) || error));
    return;
  }
  timer = setTimeout(() => fail("The module took longer than ${timing.startMs} ms to start."), ${timing.startMs});
  worker.onerror = (event) => { event.preventDefault(); fail(event.message || "The module failed to load."); };
  worker.onmessage = (event) => {
    const m = event.data;
    if (dead || !m) return;
    if (m.type === "ready") { clearTimeout(timer); up({ type: "ready" }); return; }
    if (m.type === "error") { fail(m.message); return; }
    if (m.type !== "frame" || !pending || m.n !== pending.n || !(m.bitmap instanceof ImageBitmap)) return;
    clearTimeout(timer);
    const ms = performance.now() - pending.at, read = pending.read, n = pending.n;
    pending = null;
    if (read) {
      const width = m.bitmap.width, height = m.bitmap.height;
      const scratch = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
      scratch.drawImage(m.bitmap, 0, 0);
      m.bitmap.close();
      const pixels = scratch.getImageData(0, 0, width, height).data.buffer;
      up({ type: "frame", n, ms, width, height, pixels }, [pixels]);
      return;
    }
    if (view.width !== m.bitmap.width) { view.width = m.bitmap.width; view.height = m.bitmap.height; }
    shown.transferFromImageBitmap(m.bitmap);
    up({ type: "frame", n, ms });
  };
  window.addEventListener("message", (event) => {
    if (event.source !== host || dead) return;
    const m = event.data;
    if (!m || m.type !== "tick" || pending) return;
    pending = { n: m.n, at: performance.now(), read: !!m.read };
    timer = setTimeout(() => fail("A frame took longer than ${timing.frameMs} ms."), ${timing.frameMs});
    worker.postMessage({ type: "tick", n: m.n, size: m.size, dpr: m.dpr, t: m.t, state: m.state, palette: m.palette });
  });
})();`;
}

export function presenceCsp(nonce: string): string {
  return `default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
}

function inlineJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function frameHtml(code: string, nonce: string, timing: SandboxTiming = SANDBOX_TIMING): string {
  if (!/^[A-Za-z0-9]{16,64}$/.test(nonce)) throw new Error("A nonce is 16 to 64 letters and digits.");
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${presenceCsp(nonce)}">`,
    `<meta charset="utf-8"><meta name="color-scheme" content="light dark">`,
    "<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}</style>",
    `</head><body><canvas id="view" width="1" height="1"></canvas>`,
    `<script nonce="${nonce}">const SOURCE = ${inlineJson(workerSource(code))};\n${frameScript(timing)}</script>`,
    "</body></html>",
  ].join("");
}

export function newNonce(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  return [...random(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface SandboxTick {
  size: number;
  dpr: number;
  t: number;
  state: { name: PresenceStateName; workers: number; clock: number };
  palette: readonly [string, string, string];
  read?: boolean;
}

export interface SandboxFrame { n: number; ms: number; width?: number; height?: number; pixels?: Uint8ClampedArray }

export interface SandboxOptions {
  code: string;
  document: Document;
  onFail(reason: string): void;
  onReady?(): void;
  onFrame?(frame: SandboxFrame): void;
  timing?: SandboxTiming;
  nonce?: string;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export class PresenceSandbox {
  readonly frame: HTMLIFrameElement;
  private state: "starting" | "ready" | "failed" | "disposed" = "starting";
  private pending: number | null = null;
  private count = 0;
  private timer: unknown = null;
  private readonly timing: SandboxTiming;
  private readonly view: Window;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: SandboxOptions) {
    this.timing = options.timing ?? SANDBOX_TIMING;
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    const doc = options.document;
    this.view = doc.defaultView!;
    const frame = doc.createElement("iframe");
    frame.setAttribute("sandbox", PRESENCE_SANDBOX);
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("title", "Presence");
    frame.setAttribute("data-presence-sandbox", "");
    frame.setAttribute("style", "display:block;width:100%;height:100%;border:0;background:transparent;pointer-events:none");
    frame.srcdoc = frameHtml(options.code, options.nonce ?? newNonce(), this.timing);
    this.frame = frame;
    this.view.addEventListener("message", this.onMessage);
    this.arm(this.timing.readyMs, `The presence did not start within ${this.timing.readyMs} ms.`);
  }

  get ready(): boolean { return this.state === "ready"; }
  get failed(): boolean { return this.state === "failed"; }
  get busy(): boolean { return this.pending !== null; }

  tick(tick: SandboxTick): boolean {
    if (this.state !== "ready" || this.pending !== null) return false;
    const target = this.frame.contentWindow;
    if (!target) return false;
    const n = ++this.count;
    this.pending = n;
    this.arm(this.timing.ackMs, `The presence did not answer within ${this.timing.ackMs} ms.`);
    target.postMessage({ type: "tick", n, size: tick.size, dpr: tick.dpr, t: tick.t, state: tick.state, palette: tick.palette, read: !!tick.read }, "*");
    return true;
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposed";
    this.disarm();
    this.view.removeEventListener("message", this.onMessage);
    this.frame.remove();
  }

  private arm(ms: number, reason: string): void {
    this.disarm();
    this.timer = this.setTimer(() => this.fail(reason), ms);
  }

  private disarm(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private fail(reason: string): void {
    if (this.state === "failed" || this.state === "disposed") return;
    this.state = "failed";
    this.pending = null;
    this.disarm();
    this.view.removeEventListener("message", this.onMessage);
    this.frame.remove();
    this.options.onFail(reason);
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (event.source !== this.frame.contentWindow || this.state === "failed" || this.state === "disposed") return;
    const data = event.data as { presenceFrame?: unknown; type?: unknown; reason?: unknown; n?: unknown; ms?: unknown; width?: unknown; height?: unknown; pixels?: unknown } | null;
    if (!data || typeof data !== "object" || data.presenceFrame !== 1) return;
    if (data.type === "fail") { this.fail(typeof data.reason === "string" ? data.reason.slice(0, 300) : "The presence failed."); return; }
    if (data.type === "ready" && this.state === "starting") {
      this.state = "ready";
      this.disarm();
      this.options.onReady?.();
      return;
    }
    if (data.type !== "frame" || this.pending === null || data.n !== this.pending) return;
    const n = this.pending;
    this.pending = null;
    this.disarm();
    const ms = typeof data.ms === "number" && Number.isFinite(data.ms) ? data.ms : 0;
    const pixels = data.pixels instanceof ArrayBuffer && typeof data.width === "number" && typeof data.height === "number" && data.pixels.byteLength === data.width * data.height * 4
      ? { width: data.width, height: data.height, pixels: new Uint8ClampedArray(data.pixels) } : {};
    this.options.onFrame?.({ n, ms, ...pixels });
  };
}
