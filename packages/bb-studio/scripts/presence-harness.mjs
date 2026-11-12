import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "package.json"));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function loadEsbuild() {
  try { return require("esbuild"); } catch { return require(resolve(root, "../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild")); }
}

function sdkNames(dir, names = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") sdkNames(path, names); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    for (const found of readFileSync(path, "utf8").matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@get-bb\/plugin-sdk\/app"/g)) {
      for (const part of found[1].split(",")) { const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]; if (name) names.add(name); }
    }
  }
  return names;
}
const LIVE_STUB = `export const useLive = (method) => ({ data: globalThis.__LIVE__?.[method] ?? null, error: null, loading: false, refresh() {} }); export const useCall = () => async () => ({});`;
const stubs = {
  name: "presence-harness-stubs",
  setup(build) {
    build.onResolve({ filter: /^@get-bb\/plugin-sdk\/app$|\/ui\/live$/ }, (args) => ({ path: args.path.startsWith("@") ? "sdk" : "live", namespace: "presence-stub" }));
    build.onLoad({ filter: /.*/, namespace: "presence-stub" }, (args) => ({
      contents: args.path === "live" ? LIVE_STUB : [...sdkNames(join(root, "src"))].map((name) => `export const ${name} = () => null;`).join("\n") + "\nexport default {};",
      loader: "js",
    }));
  },
};

export function tailwindPage(script, { dark = true } = {}) {
  const tailwind = readFileSync(require.resolve("@tailwindcss/browser"), "utf8");
  const colors = dark
    ? { background: "#15102a", foreground: "#f3ecff", border: "#3a2f5c", muted: "#2a2145", "muted-foreground": "#a79cc7", primary: "#ff4fd8", "primary-foreground": "#15102a", "state-hover": "#241b40", "state-active": "#30245a", ring: "#ff4fd8", destructive: "#ff6b6b", card: "#1b1436", input: "#3a2f5c" }
    : { background: "#ffffff", foreground: "#1f2328", border: "#d0d7de", muted: "#f0f2f4", "muted-foreground": "#59636e", primary: "#0969da", "primary-foreground": "#ffffff", "state-hover": "#f3f4f6", "state-active": "#e6eaef", ring: "#0969da", destructive: "#cf222e", card: "#ffffff", input: "#d0d7de" };
  const theme = Object.entries(colors).map(([name, value]) => `--color-${name}: ${value};`).join(" ");
  return `<!doctype html><html class="${dark ? "dark" : ""}" style="color-scheme:${dark ? "dark" : "light"}"><head><meta charset="utf-8"><style type="text/tailwindcss">@theme { ${theme} } html,body{margin:0;background:${dark ? "#0b0716" : "#f6f8fa"};font-family:-apple-system,system-ui,sans-serif}</style><script>${tailwind.replace(/<\/script/gi, "<\\/script")}</script></head><body><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

export async function bundle(entry, define = {}) {
  const esbuild = loadEsbuild();
  const result = await esbuild.build({
    plugins: [stubs],
    entryPoints: [resolve(root, entry)], bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', ...define }, logLevel: "error",
  });
  return result.outputFiles[0].text;
}

export async function withPage({ html, width, height, scale = 2, dark = true, reducedMotion = false }, run) {
  const dir = mkdtempSync(join(tmpdir(), "presence-harness-"));
  const file = join(dir, "index.html");
  writeFileSync(file, html);
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, "--no-first-run", "--hide-scrollbars", "--disable-extensions", "--enable-unsafe-swiftshader", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const endpoint = await new Promise((done, fail) => {
      let text = "";
      const timer = setTimeout(() => fail(new Error("Chrome did not start")), 20000);
      chrome.stderr.on("data", (chunk) => {
        text += chunk;
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(text);
        if (found) { clearTimeout(timer); done(found[1]); }
      });
      chrome.on("exit", () => fail(new Error("Chrome exited")));
    });
    const browser = await connect(endpoint);
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const page = { send: (method, params = {}) => browser.send(method, params, sessionId), on: (handler) => browser.listeners.add(handler) };
    const logs = [];
    browser.listeners.add((message) => {
      if (message.method === "Runtime.consoleAPICalled") logs.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
      if (message.method === "Runtime.exceptionThrown") logs.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
    });
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    await page.send("Network.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }] });
    await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } }).catch(() => {});
    await page.send("Page.navigate", { url: `file://${file}` });
    const evaluate = async (expression) => {
      const result = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, timeoutMs = 60000) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const value = await evaluate(expression).catch(() => undefined);
        if (value) return value;
        if (Date.now() > until) throw new Error(`Timed out waiting for ${expression}\n${logs.join("\n")}`);
        await new Promise((next) => setTimeout(next, 100));
      }
    };
    const screenshot = async (path, clip) => {
      const shot = await page.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(path, Buffer.from(shot.data, "base64"));
    };
    return await run({ page, evaluate, waitFor, screenshot, logs });
  } finally {
    chrome.kill("SIGKILL");
    await new Promise((next) => setTimeout(next, 200));
    rmSync(dir, { recursive: true, force: true });
  }
}

function connect(endpoint) {
  return new Promise((done, fail) => {
    const socket = new WebSocket(endpoint);
    const pending = new Map();
    const listeners = new Set();
    let next = 1;
    socket.addEventListener("open", () => done({
      listeners,
      send(method, params = {}, sessionId) {
        const id = next++;
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((resolveCall, rejectCall) => pending.set(id, { resolveCall, rejectCall }));
      },
    }));
    socket.addEventListener("error", () => fail(new Error("CDP socket failed")));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.rejectCall(new Error(message.error.message)); else entry.resolveCall(message.result);
      } else for (const listener of listeners) listener(message);
    });
  });
}

export function pageHtml(script, { background = "#0b0716", body = "" } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${background}}</style></head><body>${body}<script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
