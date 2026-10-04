import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpClient, ensureChrome } from './driver.mjs';
import { pluginRpc, projectId, sleep } from './bb.mjs';

const manifest = await readFile(resolve(process.env.BB_DATA_DIR, '../capture.env'), 'utf8');
assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(process.env.BB_DATA_DIR)}`));
assert.ok(manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`));
const output = resolve('docs/review-evidence/2026-10-02/table-window');
await mkdir(output, { recursive: true });
const browser = await ensureChrome();
const client = new CdpClient(browser.webSocketUrl);
await client.connect();
const results = [];
let id;
const key = async (key, code, modifiers = 0) => {
  await client.command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await client.command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
};
try {
  await client.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await client.command('Performance.enable');
  for (const count of [1200, 5000]) {
    const { table } = await pluginRpc('studio-tables', 'create', {
      title: `Windowed grid QA ${count}`, projectId,
      columns: [{ id: 'name', name: 'Name', type: 'text' }, { id: 'qty', name: 'Quantity', type: 'number' }],
      rows: Array.from({ length: count }, (_, index) => ({ name: `Fixture ${index + 1}`, qty: index })),
    });
    id = table.id;
    const started = performance.now();
    await client.navigate(`/plugins/studio-tables/tables/${id}`);
    await client.waitForSelector('[data-cell="0:0"]');
    const stats = await client.evaluate(`({ nodes: document.querySelectorAll('*').length, mountedRows: document.querySelectorAll('tbody tr[data-row]').length, total: document.querySelector('[role=grid]').getAttribute('aria-rowcount') })`);
    assert.ok(stats.mountedRows < 80, `Unbounded initial row count: ${stats.mountedRows}`);
    assert.equal(Number(stats.total), count + 1);
    stats.fixtureRows = count;
    stats.navigationAndReadyMs = Math.round(performance.now() - started); // Includes driver's fixed navigation wait.
    await client.evaluate(`document.querySelector('textarea[aria-label="Table cells"]').focus()`);
    await key('End', 'End', 2);
    await client.waitForSelector(`[data-cell="${count - 1}:1"]`);
    const atEnd = await client.evaluate(`(() => {
      const field = document.querySelector('textarea[aria-label="Table cells"]');
      const cell = document.getElementById(field.getAttribute('aria-activedescendant'));
      return { index: cell.closest('tr').getAttribute('aria-rowindex'), text: cell.innerText, top: cell.getBoundingClientRect().top, bottom: cell.getBoundingClientRect().bottom, mounted: document.querySelectorAll('tbody tr[data-row]').length, height: innerHeight };
    })()`);
    assert.equal(Number(atEnd.index), count + 1);
    assert.ok(atEnd.top >= 0 && atEnd.bottom <= atEnd.height);
    assert.ok(atEnd.mounted < 80);
    await key('9', 'Digit9');
    await client.waitForSelector('input[aria-label="Quantity"]');
    await client.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Quantity"]');
      window.__retainedTableEditor = input;
      const grid = document.querySelector('[role="grid"]');
      const scroller = grid.parentElement;
      scroller.scrollTop = 0; scroller.dispatchEvent(new Event('scroll'));
    })()`);
    await sleep(150);
    assert.equal(await client.evaluate(`document.querySelector('input[aria-label="Quantity"]') === window.__retainedTableEditor && document.activeElement === window.__retainedTableEditor`), true);
    await key('Enter', 'Enter');
    let saved;
    for (let retry = 0; retry < 40; retry++) {
      saved = (await pluginRpc('studio-tables', 'get', { id })).table.rows.at(-1).values.qty;
      if (saved === 9) break;
      await sleep(100);
    }
    assert.equal(saved, 9);
    stats.end = atEnd;
    stats.retainedEditorSaved = true;
    stats.metrics = (await client.command('Performance.getMetrics')).metrics.filter(item => ['JSHeapUsedSize', 'Nodes', 'LayoutCount', 'TaskDuration'].includes(item.name));
    await client.capture(`${output}/grid-${count}.png`);
    await client.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(250);
    stats.phone = await client.evaluate(`({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, mountedRows: document.querySelectorAll('tbody tr[data-row]').length })`);
    assert.equal(stats.phone.documentWidth, 390);
    assert.ok(stats.phone.mountedRows < 80);
    await client.capture(`${output}/grid-${count}-mobile.png`);
    results.push(stats);
    await client.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await pluginRpc('studio-tables', 'remove', { id }); id = null;
  }
  await writeFile(`${output}/verification.json`, JSON.stringify({ source: 'cc3065e', results, boundaries: ['Fixed navigation wait is included; timings are not a benchmark.', 'Full table data still loads and sorts locally.', 'Board/calendar, remote latency and memory growth over repeated sessions are not measured.'] }, null, 2) + '\n');
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} finally {
  if (id) await pluginRpc('studio-tables', 'remove', { id });
  client.socket?.close();
  if (browser.process) { const exited = new Promise(resolve => browser.process.once('exit', resolve)); browser.process.kill(); await Promise.race([exited, sleep(5000)]); }
  if (browser.profileDir) await rm(browser.profileDir, { recursive: true, force: true });
}
