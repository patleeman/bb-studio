import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serverUrl, cdpPort, threadId, sleep } from "./bb.mjs";

export class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  command(method, params = {}, timeoutMs = 60000) {
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      // A wedged page never answers; fail the capture instead of hanging it.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      this.pending.set(id, { resolve: settle(resolvePromise), reject: settle(reject) });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.command("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Runtime evaluation failed",
      );
    }
    if (result.result?.subtype === "error") {
      throw new Error(result.result.description ?? "Runtime evaluation failed");
    }
    return result.result?.value;
  }

  async openChannelTab(name) {
    await this.evaluate(`document.querySelector('button[aria-label^="Show right panel"]')?.click()`);
    await this.waitForAriaButton(name);
    await this.evaluate(`(() => {
      const tab = [...document.querySelectorAll('[aria-label="Right panel views"] button')]
        .find(button => button.getAttribute('aria-label') === ${JSON.stringify(name)});
      if (!tab) throw new Error('Missing native channel tab');
      tab.click();
    })()`);
  }

  async navigate(path) {
    await this.command("Page.navigate", { url: `${serverUrl}${path}` });
    await sleep(900);
  }

  /** Evaluates for a poll; a page that navigates mid-poll just isn't ready yet. */
  async poll(expression) {
    try {
      return await this.evaluate(expression);
    } catch (error) {
      if (/navigated or closed|context was destroyed|Cannot find context/i.test(String(error?.message))) return null;
      throw error;
    }
  }

  async waitForText(text, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const bodyText = await this.poll("document.body?.innerText ?? \"\"");
      if (bodyText?.includes(text)) return;
      await sleep(250);
    }
    const bodyText = await this.evaluate("document.body?.innerText ?? \"\"");
    throw new Error(`Timed out waiting for ${JSON.stringify(text)}.\n${bodyText.slice(-1200)}`);
  }

  async waitForSelector(selector, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.poll(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for selector ${JSON.stringify(selector)}`);
  }

  async waitForInputValue(label, expected, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await this.evaluate(`(() => {
        const field = Array.from(document.querySelectorAll("input, textarea"))
          .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
        return field?.value ?? null;
      })()`);
      if (value === expected) return;
      await sleep(250);
    }
    const value = await this.evaluate(`(() => {
      const field = Array.from(document.querySelectorAll("input, textarea"))
        .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
      return field?.value ?? null;
    })()`);
    throw new Error(`Timed out waiting for ${JSON.stringify(label)} to equal ${JSON.stringify(expected)}; actual value was ${JSON.stringify(value)}`);
  }

  async waitForAriaButton(label, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const present = await this.evaluate(`Array.from(document.querySelectorAll("button"))
        .some((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)})`);
      if (present) return;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for button ${JSON.stringify(label)}`);
  }

  async hasText(text, timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const bodyText = await this.evaluate("document.body?.innerText ?? \"\"");
      if (bodyText.includes(text)) return true;
      await sleep(250);
    }
    return false;
  }

  async clickButtonText(label) {
    const clicked = await this.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.innerText.trim() === ${JSON.stringify(label)});
      if (!button) throw new Error("Button not found: ${label}");
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Unable to click ${label}`);
    await sleep(900);
  }

  async drawRectangle() {
    await this.evaluate(`(() => {
      const tool = Array.from(document.querySelectorAll("[aria-label]"))
        .find((candidate) => candidate.getAttribute("aria-label") === "Rectangle");
      if (!tool) throw new Error("Excalidraw Rectangle tool not found");
      tool.click();
      return true;
    })()`);
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 560,
      y: 300,
      buttons: 0,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 560,
      y: 300,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 960,
      y: 550,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 960,
      y: 550,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(1200);
  }

  async clickSidebarButton(label) {
    const clicked = await this.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.innerText.trim() === ${JSON.stringify(label)});
      if (!button) throw new Error("Sidebar button not found: ${label}");
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Unable to click sidebar button ${label}`);
    await sleep(900);
  }

  async clickFirstButtonWithAria(label) {
    const clicked = await this.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
      if (!button) throw new Error("Button not found: ${label}");
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Unable to click ${label}`);
    await sleep(900);
  }

  async clickAriaButtonWithPointer(label) {
    const point = await this.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
      if (!button) throw new Error("Button not found: ${label}");
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(300);
  }

  async clickElementWithTextAndPointer(selector, text) {
    const point = await this.evaluate(`(() => {
      const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)});
      if (!element) throw new Error("Element not found: ${text}");
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(300);
  }

  async openThreadContextMenu() {
    const point = await this.evaluate(`(() => {
      const anchor = Array.from(document.querySelectorAll(
        '[data-sidebar-thread-id], [data-thread-id], [data-session-id], a[href*="/threads/"]',
      )).find((candidate) =>
        candidate.getAttribute("data-sidebar-thread-id") === ${JSON.stringify(threadId)} ||
        candidate.getAttribute("data-thread-id") === ${JSON.stringify(threadId)} ||
        candidate.getAttribute("data-session-id") === ${JSON.stringify(threadId)} ||
        candidate.getAttribute("href")?.includes("/threads/" + ${JSON.stringify(threadId)}),
      );
      if (!anchor) throw new Error("Seed thread row not found in the sidebar");
      const rect = anchor.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await this.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "right",
      clickCount: 1,
    });
    // Release clear of the menu: near the window's bottom it opens over the
    // pointer, and releasing on an item picks it.
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x + 400,
      y: point.y,
      button: "right",
      clickCount: 1,
    });
    await sleep(700);
  }

  /** Right-clicks the first element matching `selector`, opening its context menu. */
  async openContextMenu(selector) {
    const point = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Element not found: " + ${JSON.stringify(selector)});
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + Math.min(rect.width / 2, 80), y: rect.top + rect.height / 2 };
    })()`);
    await this.command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "right", clickCount: 1 });
    // Release clear of the menu, as in openThreadContextMenu: a menu that opens
    // over the pointer would take the release as picking an item.
    await this.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 400, y: point.y, button: "right", clickCount: 1 });
    await sleep(700);
  }

  /**
   * Drags the first element matching `selector` by `dx`, `dy` with real mouse
   * events, pressing `atX` pixels in from its left edge (default: its middle).
   */
  async dragBy(selector, dx, dy, { atX } = {}) {
    const start = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Element not found: " + ${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      const atX = ${JSON.stringify(atX ?? null)};
      return { x: rect.left + (atX ?? rect.width / 2), y: rect.top + rect.height / 2 };
    })()`);
    await this.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y, buttons: 0 });
    await this.command("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
    const steps = 12;
    for (let step = 1; step <= steps; step += 1) {
      const x = start.x + (dx * step) / steps;
      const y = start.y + (dy * step) / steps;
      await this.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      await sleep(16);
    }
    await this.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + dx, y: start.y + dy, button: "left", buttons: 0, clickCount: 1 });
    await sleep(500);
  }

  async capture(outputPath, clip) {
    const screenshot = await this.command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  }
}

async function findPageTarget() {
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === "page" && !candidate.url.startsWith("chrome://"));
  if (!target?.webSocketDebuggerUrl) throw new Error("No controllable Chrome page target found");
  return target.webSocketDebuggerUrl;
}

export async function ensureChrome() {
  try {
    return { webSocketUrl: await findPageTarget(), process: null };
  } catch {
    const chromePath = process.env.BB_CAPTURE_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const profileDir = await mkdtemp(join(tmpdir(), "bb-plugin-capture-"));
    const chromeProcess = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-address=127.0.0.1`,
        `--remote-debugging-port=${cdpPort}`,
        "--window-size=1440,1000",
        // Talk records from a synthetic microphone without a permission prompt.
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const started = Date.now();
    while (Date.now() - started < 20000) {
      try {
        return { webSocketUrl: await findPageTarget(), process: chromeProcess, profileDir };
      } catch {
        await sleep(250);
      }
    }
    chromeProcess.kill();
    await rm(profileDir, { recursive: true, force: true });
    throw new Error(`Timed out waiting for Chrome DevTools on port ${cdpPort}`);
  }
}
