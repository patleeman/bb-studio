import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { bbCli, sleep } from "./bb.mjs";

/** Fault injection may change only a plugin's installed staged bundle. */
export async function withStagedBundleFault(pluginId, find, replacement, verify) {
  const dataDir = resolve(process.env.BB_DATA_DIR);
  const manifest = await readFile(resolve(dataDir, "../capture.env"), "utf8");
  assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`));
  assert.ok(manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`));
  const { plugins } = JSON.parse(await bbCli(["plugin", "list", "--json"]));
  const plugin = plugins.find(entry => entry.id === pluginId);
  assert.ok(plugin, `Missing staged plugin ${pluginId}`);
  const root = resolve(plugin.rootDir);
  assert.ok(root.startsWith(resolve(dataDir, "plugins/cache") + sep), "Refusing a non-staged or local checkout plugin");
  const path = resolve(root, "dist/server.js");
  const original = await readFile(path, "utf8");
  assert.equal(original.split(find).length, 2, "Fault anchor must match exactly once");
  try {
    await writeFile(path, original.replace(find, replacement));
    await bbCli(["plugin", "reload", pluginId]);
    return await verify();
  } finally {
    await writeFile(path, original);
    await bbCli(["plugin", "reload", pluginId]);
    assert.equal(await readFile(path, "utf8"), original, "Provider bundle restoration must be exact");
  }
}

export async function searchKey(client, key, code, modifiers = 0) {
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
}

/** Opens through the registered keyboard shortcut and checks dialog-only hits. */
export async function openVerifiedQuickSearch(client, query, titles) {
  await client.navigate("/plugins/studio/studio");
  await searchKey(client, "K", "KeyK", 12); // Meta + Shift + K on staged macOS.
  await client.waitForSelector('input[aria-label="Search Studio"]');
  assert.equal(await client.evaluate("document.activeElement?.getAttribute('aria-label')"), "Search Studio");
  await client.command("Input.insertText", { text: query });
  for (let attempt = 0; attempt < 40; attempt++) {
    const text = await client.evaluate(`document.querySelector('[role="dialog"]:has(input[aria-label="Search Studio"]) [aria-label="Search results"]')?.textContent ?? ''`);
    // A recent-items response can contain these titles before debounce finishes.
    // The fixture query exists only in indexed body text, so require its snippet.
    if (text.toLowerCase().includes(query.toLowerCase()) && titles.every(title => text.includes(title))) return text;
    await sleep(150);
  }
  throw new Error("Quick Open did not show its expected cached hits");
}

/** Results and the freshness warning must coexist in the actual modal. */
export async function captureQuickSearchFreshness(client, { query, titles, warning, path }) {
  const results = await openVerifiedQuickSearch(client, query, titles);
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]:has(input[aria-label="Search Studio"])');
      return { warning: dialog?.querySelector('[role="status"]')?.textContent ?? null,
        retry: [...(dialog?.querySelectorAll('button') ?? [])].some(button => button.textContent === 'Retry') };
    })()`);
    if (state.warning === warning) {
      assert.equal(state.retry, true, "A failed freshness check needs a retry action");
      await client.capture(path);
      return { results, ...state };
    }
    await sleep(200);
  }
  throw new Error("Quick Open did not show the expected freshness warning");
}
