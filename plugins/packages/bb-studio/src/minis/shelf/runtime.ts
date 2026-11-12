// The runtime every mini app's frame loads first (shelf/runtime-1.js):
// `window.playground` and the module loader for the app's compiled files.
//
// It only talks to the host that framed it, by postMessage. The host checks
// each message came from its own frame, checks capabilities on the server,
// and answers. Nothing here holds a token or reaches the network itself.
//
// `window.playground` keeps the API BB's playgrounds and live artifacts have
// (state, save, onState, theme, onTheme, expose, emit, send), so their HTML
// runs unchanged, and adds db, fetch and bb.

type Listener<T> = (value: T) => void;
type Theme = "light" | "dark";
type Boot = { miniId: string; state: unknown; theme: Theme; tokens: Record<string, string> | null; entry: string; html: boolean };
type Factory = (require: (name: string) => unknown, module: { exports: Record<string, unknown> }, exports: Record<string, unknown>) => void;

const MESSAGE = "bb-mini";
const boot = (window as unknown as { __miniBoot: Boot }).__miniBoot;
const shelf: Record<string, unknown> = ((globalThis as Record<string, unknown>).__miniShelf ??= {}) as Record<string, unknown>;

const post = (message: Record<string, unknown>) => parent.postMessage({ type: MESSAGE, ...message }, "*");
const copy = <T,>(value: T): T => (value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T));
const call = (listeners: Set<Listener<unknown>>, value: unknown) => {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error(error);
    }
  }
};

// ---- Calls to the host --------------------------------------------------------

let nextCall = 0;
const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

function request<T = unknown>(method: string, params: unknown): Promise<T> {
  const id = ++nextCall;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    post({ op: "call", id, method, params: copy(params) });
  });
}

// ---- State, theme, actions (the playground API) --------------------------------

let state = boot.state;
let theme: Theme = boot.theme;
let actions: Record<string, (...args: unknown[]) => unknown> = {};
const stateListeners = new Set<Listener<unknown>>();
const themeListeners = new Set<Listener<unknown>>();

function applyTheme(next: Theme, tokens: Record<string, string> | null) {
  theme = next;
  const root = document.documentElement;
  root.classList.toggle("dark", next === "dark");
  root.classList.toggle("light", next === "light");
  root.style.colorScheme = next;
  if (tokens) for (const [name, value] of Object.entries(tokens)) if (/^--[a-z0-9-]+$/.test(name)) root.style.setProperty(name, value);
}
applyTheme(boot.theme, boot.tokens);

// ---- Records -------------------------------------------------------------------

type Query = { where?: Record<string, unknown>; order?: string; limit?: number; offset?: number };
type Change = { op: "put" | "remove"; id: string; record?: unknown };
const recordListeners = new Map<string, Set<(changes: Change[]) => void>>();

function collection(name: string) {
  const listeners = () => {
    let set = recordListeners.get(name);
    if (!set) recordListeners.set(name, (set = new Set()));
    return set;
  };
  return {
    name,
    find: (query: Query = {}) => request<unknown[]>("db.find", { collection: name, query }),
    get: (id: string) => request("db.get", { collection: name, id }),
    insert: (data: Record<string, unknown>, options: { id?: string } = {}) => request("db.insert", { collection: name, data, id: options.id }),
    /** Replaces the record's data. Pass `rev` to fail when someone else changed it first. */
    update: (id: string, data: Record<string, unknown>, options: { rev?: number } = {}) => request("db.update", { collection: name, id, data, rev: options.rev }),
    /** Merges fields into the record; `null` removes a field. */
    patch: (id: string, fields: Record<string, unknown>) => request("db.patch", { collection: name, id, fields }),
    remove: (id: string) => request("db.remove", { collection: name, id }),
    count: (query: Pick<Query, "where"> = {}) => request<number>("db.count", { collection: name, query }),
    /** Calls `listener` with the matching records now and after every change, from anyone. Returns a stop function. */
    subscribe(query: Query, listener: (records: unknown[], changes: Change[]) => void): () => void {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let pending: Change[] = [];
      const load = () => {
        const changes = pending;
        pending = [];
        void request<unknown[]>("db.find", { collection: name, query }).then(
          (records) => !stopped && listener(records, changes),
          (error) => console.error(`[mini] ${name}:`, error),
        );
      };
      const onChange = (changes: Change[]) => {
        pending.push(...changes);
        if (timer) clearTimeout(timer);
        timer = setTimeout(load, 30);
      };
      listeners().add(onChange);
      load();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        listeners().delete(onChange);
      };
    },
  };
}

// ---- Network -------------------------------------------------------------------

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string | null; auth?: string };
type ProxiedResponse = { status: number; statusText: string; headers: Record<string, string>; body: string; url: string };

async function proxiedFetch(url: string, init: FetchInit = {}) {
  if (init.body !== undefined && init.body !== null && typeof init.body !== "string") throw new TypeError("playground.fetch: pass the body as a string (JSON.stringify it).");
  const response = await request<ProxiedResponse>("fetch", { url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null, auth: init.auth ?? null });
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: { get: (key: string) => response.headers[key.toLowerCase()] ?? null, entries: () => Object.entries(response.headers) },
    text: async () => response.body,
    json: async () => JSON.parse(response.body) as unknown,
  };
}

// ---- Modules -------------------------------------------------------------------

const factories = new Map<string, Factory>();
const cache = new Map<string, { exports: Record<string, unknown> }>();
const EXTENSIONS = ["", ".jsx", ".tsx", ".js", ".ts", ".json", ".css", "/index.jsx", "/index.tsx", "/index.js", "/index.ts"];

function resolvePath(from: string, name: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const part of name.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  const base = parts.join("/");
  for (const ext of EXTENSIONS) if (factories.has(base + ext)) return base + ext;
  throw new Error(`Mini app file not found: ${name} (from ${from})`);
}

function load(path: string): Record<string, unknown> {
  const cached = cache.get(path);
  if (cached) return cached.exports;
  const factory = factories.get(path);
  if (!factory) throw new Error(`Mini app file not found: ${path}`);
  const module = { exports: {} as Record<string, unknown> };
  cache.set(path, module);
  factory((name) => requireFrom(path, name), module, module.exports);
  return module.exports;
}

function requireFrom(from: string, name: string): unknown {
  if (name.startsWith(".") || name.startsWith("/")) return load(resolvePath(from, name));
  if (name in shelf) return shelf[name];
  throw new Error(`"${name}" isn't on the shelf, or the manifest doesn't list its library.`);
}

const define = (path: string, factory: Factory) => factories.set(path, factory);

/** Shows an error in the frame, so a broken mini app says why instead of staying blank. */
function showError(error: unknown) {
  const text = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  console.error(error);
  post({ op: "error", message: text.slice(0, 4000) });
  const box = document.createElement("pre");
  box.setAttribute("data-mini-error", "");
  box.style.cssText = "margin:12px;padding:12px;border-radius:8px;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:var(--destructive-text,#c2254a);background:color-mix(in oklab,var(--destructive,#d42f55) 10%,transparent)";
  box.textContent = text;
  document.body.append(box);
}

/** Runs a module. A default-exported component that didn't render itself is mounted into #root. */
function run(path: string) {
  try {
    const exports = load(path.replace(/^\.\//, ""));
    const App = exports.default;
    const root = document.getElementById("root");
    if (typeof App === "function" && root && !root.hasChildNodes()) {
      const React = shelf.react as { createElement(type: unknown, props?: unknown): unknown };
      const client = shelf["react-dom/client"] as { createRoot(node: Element): { render(node: unknown): void } };
      const kit = shelf["@studio/kit"] as { MiniRoot?: unknown } | undefined;
      const app = React.createElement(App);
      client.createRoot(root).render(kit?.MiniRoot ? React.createElement(kit.MiniRoot, { children: app }) : app);
    }
  } catch (error) {
    showError(error);
  }
}

addEventListener("error", (event) => showError(event.error ?? event.message));
addEventListener("unhandledrejection", (event) => console.error("[mini]", event.reason));

// ---- The API -------------------------------------------------------------------

const api = {
  get id() { return boot.miniId; },
  get state() { return state; },
  get theme() { return theme; },
  save(next: unknown) {
    state = copy(next);
    post({ op: "save", state });
  },
  onState(listener: Listener<unknown>) {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
  onTheme(listener: Listener<unknown>) {
    themeListeners.add(listener);
    return () => themeListeners.delete(listener);
  },
  expose(map: Record<string, (...args: unknown[]) => unknown>) {
    actions = { ...map };
    post({ op: "expose", actions: Object.keys(actions).filter((name) => typeof actions[name] === "function") });
  },
  emit(name: string, data?: unknown) {
    post({ op: "emit", name: String(name), data: copy(data) });
  },
  /** Sends data to the agent: it lands in the thread's composer for the user to send. Needs a click or key press. */
  send(label: string, data?: unknown) {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) return false;
    post({ op: "send", label: String(label).slice(0, 120), data: copy(data) });
    return true;
  },
  db: { collection },
  fetch: proxiedFetch,
  bb: {
    threads: { list: (options: { limit?: number } = {}) => request("bb.threads.list", options) },
    studio: { list: (options: { query?: string; kind?: string; limit?: number } = {}) => request("bb.studio.list", options) },
    /** Opens a BB or Studio address (a thread id, an item link, or a path) in the app. */
    open: (target: string) => request("bb.open", { target: String(target) }),
  },
  require: (name: string) => requireFrom(boot.entry, name),
  run,
};

Object.defineProperty(window, "playground", { value: Object.freeze(api) });
Object.defineProperty(window, "__mini", { value: Object.freeze({ define, run, showError }) });

addEventListener("message", (event) => {
  const message = event.data as { type?: unknown; op?: string; [key: string]: unknown } | null;
  if (event.source !== parent || !message || message.type !== MESSAGE) return;
  switch (message.op) {
    case "reply": {
      const pending = waiting.get(message.id as number);
      if (!pending) return;
      waiting.delete(message.id as number);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(String(message.error ?? "The call failed.")));
      return;
    }
    case "state":
      state = message.state;
      call(stateListeners, state);
      return;
    case "theme":
      applyTheme(message.theme === "dark" ? "dark" : "light", (message.tokens as Record<string, string> | null) ?? null);
      call(themeListeners, theme);
      return;
    case "records":
      recordListeners.get(message.collection as string)?.forEach((listener) => listener(message.changes as Change[]));
      return;
    case "do": {
      const action = Object.prototype.hasOwnProperty.call(actions, message.action as string) ? actions[message.action as string] : null;
      const reply = (ok: boolean, value: unknown) =>
        post(ok ? { op: "result", id: message.id, ok, value: copy(value) } : { op: "result", id: message.id, ok, error: String((value as Error)?.message ?? value) });
      if (typeof action !== "function") return reply(false, `This mini app has no action ${JSON.stringify(message.action)}.`);
      Promise.resolve()
        .then(() => action(...(Array.isArray(message.args) ? message.args : [])))
        .then((value) => reply(true, value), (error) => reply(false, error));
      return;
    }
  }
});

// Height, for page blocks and chat cards that fit their content.
let height = 0;
const measure = () => {
  const body = document.body;
  if (!body) return;
  const next = Math.ceil(body.getBoundingClientRect().bottom + window.scrollY + (parseFloat(getComputedStyle(body).marginBottom) || 0));
  if (next !== height) {
    height = next;
    post({ op: "size", height });
  }
};
addEventListener("load", measure);
addEventListener("DOMContentLoaded", () => {
  measure();
  new ResizeObserver(measure).observe(document.body);
});
const touch = () => post({ op: "touch" });
addEventListener("pointerdown", touch, true);
addEventListener("keydown", touch, true);
post({ op: "ready" });
