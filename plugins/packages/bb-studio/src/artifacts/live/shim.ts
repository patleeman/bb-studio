// The script a live HTML artifact runs before its own: `window.playground`,
// the same API BB's playgrounds give, so a playground's HTML works as an
// artifact unchanged. It only talks to the viewer that framed it, by
// postMessage; the viewer checks each message came from its own frame and
// relays it to Studio.
import { LIVE_MESSAGE } from "../shared";

export type Theme = "light" | "dark";

function shim(state: unknown, theme: Theme): string {
  // `<` escaped so a state string can't close the script tag.
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  return `(() => {
  const T = ${json(LIVE_MESSAGE)};
  const post = (message) => parent.postMessage({ type: T, ...message }, "*");
  const copy = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
  let state = ${json(state)};
  let theme = ${json(theme)};
  let actions = {};
  const stateListeners = new Set();
  const themeListeners = new Set();
  const call = (listeners, value) => { for (const listener of listeners) { try { listener(value); } catch (error) { console.error(error); } } };
  const api = {
    get state() { return state; },
    get theme() { return theme; },
    save(next) { state = copy(next); post({ op: "save", state }); },
    onState(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); },
    onTheme(listener) { themeListeners.add(listener); return () => themeListeners.delete(listener); },
    expose(map) { actions = { ...map }; post({ op: "expose", actions: Object.keys(actions).filter((name) => typeof actions[name] === "function") }); },
    emit(name, data) { post({ op: "emit", name: String(name), data: copy(data) }); },
    send(label, data) {
      if (navigator.userActivation && !navigator.userActivation.isActive) return false;
      post({ op: "send", label: String(label).slice(0, 120), data: copy(data) });
      return true;
    },
  };
  Object.defineProperty(window, "playground", { value: Object.freeze(api) });
  addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.type !== T) return;
    if (message.op === "state") { state = message.state; call(stateListeners, state); }
    else if (message.op === "theme") { theme = message.theme; call(themeListeners, theme); }
    else if (message.op === "do") {
      const action = Object.prototype.hasOwnProperty.call(actions, message.action) ? actions[message.action] : null;
      const reply = (ok, value) => post(ok ? { op: "result", id: message.id, ok, value: copy(value) } : { op: "result", id: message.id, ok, error: String(value && value.message || value) });
      if (typeof action !== "function") { reply(false, "This page has no action " + JSON.stringify(message.action) + "."); return; }
      Promise.resolve().then(() => action(...(Array.isArray(message.args) ? message.args : []))).then((value) => reply(true, value), (error) => reply(false, error));
    }
  });
  const touch = () => post({ op: "touch" });
  // The page's height, for a chat card that fits it. Only reported changes.
  let height = 0;
  const measure = () => {
    // The body's bottom, not scrollHeight, which never drops below the frame's own height.
    const body = document.body;
    if (!body) return;
    const next = Math.ceil(body.getBoundingClientRect().bottom + window.scrollY + (parseFloat(getComputedStyle(body).marginBottom) || 0));
    if (next !== height) { height = next; post({ op: "size", height }); }
  };
  addEventListener("load", measure);
  addEventListener("DOMContentLoaded", () => { measure(); new ResizeObserver(measure).observe(document.body || document.documentElement); });
  addEventListener("pointerdown", touch, true);
  addEventListener("keydown", touch, true);
})();`;
}

/** An HTML page with the live script added at the top of its head, so its own scripts can use it. */
export function withLiveScript(bytes: Uint8Array, state: unknown, theme: Theme): Uint8Array<ArrayBuffer> {
  const html = Buffer.from(bytes).toString("utf8");
  const tag = `<script>${shim(state, theme)}</script>`;
  const open = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html);
  const at = open ? open.index + open[0].length : /^\s*<!doctype[^>]*>/i.exec(html)?.[0].length ?? 0;
  return new Uint8Array(Buffer.from(html.slice(0, at) + tag + html.slice(at), "utf8")) as Uint8Array<ArrayBuffer>;
}
