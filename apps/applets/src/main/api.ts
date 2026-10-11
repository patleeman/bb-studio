// The main-process side of `window.studio`. Every call names a method; the
// caller is identified by its renderer, never by anything it sends, and the
// method's capability must be approved for that applet.
import { clipboard, Notification, shell } from "electron";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appletsRpc, pluginRpc } from "./bb";
import { dataDir, resolveInside, root } from "./paths";
import type { Runtime } from "./runtime";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Context = { id: string; window: string | null; granted: Set<string>; runtime: Runtime };
type Handler = (args: unknown[], ctx: Context) => unknown;

const MAX_STORAGE_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function str(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new ApiError("invalid_argument", `${name} must be a non-empty string`);
  return value;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function windowKind(ctx: Context, name: string): string {
  const spec = ctx.runtime.running.get(ctx.id)?.applet.manifest.windows[name];
  if (!spec) throw new ApiError("invalid_argument", `No window "${name}" in the manifest`);
  return `window.${spec.kind}`;
}

function need(ctx: Context, capability: string): void {
  if (!ctx.granted.has(capability)) throw new ApiError("capability_denied", `${capability} isn't approved for this applet`, { capability });
}

function dataPath(ctx: Context, path: unknown): string {
  const base = dataDir(ctx.id);
  const full = resolveInside(base, str(path, "path"));
  if (!full) throw new ApiError("invalid_argument", "path must stay inside the applet's data folder");
  return full;
}

const storagePath = (id: string) => join(root, ".storage", `${id}.json`);

async function readStorage(id: string): Promise<Record<string, unknown>> {
  try {
    return obj(JSON.parse(await readFile(storagePath(id), "utf8")));
  } catch {
    return {};
  }
}

/** Methods, each with the capability it needs (null: always available). */
const METHODS: Record<string, { capability: string | null | ((args: unknown[], ctx: Context) => string); run: Handler }> = {
  log: {
    capability: null,
    run: ([level, ...rest], ctx) => ctx.runtime.log(ctx.id, ["info", "warn", "error"].includes(String(level)) ? String(level) : "info", ...rest),
  },
  // BB events are pushed to applets that can read threads; asking is a no-op.
  "events.want": { capability: null, run: () => null },
  "storage.get": { capability: null, run: async ([key], ctx) => (await readStorage(ctx.id))[str(key, "key")] ?? null },
  "storage.set": {
    capability: null,
    run: async ([key, value], ctx) => {
      const data = { ...(await readStorage(ctx.id)), [str(key, "key")]: value };
      const text = JSON.stringify(data);
      if (Buffer.byteLength(text) > MAX_STORAGE_BYTES) throw new ApiError("too_large", "storage is limited to 1 MB per applet");
      await mkdir(join(root, ".storage"), { recursive: true });
      await writeFile(storagePath(ctx.id), text);
      return null;
    },
  },

  "window.open": { capability: ([name], ctx) => windowKind(ctx, str(name, "name")), run: ([name], ctx) => void ctx.runtime.openWindow(ctx.id, str(name, "name")) },
  "window.close": {
    capability: ([name], ctx) => windowKind(ctx, str(name ?? ctx.window, "name")),
    run: ([name], ctx) => ctx.runtime.closeWindow(ctx.id, str(name ?? ctx.window, "name")),
  },
  "window.hide": {
    capability: ([name], ctx) => windowKind(ctx, str(name ?? ctx.window, "name")),
    run: ([name], ctx) => ctx.runtime.window(ctx.id, str(name ?? ctx.window, "name")).hide(),
  },
  "window.toggle": {
    capability: ([name], ctx) => windowKind(ctx, str(name ?? ctx.window, "name")),
    run: ([name], ctx) => {
      const windowName = str(name ?? ctx.window, "name");
      const open = ctx.runtime.running.get(ctx.id)?.windows.get(windowName);
      if (open && !open.isDestroyed() && open.isVisible()) open.hide();
      else ctx.runtime.openWindow(ctx.id, windowName);
    },
  },
  "window.setBounds": {
    capability: ([name], ctx) => windowKind(ctx, str(name, "name")),
    run: ([name, rect], ctx) => {
      const r = obj(rect);
      const bounds = Object.fromEntries(["x", "y", "width", "height"].filter((k) => typeof r[k] === "number").map((k) => [k, Math.round(r[k] as number)]));
      ctx.runtime.window(ctx.id, str(name, "name")).setBounds(bounds);
    },
  },
  "window.setClickThrough": {
    capability: "window.overlay",
    run: ([name, on], ctx) => ctx.runtime.window(ctx.id, str(name, "name")).setIgnoreMouseEvents(Boolean(on), { forward: true }),
  },
  "window.setOpacity": {
    capability: "window.overlay",
    run: ([name, value], ctx) => ctx.runtime.window(ctx.id, str(name, "name")).setOpacity(Math.min(1, Math.max(0.1, Number(value) || 1))),
  },
  "tray.set": {
    capability: "window.popover",
    run: ([options], ctx) => {
      const o = obj(options);
      ctx.runtime.setTray(ctx.id, { title: typeof o.title === "string" ? o.title : undefined, tooltip: typeof o.tooltip === "string" ? o.tooltip : undefined });
    },
  },

  notify: {
    capability: "notify",
    run: ([options], ctx) => {
      const o = obj(options);
      const actions = Array.isArray(o.actions) ? o.actions.filter((a): a is string => typeof a === "string").slice(0, 3) : [];
      const notification = new Notification({
        title: str(o.title, "title").slice(0, 120),
        body: typeof o.body === "string" ? o.body.slice(0, 400) : "",
        actions: actions.map((text) => ({ type: "button" as const, text })),
      });
      notification.on("click", () => emit(ctx, "notify:action", { action: null, tag: o.tag ?? null }));
      notification.on("action", (_event, index) => emit(ctx, "notify:action", { action: actions[index] ?? null, tag: o.tag ?? null }));
      notification.show();
    },
  },
  "clipboard.readText": { capability: "clipboard.read", run: () => clipboard.readText() },
  "clipboard.writeText": { capability: "clipboard.write", run: ([text]) => clipboard.writeText(String(text ?? "")) },
  "fs.read": { capability: "fs.applet", run: async ([path], ctx) => readFile(dataPath(ctx, path), "utf8") },
  "fs.write": {
    capability: "fs.applet",
    run: async ([path, data], ctx) => {
      const text = String(data ?? "");
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new ApiError("too_large", "files are limited to 5 MB");
      const full = dataPath(ctx, path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, text);
      return null;
    },
  },
  "fs.list": {
    capability: "fs.applet",
    run: async ([dir], ctx) => {
      const base = dataDir(ctx.id);
      await mkdir(base, { recursive: true });
      const full = dir ? dataPath(ctx, dir) : base;
      const entries = await readdir(full, { withFileTypes: true }).catch(() => []);
      return entries.map((entry) => ({ name: entry.name, dir: entry.isDirectory() }));
    },
  },
  open: {
    capability: "open.url",
    run: async ([url]) => {
      const parsed = new URL(str(url, "url"));
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new ApiError("invalid_argument", "only http and https links open");
      await shell.openExternal(parsed.toString());
    },
  },

  "bb.threads.list": { capability: "bb.threads.read", run: ([filter]) => appletsRpc("threads.list", filter ?? null) },
  "bb.threads.get": { capability: "bb.threads.read", run: ([threadId]) => appletsRpc("threads.get", { threadId: str(threadId, "threadId") }) },
  "bb.threads.tell": {
    capability: "bb.threads.tell",
    run: async ([threadId, text]) => (await appletsRpc("threads.tell", { threadId: str(threadId, "threadId"), text: str(text, "text") }), null),
  },
  "bb.open": { capability: "bb.open", run: async ([threadId]) => (await appletsRpc("threads.open", { threadId: str(threadId, "threadId") }), null) },
  "bb.rpc": {
    capability: ([pluginId, method]) => `bb.rpc:${str(pluginId, "pluginId")}:${str(method, "method")}`,
    run: ([pluginId, method, input]) => pluginRpc(String(pluginId), String(method), input ?? null),
  },
};

let emitter: (id: string, event: string, payload?: unknown) => void = () => {};
function emit(ctx: Context, event: string, payload?: unknown): void {
  emitter(ctx.id, event, payload);
}

export function setEmitter(fn: typeof emitter): void {
  emitter = fn;
}

export async function dispatch(method: string, args: unknown[], ctx: Context): Promise<unknown> {
  const entry = METHODS[method];
  if (!entry) throw new ApiError("unknown_method", `window.studio has no ${method}`);
  const capability = typeof entry.capability === "function" ? entry.capability(args, ctx) : entry.capability;
  if (capability) need(ctx, capability);
  return (await entry.run(args, ctx)) ?? null;
}

export const METHOD_NAMES = Object.keys(METHODS);
