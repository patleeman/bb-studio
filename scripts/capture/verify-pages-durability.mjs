// Real staged BB proof. Faults are confined to one disposable page and browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { CdpClient, ensureChrome } from './driver.mjs';
import { pluginRpc, projectId, serverUrl, sleep } from './bb.mjs';

const require = createRequire(resolve('packages/bb-studio-pages/package.json'));
const Y = require('yjs');
const expected = process.env.BB_PAGES_DURABILITY_SOURCE;
assert.match(expected ?? '', /^[a-f0-9]{40}$/);
const manifest = await readFile('/tmp/bb-studio-goal-staged/capture.env', 'utf8');
assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(process.env.BB_DATA_DIR)}`));
assert.ok(manifest.includes(`export BB_SERVER_URL=${serverUrl}`));
assert.equal(process.env.BB_CAPTURE_CDP_PORT, '49569');
await assert.rejects(fetch('http://127.0.0.1:49569/json/version'), 'Capture port must be unused');
const db = `${process.env.BB_DATA_DIR}/plugins/pages/data.db`;
const sql = query => execFileSync('sqlite3', [db, '-json', query], { encoding: 'utf8' });
const source = JSON.parse(execFileSync('sqlite3', [`${process.env.BB_DATA_DIR}/bb.db`, '-json', "SELECT p.git_resolved_commit AS commit_hash,p.enabled,a.content_hash AS artifact_hash FROM plugins p JOIN plugin_artifacts a ON a.id=p.active_artifact_id WHERE p.id='pages';"], { encoding: 'utf8' }))[0];
source.resolvedCommit = execFileSync('git', ['-C', `${process.env.BB_DATA_DIR}/plugins/cache/git/github.com/patleeman/bb-studio/${source.commit_hash}`, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(source.resolvedCommit, expected);
assert.equal(source.enabled, 1);
const output = resolve('docs/review-evidence/2026-10-02/pages-durability');
await mkdir(output, { recursive: true });
const downloads = `${output}/downloads`;
await mkdir(downloads, { recursive: true });
const browser = await ensureChrome();
assert.ok(browser.process, 'Must own the browser');
const client = new CdpClient(browser.webSocketUrl);
await client.connect();
let id, removed = false, secondary, triggerCreated = false;
const trigger = 'qa_pages_durability_owned';
const report = { source, phases: {}, limits: [
  'Staged stable BB and an owned Chrome profile; no production data or machine network changes.',
  'The socket fault redirects only this browser’s Pages sync connections. HTTP metadata and the BB shell remain reachable; this is not a fully offline application-launch claim.',
  'The SQLite failure trigger applies only to the disposable page. It tests a real rejected server database write, not a physically full disk.',
  'The quota phase injects an IndexedDB write exception in the owned browser. Other phases use unmodified real IndexedDB.',
  'Recovery downloads preserve Yjs blocks/comments but are not Markdown documents or a normal UI import workflow.',
  'Phone proof uses a 390px Chrome viewport, not a physical device or VoiceOver.',
] };
const note = value => process.stdout.write(`${value}\n`);
const wait = async (predicate, timeout = 20000, tab = client) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await tab.evaluate(predicate)) return; } catch { /* new document may be loading */ }
    await sleep(100);
  }
  throw new Error(`Timed out: ${predicate}\n${await tab.evaluate('document.body?.innerText')}`);
};
const status = () => client.evaluate(`document.querySelector('.pages-doc [role="status"]')?.innerText ?? ''`);
const waitStatus = text => wait(`document.querySelector('.pages-doc [role="status"]')?.innerText.includes(${JSON.stringify(text)})`);
const disk = () => JSON.parse(sql(`SELECT markdown,hex(state) AS state FROM pages WHERE id='${id}'`))[0];
const recovery = () => client.evaluate(`new Promise((resolve,reject)=>{
  const request=indexedDB.open('bb-studio-pages:recovery',1);
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('pages','readonly'),get=tx.objectStore('pages').get(JSON.stringify([location.origin,${JSON.stringify(id)}]));tx.oncomplete=()=>{resolve(get.result?Array.from(new Uint8Array(get.result)):null);db.close();};tx.onerror=()=>{reject(tx.error);db.close();};};
})`, true);
const decoded = bytes => {
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, Uint8Array.from(bytes)); return doc.getXmlFragment('document').toString(); }
  finally { doc.destroy(); }
};
const recordRecovery = async marker => {
  const bytes = await recovery();
  assert.ok(bytes?.length, 'Expected a real persisted recovery record');
  const xml = decoded(bytes);
  assert.ok(xml.includes(marker), `Recovery did not contain ${marker}: ${xml}`);
  return { bytes: bytes.length, sha256: createHash('sha256').update(Uint8Array.from(bytes)).digest('hex'), contains: marker };
};
const edit = async (text, tab = client) => {
  await tab.evaluate(`(()=>{const el=document.querySelector('.pages-main .bn-inline-content');if(!el)throw Error('No live editor');el.closest('[contenteditable=true]').focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);})()`);
  await tab.command('Input.insertText', { text });
  await wait(`document.querySelector('.pages-main .bn-editor')?.innerText.includes(${JSON.stringify(text)})`, 20000, tab);
};
const blockSocket = async blocked => client.evaluate(`(()=>{sessionStorage.setItem('qa-pages-block-sync',${JSON.stringify(String(blocked))});if(${blocked})for(const ws of window.__qaPageSockets)ws.close();else dispatchEvent(new Event('online'));})()`);
const route = path => client.evaluate(`(()=>{const state={usr:null,key:crypto.randomUUID(),idx:history.state?.idx??0};history.replaceState(state,'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate',{state}));})()`);
const screenshot = name => client.capture(`${output}/${name}.png`);
try {
  await client.command('Page.enable');
  await client.command('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__qaPageSockets=[];
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket {
      constructor(url,protocols){const page=String(url).includes('/api/v1/plugins/pages/http/sync?');const blocked=page&&sessionStorage.getItem('qa-pages-block-sync')==='true';const target=blocked?String(url).replace('/http/sync?','/http/qa-disabled-sync?'):url;super(target,...(protocols===undefined?[]:[protocols]));if(page)window.__qaPageSockets.push(this);}
    };
    const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){if(window.__qaFailRecovery&&this.transaction.db.name==='bb-studio-pages:recovery')throw new DOMException('Controlled recovery quota failure','QuotaExceededError');return originalPut.apply(this,args);};
    const originalGet=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(...args){if(sessionStorage.getItem('qa-pages-fail-read')==='true'&&this.transaction.db.name==='bb-studio-pages:recovery')throw new DOMException('Controlled recovery read failure','UnknownError');return originalGet.apply(this,args);};
  ` });
  await client.command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await client.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  report.browser = await client.command('Browser.getVersion');
  ({ page: { id } } = await pluginRpc('pages', 'create', { projectId, parentId: null, title: 'Pages recovery QA', markdown: 'Recovery baseline.' }));
  assert.match(id, /^pg_[a-z0-9]+$/);
  report.fixture = { pageId: id, projectId };
  await client.navigate(`/plugins/pages/pages/${id}`);
  await client.waitForText('Recovery baseline.');
  await waitStatus('Content saved to BB');
  assert.ok(disk().markdown.includes('Recovery baseline.'));
  report.phases.control = { status: await status(), diskConfirmed: true };

  await blockSocket(true);
  await edit(' Offline recovery marker.');
  await waitStatus('Saved on this browser');
  assert.ok(!disk().markdown.includes('Offline recovery marker.'));
  report.phases.offline = { status: await status(), recovery: await recordRecovery('Offline recovery marker.'), absentFromServerDisk: true };
  await screenshot('offline-local-backup');
  const { targetId } = await client.command('Target.createTarget', { url: 'about:blank' });
  const targets = await fetch('http://127.0.0.1:49569/json/list').then(response=>response.json());
  secondary = new CdpClient(targets.find(target=>target.id===targetId).webSocketDebuggerUrl);
  await secondary.connect();
  await secondary.command('Page.addScriptToEvaluateOnNewDocument', { source: `
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket { constructor(url,protocols){const target=String(url).includes('/api/v1/plugins/pages/http/sync?')?String(url).replace('/http/sync?','/http/qa-disabled-sync?'):url;super(target,...(protocols===undefined?[]:[protocols]));} };
  ` });
  await secondary.navigate(`/plugins/pages/pages/${id}`);
  await wait(`document.querySelector('.pages-main .bn-editor')?.innerText.includes('Offline recovery marker.')`, 20000, secondary);
  await Promise.all([edit(' First tab marker.'),edit(' Second tab marker.', secondary)]);
  await waitStatus('Saved on this browser');
  await wait(`document.querySelector('.pages-doc [role=status]')?.innerText.includes('Saved on this browser')`, 20000, secondary);
  report.phases.concurrentTabs = { first: await recordRecovery('First tab marker.'), second: await recordRecovery('Second tab marker.'), absentFromServerDisk: !disk().markdown.includes('tab marker.') };
  assert.equal(report.phases.concurrentTabs.absentFromServerDisk,true);
  await secondary.command('Target.closeTarget', { targetId });
  secondary.socket.close();
  secondary = null;
  const oldOrigin = await client.evaluate('performance.timeOrigin');
  await client.command('Page.reload');
  await wait(`performance.timeOrigin!==${oldOrigin}&&!!document.querySelector('.pages-main .bn-editor')`);
  await wait(`document.querySelector('.pages-main .bn-editor')?.innerText.includes('Offline recovery marker.')`);
  await wait(`document.querySelector('.pages-main .bn-editor')?.innerText.includes('First tab marker.')&&document.querySelector('.pages-main .bn-editor')?.innerText.includes('Second tab marker.')`);
  await waitStatus('Saved on this browser');
  report.phases.reload = { oldTimeOrigin: oldOrigin, newTimeOrigin: await client.evaluate('performance.timeOrigin'), status: await status(), recovery: await recordRecovery('Offline recovery marker.'), absentFromServerDisk: !disk().markdown.includes('Offline recovery marker.') };
  assert.equal(report.phases.reload.absentFromServerDisk, true);
  await screenshot('reloaded-local-backup');
  await blockSocket(false);
  await waitStatus('Content saved to BB');
  assert.ok(disk().markdown.includes('Offline recovery marker.'));
  await sleep(300);
  assert.equal(await recovery(), null, 'Confirmed recovery snapshot must be removed');
  report.phases.reconnect = { status: await status(), diskConfirmed: true, recoveryRemoved: true };

  assert.equal(sql(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='${trigger}'`).trim(), '', 'Do not replace an existing trigger');
  sql(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF state ON pages WHEN NEW.id='${id}' BEGIN SELECT RAISE(FAIL,'Controlled Pages QA disk write rejection'); END;`);
  triggerCreated = true;
  await edit(' Disk failure marker.');
  await waitStatus('BB save failed');
  assert.ok(!disk().markdown.includes('Disk failure marker.'));
  report.phases.diskFailure = { status: await status(), recovery: await recordRecovery('Disk failure marker.'), absentFromServerDisk: true };
  await screenshot('server-write-failure');
  await client.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  report.phases.phone = await client.evaluate(`(()=>{const status=document.querySelector('.pages-doc [role=status]'),row=status.parentElement;return {width:innerWidth,height:innerHeight,status:status.innerText,controls:[...row.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {text:el.innerText,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hit:el===hit||el.contains(hit)};})};})()`);
  assert.equal(report.phases.phone.controls.length, 2);
  for (const control of report.phases.phone.controls) assert.ok(control.left>=0&&control.right<=390&&control.top>=0&&control.bottom<=844&&control.bottom-control.top>=44&&control.hit, JSON.stringify(control));
  await screenshot('server-write-failure-phone');
  await client.clickElementWithTextAndPointer('.pages-doc button', 'Download recovery file (.yjs)');
  for (let i=0;i<100&&!(await readdir(downloads)).includes(`${id}-recovery.yjs`);i++) await sleep(100);
  const backup = await readFile(`${downloads}/${id}-recovery.yjs`);
  assert.ok(decoded(backup).includes('Disk failure marker.'));
  report.phases.export = { filename: `${id}-recovery.yjs`, bytes: backup.length, validYjs: true, containsLatestEdit: true };
  sql(`DROP TRIGGER ${trigger};`);
  triggerCreated = false;
  await client.clickElementWithTextAndPointer('.pages-doc button', 'Retry save');
  await waitStatus('Content saved to BB');
  assert.ok(disk().markdown.includes('Disk failure marker.'));
  report.phases.diskRecovery = { status: await status(), diskConfirmed: true };
  await screenshot('server-write-recovered-phone');

  await blockSocket(true);
  await client.evaluate('window.__qaFailRecovery=true');
  await edit(' Memory only quota marker.');
  await waitStatus('Local recovery failed');
  assert.ok(!disk().markdown.includes('Memory only quota marker.'));
  const guard = () => client.evaluate(`(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return {prevented:event.defaultPrevented,memoryRecords:window[Symbol.for('bb-studio-pages:pending-recovery')]?.states.size??0};})()`);
  report.phases.quotaFailure = { status: await status(), guard: await guard() };
  assert.equal(report.phases.quotaFailure.guard.prevented, true);
  await screenshot('local-recovery-failure-phone');
  await route('/plugins/studio/studio/page');
  await wait(`!document.querySelector('.pages-main')`);
  report.phases.quotaFailure.afterNavigationGuard = await guard();
  assert.equal(report.phases.quotaFailure.afterNavigationGuard.prevented, true);
  await route(`/plugins/pages/pages/${id}`);
  await wait(`document.querySelector('.pages-main .bn-editor')?.innerText.includes('Memory only quota marker.')`);
  await client.evaluate('window.__qaFailRecovery=false');
  await client.clickElementWithTextAndPointer('.pages-doc button', 'Retry save');
  await waitStatus('Saved on this browser');
  report.phases.quotaRecovery = { recovery: await recordRecovery('Memory only quota marker.'), guard: await guard() };
  assert.equal(report.phases.quotaRecovery.guard.prevented, false);
  await blockSocket(false);
  await waitStatus('Content saved to BB');
  assert.ok(disk().markdown.includes('Memory only quota marker.'));
  report.phases.quotaRecovery.diskConfirmed = true;
  await screenshot('all-recovered-phone');
  if (process.env.BB_CAPTURE_PAGES_DELETED === '1') {
    await blockSocket(true);
    await edit(' Deleted page recovery marker.');
    await waitStatus('Saved on this browser');
    await client.command('Network.enable');
    await client.command('Network.setBlockedURLs',{urls:[`${serverUrl}/api/v1/plugins/pages/rpc/get`]});
    const beforeMetadataFault = await client.evaluate('performance.timeOrigin');
    await client.command('Page.reload');
    await wait(`performance.timeOrigin!==${beforeMetadataFault}&&document.body.innerText.includes('Page unavailable')`);
    await client.waitForText('A local recovery copy is available.');
    await client.command('Network.setBlockedURLs',{urls:[]});
    await client.clickElementWithTextAndPointer('button','Retry loading page');
    await wait(`document.querySelector('.pages-main .bn-editor')?.innerText.includes('Deleted page recovery marker.')`);
    report.phases.metadataRetry = { recovered: true, recovery: await recordRecovery('Deleted page recovery marker.') };
    await pluginRpc('pages', 'remove', { id });
    removed = true;
    await client.waitForText('Page unavailable');
    await client.waitForText('A local recovery copy is available.');
    report.phases.deleted = { route: await client.evaluate('location.pathname'), recovery: await recordRecovery('Deleted page recovery marker.'), serverPage: (await pluginRpc('pages','get',{id})).page };
    assert.equal(report.phases.deleted.serverPage,null);
    assert.ok(report.phases.deleted.route.endsWith(id),'Deletion must retain the recovery route');
    await screenshot('deleted-page-recovery-phone');
    await client.evaluate(`sessionStorage.setItem('qa-pages-fail-read','true')`);
    const previousDocument = await client.evaluate('performance.timeOrigin');
    await client.command('Page.reload');
    await wait(`performance.timeOrigin!==${previousDocument}&&document.body.innerText.includes('Could not read local recovery')`);
    await client.evaluate(`sessionStorage.setItem('qa-pages-fail-read','false')`);
    await client.clickElementWithTextAndPointer('button', 'Retry reading recovery');
    await client.waitForText('A local recovery copy is available.');
    report.phases.deleted.newTimeOrigin = await client.evaluate('performance.timeOrigin');
    report.phases.deleted.pagesSocketsAfterReload = await client.evaluate('window.__qaPageSockets.length');
    assert.equal(report.phases.deleted.pagesSocketsAfterReload,0,'Missing metadata must not start page sync');
    const deletedDownloads = `${output}/deleted-downloads`;
    await mkdir(deletedDownloads,{recursive:true});
    await client.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:deletedDownloads});
    await client.clickElementWithTextAndPointer('button','Download recovery file');
    for(let i=0;i<100&&!(await readdir(deletedDownloads)).includes(`${id}-recovery.yjs`);i++) await sleep(100);
    const deletedBackup = await readFile(`${deletedDownloads}/${id}-recovery.yjs`);
    assert.ok(decoded(deletedBackup).includes('Deleted page recovery marker.'));
    report.phases.deleted.export = { filename: `${id}-recovery.yjs`, bytes: deletedBackup.length, validYjs: true, containsLatestEdit: true };
    report.phases.deleted.controls = await client.evaluate(`Array.from(document.querySelectorAll('button')).filter(el=>/Download recovery file|Retry loading page|Back to Studio/.test(el.innerText)).map(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {text:el.innerText,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hit:el===hit||el.contains(hit)};})`);
    for(const control of report.phases.deleted.controls) assert.ok(control.left>=0&&control.right<=390&&control.top>=0&&control.bottom<=844&&control.bottom-control.top>=44&&control.hit,JSON.stringify(control));
    await screenshot('deleted-page-reloaded-phone');
    assert.equal((await pluginRpc('pages','get',{id})).page,null);
    report.phases.deleted.notRecreated = true;
  }
  report.passed = true;
  note('Verified offline reload, real server write rejection, local write failure, retry, download and phone bounds.');
} catch (error) {
  report.failure = String(error?.stack ?? error);
  await screenshot('failure').catch(()=>{});
  throw error;
} finally {
  await client.command('Network.setBlockedURLs',{urls:[]}).catch(()=>{});
  try {
    if (triggerCreated) sql(`DROP TRIGGER ${trigger};`);
    if (id && !removed) { await pluginRpc('pages', 'remove', { id }); removed = true; }
  } finally {
    report.cleanup = { ownedPageRemoved: removed, ownedTriggerAbsent: sql(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='${trigger}'`).trim()==='' };
    secondary?.socket?.close();
    client.socket?.close();
    const exited = new Promise(resolve => browser.process.once('exit', resolve));
    browser.process.kill();
    await Promise.race([exited,sleep(5000)]);
    await rm(browser.profileDir,{recursive:true,force:true});
    report.cleanup.ownedBrowserClosed = browser.process.exitCode !== null;
    await writeFile(`${output}/verification.json`, JSON.stringify(report,null,2)+'\n');
  }
}
