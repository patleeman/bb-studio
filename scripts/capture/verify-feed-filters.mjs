import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sleep } from "./bb.mjs";

/** Exercise native filters against a caller-owned, deterministic staged fixture. */
export async function verifyFeedFilters(client, {
  query, topic, from, through, expectedIds, attentionTitle, desktopPath, mobilePath,
}) {
  const dataDir = process.env.BB_DATA_DIR;
  const manifest = await readFile(resolve(dataDir, "../capture.env"), "utf8");
  assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`));
  assert.ok(manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`));
  await client.navigate("/plugins/feed/feed");
  await client.waitForSelector('form[aria-label="Filter feed"]');
  await client.evaluate(`(() => {
    const clear = [...document.querySelectorAll('button')].find(button => button.textContent === 'Clear filters');
    clear?.click();
  })()`);
  await sleep(300);
  await client.evaluate(`(() => {
    const tab = [...document.querySelectorAll('nav[aria-label="Topics"] button')].find(button => button.textContent === ${JSON.stringify(topic)});
    if (!tab) throw new Error('Fixture topic missing');
    tab.click();
  })()`);
  await sleep(300);
  await client.evaluate(`(() => {
    const inputs = document.querySelector('form[aria-label="Filter feed"]').querySelectorAll('input');
    for (const [index, value] of ${JSON.stringify([[0, query], [1, from], [2, through]])}) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inputs[index], value);
      inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (!inputs[3].checked) inputs[3].click();
  })()`);
  await client.clickButtonText("Apply filters");
  const inspect = () => client.evaluate(`({
    ids: [...document.querySelectorAll('main [data-feed-post]')].map(row => row.dataset.feedPost),
    attention: document.querySelector('aside')?.innerText,
    saved: JSON.parse(sessionStorage.getItem('bb-studio.feed.reader.v1')),
  })`);
  const check = async () => {
    await sleep(500);
    const result = await inspect();
    assert.deepEqual(new Set(result.ids), new Set(expectedIds));
    assert.ok(result.attention?.includes(attentionTitle));
    assert.deepEqual(result.saved.filters, { query, unread: true, from, through, topic });
    return result;
  };
  const result = await check();
  await client.command("Page.reload");
  await client.waitForSelector('main [data-feed-post]');
  await check();
  await client.capture(desktopPath);
  try {
    await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(500);
    result.mobile = await client.evaluate(`({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      controls: [...document.querySelectorAll('form[aria-label="Filter feed"] input, form[aria-label="Filter feed"] button')]
        .map(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })) })`);
    assert.equal(result.mobile.scrollWidth, 390);
    assert.ok(result.mobile.controls.every(control => control.left >= 0 && control.right <= 390));
    await client.capture(mobilePath);
  } finally {
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  }
  return result;
}
