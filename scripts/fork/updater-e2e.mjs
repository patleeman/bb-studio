#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

if (args.includes("--help")) {
  console.log(`End-to-end test of the desktop updater against a local feed.

  node scripts/fork/updater-e2e.mjs --evidence <dir> [--scratch /tmp/bbs-update-e2e]
                                    [--port 39123] [--skip-build]
                                    [--missing-feed-only] [--github-feed]

Run it in a built worktree (pnpm build and prepare-runtime done), never in the
release worktree. It builds the current Studio version N and N+1 as test builds
(BB_STUDIO_UPDATE_TEST: app id nyc.plee.bbstudio.updatetest, product "BB Studio
Update Test", data and user data under the scratch dir, ports 38996/38997,
onboarding and bb import off, DevTools protocol on 9339, feed
http://127.0.0.1:<port>/), signed with CSC_NAME. It runs N from the scratch dir
with no feed (404s, to check that it fails quietly), then serves N+1's zip,
blockmap and latest-mac.yml, lets N find, download and install it, and checks
that the relaunched app is N+1. Logs, the feed's request log and screenshots go
to the evidence dir. --github-feed builds only N, with the real feed (the GitHub
releases of patleeman/bb-studio), and checks that it fails quietly.`);
  process.exit(0);
}

const desktop = join(root, "apps/desktop");
const scratch = resolve(option("--scratch", "/tmp/bbs-update-e2e"));
const evidence = resolve(option("--evidence", ""));
const port = Number(option("--port", "39123"));
const cdpPort = 9339;
const githubFeed = args.includes("--github-feed");
const feedUrl = githubFeed ? "github" : `http://127.0.0.1:${port}/`;
const prefix = githubFeed ? "github-" : "";
const productName = "BB Studio Update Test";
const appDir = join(scratch, "app");
const appPath = join(appDir, `${productName}.app`);
const feedDir = join(scratch, "feed");
const dataDir = join(scratch, "data");
const releaseDir = join(desktop, "release");

if (option("--evidence", "") === "") throw new Error("--evidence <dir> is required");
if (!scratch.startsWith("/tmp/") && !scratch.startsWith("/private/tmp/")) {
  throw new Error("the scratch dir must be under /tmp");
}
mkdirSync(evidence, { recursive: true });
const logPath = join(evidence, "e2e.log");
const log = (line) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(logPath, `${stamped}\n`);
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function run(cwd, command, argv, env = process.env) {
  const result = spawnSync(command, argv, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${argv.join(" ")} failed`);
}

function capture(command, argv) {
  return spawnSync(command, argv, { encoding: "utf8" }).stdout?.trim() ?? "";
}

function currentVersion() {
  return JSON.parse(
    readFileSync(join(desktop, "studio-release.fork.json"), "utf8"),
  ).version;
}

function nextPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function testEnv(version) {
  const env = {
    ...process.env,
    BB_STUDIO_UPDATE_TEST: JSON.stringify({ root: scratch, feedUrl, version }),
  };
  return env;
}

function buildTestApp(version, targets) {
  log(`build test app ${version} (${targets.join(" ")})`);
  rmSync(releaseDir, { recursive: true, force: true });
  const env = testEnv(version);
  run(desktop, process.execPath, ["scripts/build.mjs"], env);
  run(
    desktop,
    process.execPath,
    ["scripts/run-electron-builder.mjs", "--mac", ...targets, "--arm64", "--publish", "never"],
    env,
  );
}

function plistValue(app, key) {
  return capture("/usr/libexec/PlistBuddy", [
    "-c",
    `Print ${key}`,
    join(app, "Contents/Info.plist"),
  ]);
}

function serveFeed(dir) {
  const requests = join(evidence, "feed-requests.log");
  const server = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? "/").split("?")[0]).slice(1);
    const file = join(dir, basename(name));
    const found = name.length > 0 && existsSync(file);
    appendFileSync(
      requests,
      `${new Date().toISOString()} ${request.method} /${name} ${request.headers.range ?? ""} -> ${found ? 200 : 404}\n`,
    );
    if (!found) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-length": statSync(file).size,
      "content-type": "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

async function cdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolveSend, reject) => {
      id += 1;
      pending.set(id, { resolve: resolveSend, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return {
    close: () => socket.close(),
    evaluate: async (expression) =>
      (
        await send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        })
      ).result?.value,
    screenshot: async (path) => {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(data, "base64"));
      log(`screenshot ${path}`);
    },
  };
}

async function appPage() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      ).json();
      const page = targets.find(
        (target) =>
          target.type === "page" &&
          target.url.startsWith("http://127.0.0.1:38996"),
      );
      if (page !== undefined) return cdp(page.webSocketDebuggerUrl);
    } catch {}
    await sleep(1000);
  }
  throw new Error("the test app's window never loaded");
}

async function waitFor(label, check, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function launch() {
  const binary = join(appPath, "Contents/MacOS", productName);
  const child = spawn(binary, [], {
    detached: true,
    env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  log(`launched ${productName} pid ${child.pid}`);
  return child.pid;
}

function processesOf(path) {
  return capture("pgrep", ["-f", `${path}/Contents/MacOS/`])
    .split("\n")
    .filter(Boolean);
}

async function quitTestApp() {
  for (const pid of processesOf(appPath)) {
    spawnSync("kill", ["-TERM", pid]);
  }
  await waitFor("the test app to quit", async () => processesOf(appPath).length === 0, 60_000);
}

function desktopLog() {
  const logs = join(dataDir, "logs");
  if (!existsSync(logs)) return "";
  return readdirSync(logs)
    .filter((name) => name.startsWith("desktop"))
    .map((name) => readFileSync(join(logs, name), "utf8"))
    .join("\n");
}

function writeVersionFeed(version, dir) {
  const yaml = readFileSync(join(dir, "latest-mac.yml"), "utf8");
  const path = /path: (.+)/.exec(yaml)[1].trim();
  const sha512 = createHash("sha512")
    .update(readFileSync(join(dir, path)))
    .digest("base64");
  writeFileSync(
    join(dir, "desktop-version.json"),
    `${JSON.stringify(
      {
        channel: "latest",
        files: [{ url: path, sha512, size: statSync(join(dir, path)).size }],
        minimumSystemVersion: "22.0.0",
        path,
        platform: "macos",
        releaseDate: new Date().toISOString(),
        releaseName: `BB Studio desktop ${version}`,
        releaseNotes: null,
        schemaVersion: 1,
        sha512,
        stagingPercentage: null,
        version,
      },
      null,
      2,
    )}\n`,
  );
}

async function main() {
  if ((process.env.CSC_NAME ?? "").trim() === "") {
    throw new Error("set CSC_NAME: Squirrel.Mac only installs an update signed like the running app");
  }
  if (processesOf(appPath).length > 0) await quitTestApp();
  const n = currentVersion();
  const next = nextPatch(n);
  log(`N=${n} N+1=${next} scratch=${scratch} feed=${feedUrl}`);

  if (!args.includes("--skip-build")) {
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(feedDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });
    mkdirSync(join(scratch, "next"), { recursive: true });
    if (!githubFeed) buildTestApp(next, ["zip"]);
    for (const name of githubFeed ? [] : readdirSync(releaseDir)) {
      if (/\.zip$|\.blockmap$|^latest-mac\.yml$/.test(name)) {
        cpSync(join(releaseDir, name), join(join(scratch, "next"), name));
      }
    }
    buildTestApp(n, ["zip"]);
    cpSync(join(releaseDir, "mac-arm64", `${productName}.app`), appPath, {
      recursive: true,
      verbatimSymlinks: true,
    });
    rmSync(releaseDir, { recursive: true, force: true });
  } else {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(join(scratch, "user-data"), { recursive: true, force: true });
  }
  if (!githubFeed) writeVersionFeed(next, join(scratch, "next"));

  const installedVersion = plistValue(appPath, "CFBundleShortVersionString");
  const installedId = plistValue(appPath, "CFBundleIdentifier");
  log(`test app ${installedId} ${installedVersion} at ${appPath}`);
  if (installedVersion !== n) throw new Error(`the test app is ${installedVersion}, not ${n}`);
  writeFileSync(
    join(evidence, `${prefix}codesign-N.txt`),
    spawnSync("codesign", ["-dv", "--verbose=2", appPath], { encoding: "utf8" }).stderr,
  );
  writeFileSync(
    join(evidence, `${prefix}app-update-N.yml`),
    readFileSync(join(appPath, "Contents/Resources/app-update.yml")),
  );

  rmSync(feedDir, { recursive: true, force: true });
  mkdirSync(feedDir, { recursive: true });
  const server = await serveFeed(feedDir);
  log(githubFeed ? "phase 1: the real GitHub feed" : "phase 1: empty feed (every request 404s)");
  launch();
  let page = await appPage();
  const missing = await waitFor(
    "the first update check against the empty feed",
    () => page.evaluate("window.bbDesktop.getInfo()").then((info) => (info?.lastCheckedAt ? info : null)),
    120_000,
  );
  await sleep(3000);
  log(`desktop info with a missing feed: ${JSON.stringify(missing)}`);
  const ui = await page.evaluate(
    `(() => ({ dialogs: document.querySelectorAll('[role="alertdialog"], [role="dialog"]').length, toasts: Array.from(document.querySelectorAll('[data-sonner-toast], [role="status"]')).map((node) => node.textContent) }))()`,
  );
  log(`dialogs and toasts with a missing feed: ${JSON.stringify(ui)}`);
  await page.evaluate("location.hash = ''; history.pushState({}, '', '/settings/updates'); dispatchEvent(new PopStateEvent('popstate'))");
  await sleep(3000);
  await page.screenshot(join(evidence, `${prefix}1-missing-feed-updates.png`));
  writeFileSync(join(evidence, `${prefix}desktop-missing-feed.log`), desktopLog());
  if (missing.updateAvailable || missing.downloadState !== "idle") {
    throw new Error("a missing feed changed the update state");
  }
  page.close();
  if (githubFeed || args.includes("--missing-feed-only")) {
    await quitTestApp();
    server.close();
    return;
  }

  log("phase 2: serve N+1");
  for (const name of readdirSync(join(scratch, "next"))) {
    cpSync(join(scratch, "next", name), join(feedDir, name));
  }
  await quitTestApp();
  const firstPid = launch();
  page = await appPage();
  const downloaded = await waitFor(
    "N+1 to download",
    () =>
      page
        .evaluate("window.bbDesktop.getInfo()")
        .then((info) => (info?.updateDownloaded ? info : null)),
    600_000,
  );
  log(`desktop info after download: ${JSON.stringify(downloaded)}`);
  await page.evaluate("history.pushState({}, '', '/settings/updates'); dispatchEvent(new PopStateEvent('popstate'))");
  await sleep(3000);
  await page.screenshot(join(evidence, "2-downloaded-updates.png"));
  log("install and relaunch");
  void page.evaluate("window.bbDesktop.installUpdate()").catch(() => undefined);
  await waitFor(
    "N to quit",
    async () => !processesOf(appPath).includes(String(firstPid)),
    120_000,
  );
  await waitFor(
    "the app to be replaced by N+1",
    async () => plistValue(appPath, "CFBundleShortVersionString") === next,
    180_000,
  );
  const relaunched = await waitFor(
    "N+1 to relaunch",
    async () => {
      const pids = processesOf(appPath);
      return pids.length > 0 ? pids : null;
    },
    180_000,
  );
  log(`relaunched pids ${relaunched.join(", ")}; Info.plist version ${plistValue(appPath, "CFBundleShortVersionString")}`);
  await sleep(15_000);
  writeFileSync(
    join(evidence, "codesign-N+1.txt"),
    spawnSync("codesign", ["-dv", "--verbose=2", appPath], { encoding: "utf8" }).stderr,
  );
  writeFileSync(join(evidence, "desktop.log"), desktopLog());
  writeFileSync(
    join(evidence, "ps-after.txt"),
    capture("ps", ["-o", "pid,lstart,command", "-p", relaunched.join(",")]),
  );
  page = await appPage();
  const after = await page.evaluate(
    "window.bbDesktop.getInfo().then((info) => ({ info, preloadVersion: window.bbDesktop.version, studioBuild: window.bbDesktop.experimental_studioBuild }))",
  );
  log(`N+1 after relaunch: ${JSON.stringify(after)}`);
  if (after.info.version !== next || after.studioBuild?.version !== next) {
    throw new Error(`the relaunched app reports ${after.info.version}, not ${next}`);
  }
  await page.evaluate("history.pushState({}, '', '/settings/updates'); dispatchEvent(new PopStateEvent('popstate'))");
  await sleep(3000);
  const row = await page.evaluate(
    "Array.from(document.querySelectorAll('[data-version-metadata]')).map((node) => node.parentElement?.parentElement?.textContent)",
  );
  log(`Updates rows: ${JSON.stringify(row)}`);
  await page.screenshot(join(evidence, "3-relaunched-updates.png"));
  page.close();
  writeFileSync(join(evidence, "desktop.log"), desktopLog());
  await quitTestApp();
  log(`PASS: ${n} found, downloaded and installed ${next}, and relaunched as ${next}`);
  server.close();
}

await main();
