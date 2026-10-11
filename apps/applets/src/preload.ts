// The only thing an applet's page gets: `window.studio`. Every call goes to
// the main process, which checks the caller's approved capabilities.
import { contextBridge, ipcRenderer } from "electron";

type Reply = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; [key: string]: unknown } };

const id = process.argv.find((arg) => arg.startsWith("--studio-applet="))?.slice("--studio-applet=".length) ?? "";
const windowName = new URLSearchParams(location.search).get("window");

async function call(method: string, ...args: unknown[]): Promise<unknown> {
  const reply = (await ipcRenderer.invoke("studio:call", method, args)) as Reply;
  if (reply.ok) return reply.result;
  throw Object.assign(new Error(reply.error.message), reply.error);
}

const listeners = new Map<string, Set<(payload: unknown) => void>>();
ipcRenderer.on("studio:event", (_event, name: string, payload: unknown) => {
  for (const fn of listeners.get(name) ?? []) {
    try {
      fn(payload);
    } catch (error) {
      void call("log", "error", `listener for ${name} threw: ${String(error)}`);
    }
  }
});

const studio = {
  applet: Object.freeze({ id, window: windowName, api: 1 }),
  log: (level: "info" | "warn" | "error", ...args: unknown[]) => void call("log", level, ...args),
  on(event: string, fn: (payload: unknown) => void): () => void {
    if (typeof fn !== "function") throw new TypeError("studio.on needs a function");
    const set = listeners.get(event) ?? new Set();
    set.add(fn);
    listeners.set(event, set);
    if (event.startsWith("bb:")) void call("events.want", event);
    return () => void set.delete(fn);
  },
  storage: {
    get: (key: string) => call("storage.get", key),
    set: (key: string, value: unknown) => call("storage.set", key, value),
  },
  window: {
    open: (name: string) => call("window.open", name),
    close: (name?: string) => call("window.close", name),
    hide: (name?: string) => call("window.hide", name),
    toggle: (name?: string) => call("window.toggle", name),
    setBounds: (name: string, rect: { x?: number; y?: number; width?: number; height?: number }) => call("window.setBounds", name, rect),
    setClickThrough: (name: string, on: boolean) => call("window.setClickThrough", name, on),
    setOpacity: (name: string, value: number) => call("window.setOpacity", name, value),
  },
  tray: { set: (options: { title?: string; tooltip?: string }) => call("tray.set", options) },
  notify: (options: { title: string; body?: string; actions?: string[]; tag?: string }) => call("notify", options),
  clipboard: {
    readText: () => call("clipboard.readText"),
    writeText: (text: string) => call("clipboard.writeText", text),
  },
  fs: {
    read: (path: string) => call("fs.read", path),
    write: (path: string, data: string) => call("fs.write", path, data),
    list: (dir?: string) => call("fs.list", dir),
  },
  open: (url: string) => call("open", url),
  bb: {
    threads: {
      list: (filter?: { projectId?: string; active?: boolean }) => call("bb.threads.list", filter),
      get: (threadId: string) => call("bb.threads.get", threadId),
      tell: (threadId: string, text: string) => call("bb.threads.tell", threadId, text),
    },
    open: (threadId: string) => call("bb.open", threadId),
    rpc: (pluginId: string, method: string, input?: unknown) => call("bb.rpc", pluginId, method, input),
  },
};

contextBridge.exposeInMainWorld("studio", studio);
