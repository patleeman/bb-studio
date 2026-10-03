// Opt-in real BB title recovery proof; only an owned page/browser are changed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpClient, ensureChrome } from './driver.mjs';
import { pluginRpc, projectId, serverUrl, sleep } from './bb.mjs';

const expected = process.env.BB_PAGES_TITLE_SOURCE;
assert.match(expected ?? '', /^[a-f0-9]{40}$/);
const manifest = await readFile('/tmp/bb-studio-goal-staged/capture.env','utf8');
assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(process.env.BB_DATA_DIR)}`));
assert.ok(manifest.includes(`export BB_SERVER_URL=${serverUrl}`));
assert.equal(process.env.BB_CAPTURE_CDP_PORT,'49569');
await assert.rejects(fetch('http://127.0.0.1:49569/json/version'),'Port must be unused');
const source = JSON.parse(execFileSync('sqlite3',[`${process.env.BB_DATA_DIR}/bb.db`,'-json',"SELECT p.git_resolved_commit AS commit_hash,p.enabled,a.content_hash AS artifact_hash FROM plugins p JOIN plugin_artifacts a ON a.id=p.active_artifact_id WHERE p.id='pages';"],{encoding:'utf8'}))[0];
source.resolvedCommit = execFileSync('git',['-C',`${process.env.BB_DATA_DIR}/plugins/cache/git/github.com/patleeman/bb-studio/${source.commit_hash}`,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(source.resolvedCommit,expected); assert.equal(source.enabled,1);
const expectRecovery = process.env.BB_PAGES_TITLE_EXPECT_RECOVERY==='1';
const variant=process.env.BB_PAGES_TITLE_VARIANT??(expectRecovery?'after':'before');
assert.match(variant,/^[a-z0-9-]+$/);
const output = resolve(`docs/review-evidence/2026-10-02/page-title-recovery/${variant}`);
await mkdir(output,{recursive:true});
const browser = await ensureChrome(); assert.ok(browser.process,'Must own the browser');
const client = new CdpClient(browser.webSocketUrl); await client.connect();
let id,removed=false;
const titleSelector = '.pages-doc textarea[placeholder="Untitled"]';
const value = () => client.evaluate(`document.querySelector(${JSON.stringify(titleSelector)})?.value`);
const wait = async predicate => {
  const start = Date.now();
  while(Date.now()-start<20000) { try { if(await client.evaluate(predicate))return; } catch {} await sleep(100); }
  throw Error(`Timed out: ${predicate}\n${await client.evaluate('document.body?.innerText')}`);
};
const edit = async text => {
  await client.evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(titleSelector)});field.focus();field.select();})()`);
  await client.command('Input.insertText',{text});
  await wait(`document.querySelector(${JSON.stringify(titleSelector)})?.value===${JSON.stringify(text)}`);
};
const route = path => client.evaluate(`(()=>{const state={usr:null,key:crypto.randomUUID(),idx:history.state?.idx??0};history.replaceState(state,'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate',{state}));})()`);
const guard = () => client.evaluate(`(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented;})()`);
const serverTitle = async () => (await pluginRpc('pages','get',{id})).page.title;
const report = { source, expectRecovery, limits: ['Owned staged BB page and Chrome session; blocked requests affect only this browser.', 'Title metadata recovery is separate from Yjs body recovery.', '390px viewport emulation is not physical iOS or VoiceOver.'] };
let phase='failed-save',dropResponse=false;
const requests=[];
client.socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data),p=message.params;
  if(message.method==='Network.requestWillBeSent'&&p.request.url===`${serverUrl}/api/v1/plugins/pages/rpc/update`)requests.push({phase,requestId:p.requestId,body:p.request.postData});
  if(message.method==='Fetch.requestPaused') {
    const method=dropResponse&&p.responseStatusCode===200?'Fetch.failRequest':'Fetch.continueRequest';
    if(method==='Fetch.failRequest'){dropResponse=false;report.lostResponseDropped=true;}
    void client.command(method,{requestId:p.requestId,...(method==='Fetch.failRequest'?{errorReason:'Aborted'}:{})}).catch(error=>{report.interceptorError=String(error);});
  }
});
try {
  await client.command('Network.enable');
  await client.command('Page.enable');
  await client.command('Page.addScriptToEvaluateOnNewDocument',{source:`
    const originalSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(window.__qaTitleQuota&&this===localStorage&&String(key).startsWith('bb-studio-pages:title:'))throw new DOMException('Controlled title quota failure','QuotaExceededError');return originalSet.call(this,key,value);};
    const originalGet=Storage.prototype.getItem;
    Storage.prototype.getItem=function(key){if(this===localStorage&&String(key).startsWith('bb-studio-pages:title:')&&sessionStorage.getItem('qaTitleReadFailure')==='true')throw new DOMException('Controlled title read failure','UnknownError');return originalGet.call(this,key);};
    window.__qaPagesSockets=[];
    const NativeWebSocket=WebSocket;
    window.WebSocket=class extends NativeWebSocket{constructor(url,protocols){super(url,...(protocols===undefined?[]:[protocols]));if(String(url).includes('/api/v1/plugins/pages/http/sync?'))window.__qaPagesSockets.push(this);}};
  `});
  await client.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  ({page:{id}} = await pluginRpc('pages','create',{projectId,parentId:null,title:'Title recovery baseline',markdown:'Title recovery fixture body.'}));
  await client.navigate(`/plugins/pages/pages/${id}`);
  await client.waitForSelector(titleSelector);
  assert.equal(await value(),'Title recovery baseline');
  await client.command('Network.setBlockedURLs',{urls:[`${serverUrl}/api/v1/plugins/pages/rpc/update`]});
  await edit('Offline title draft');
  await sleep(1500);
  report.failedRequest = { displayedTitle:await value(),serverTitle:await serverTitle(),bodyText:await client.evaluate('document.querySelector(".pages-doc")?.innerText') };
  assert.equal(report.failedRequest.serverTitle,'Title recovery baseline');
  await client.capture(`${output}/failed-title-phone.png`);
  const oldOrigin = await client.evaluate('performance.timeOrigin');
  await client.command('Page.reload');
  await wait(`performance.timeOrigin!==${oldOrigin}&&!!document.querySelector(${JSON.stringify(titleSelector)})`);
  report.reload = { oldOrigin,newOrigin:await client.evaluate('performance.timeOrigin'),displayedTitle:await value(),serverTitle:await serverTitle() };
  await client.capture(`${output}/reloaded-title-phone.png`);
  if(!expectRecovery) {
    assert.equal(report.reload.displayedTitle,'Title recovery baseline','Expected the pre-fix title-loss reproduction');
    report.reproducedLoss = true;
  } else {
    assert.equal(report.reload.displayedTitle,'Offline title draft','The title draft must survive a new document');
    await client.waitForText('Recovered an unsaved title draft.');
    await client.command('Network.setBlockedURLs',{urls:[]});
    await client.clickElementWithTextAndPointer('button','Retry title save');
    await wait(`!document.querySelector('.pages-doc')?.innerText.includes('Saving title to BB')&&!document.querySelector('.pages-doc')?.innerText.includes('Retry title save')`);
    assert.equal(await serverTitle(),'Offline title draft');
    report.retry={saved:true};

    phase='conflict';
    await client.command('Network.setBlockedURLs',{urls:[`${serverUrl}/api/v1/plugins/pages/rpc/update`]});
    await edit('Local conflict draft');
    await client.waitForText('Title save failed.');
    await pluginRpc('pages','update',{id,title:'Remote title changed'});
    await client.command('Network.setBlockedURLs',{urls:[]});
    await client.clickElementWithTextAndPointer('button','Retry title save');
    await client.waitForText('The title changed in BB. Your title draft is kept here.');
    assert.equal(await value(),'Local conflict draft');
    assert.equal(await serverTitle(),'Remote title changed');
    report.conflict={local:await value(),remote:await serverTitle()};
    report.controls=await client.evaluate(`Array.from(document.querySelectorAll('.pages-doc button')).filter(el=>['Retry title save','Use my title','Download title draft','Discard title draft'].includes(el.innerText)).map(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{text:el.innerText,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hit:el===hit||el.contains(hit)};})`);
    assert.equal(report.controls.length,4);
    for(const c of report.controls)assert.ok(c.left>=0&&c.right<=390&&c.top>=0&&c.bottom<=844&&c.bottom-c.top>=44&&c.hit,JSON.stringify(c));
    await client.capture(`${output}/title-conflict-phone.png`);
    const downloads=`${output}/downloads`;await mkdir(downloads,{recursive:true});
    await client.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    await client.clickElementWithTextAndPointer('button','Download title draft');
    for(let i=0;i<100&&!(await readdir(downloads)).includes(`${id}-title-recovery.json`);i++)await sleep(100);
    const backup=JSON.parse(await readFile(`${downloads}/${id}-title-recovery.json`,'utf8'));
    assert.equal(backup.draft.title,'Local conflict draft');
    report.export={filename:`${id}-title-recovery.json`,containsLatestDraft:true};
    await client.clickElementWithTextAndPointer('button','Use my title');
    await wait(`!document.querySelector('.pages-doc')?.innerText.includes('Use my title')&&!document.querySelector('.pages-doc')?.innerText.includes('Saving title to BB')`);
    assert.equal(await serverTitle(),'Local conflict draft');
    report.conflict.explicitChoiceSaved=true;
    await assert.rejects(pluginRpc('pages','update',{id,title:'Stale CAS overwrite',expectedTitle:'Remote title changed'}));
    assert.equal(await serverTitle(),'Local conflict draft');
    report.conflict.staleCompareRejected=true;

    phase='discard';
    await client.command('Network.setBlockedURLs',{urls:[`${serverUrl}/api/v1/plugins/pages/rpc/update`]});
    await edit('Discard this title draft');
    await client.waitForText('Title save failed.');
    await client.clickElementWithTextAndPointer('button','Discard title draft');
    assert.equal(await value(),'Local conflict draft');
    assert.equal(await serverTitle(),'Local conflict draft');
    report.discard={restoredSavedTitle:true};
    await client.command('Network.setBlockedURLs',{urls:[]});

    phase='local-write-failure';
    await client.command('Network.setBlockedURLs',{urls:[`${serverUrl}/api/v1/plugins/pages/rpc/update`]});
    await edit('Earlier durable title draft');
    await client.waitForText('Title save failed.');
    await client.evaluate('window.__qaTitleQuota=true');
    await edit('Memory-only title draft');
    await client.waitForText('Title save failed.');
    await client.waitForText('Local title recovery failed.');
    assert.equal(await guard(),true,'Memory-only title must warn before exit');
    await client.capture(`${output}/title-local-failure-phone.png`);
    await route('/plugins/studio/studio/page');
    await wait(`!document.querySelector(${JSON.stringify(titleSelector)})`);
    assert.equal(await guard(),true,'Navigation must not remove the memory-only title warning');
    await route(`/plugins/pages/pages/${id}`);
    await wait(`document.querySelector(${JSON.stringify(titleSelector)})?.value==='Memory-only title draft'`);
    await client.evaluate('window.__qaTitleQuota=false');
    await client.clickElementWithTextAndPointer('button','Retry title save');
    await client.waitForText('Title save failed.');
    assert.equal(await guard(),false,'A durable local title must release the exit warning');
    await client.command('Network.setBlockedURLs',{urls:[]});
    await client.clickElementWithTextAndPointer('button','Retry title save');
    await wait(`!document.querySelector('.pages-doc')?.innerText.includes('Saving title to BB')&&!document.querySelector('.pages-doc')?.innerText.includes('Retry title save')`);
    assert.equal(await serverTitle(),'Memory-only title draft');
    const remainingDrafts=await client.evaluate(`Object.keys(localStorage).filter(key=>key.startsWith('bb-studio-pages:title:')&&key.includes(${JSON.stringify(id)}))`);
    assert.equal(remainingDrafts.length,0,'Successful newer title must not leave this editor’s superseded draft');
    report.localWriteFailure={retainedAcrossNavigation:true,warningRetained:true,localRetrySaved:true,serverRetrySaved:true,supersededDraftRemoved:true};

    phase='lost-response';dropResponse=true;
    await client.command('Fetch.enable',{patterns:[{urlPattern:`${serverUrl}/api/v1/plugins/pages/rpc/update`,requestStage:'Response'}]});
    await edit('Committed with lost response');
    await wait(`!document.querySelector('.pages-doc')?.innerText.includes('Saving title to BB')&&!document.querySelector('.pages-doc')?.innerText.includes('Retry title save')`);
    await client.command('Fetch.disable');
    assert.equal(report.lostResponseDropped,true);
    assert.equal(await serverTitle(),'Committed with lost response');
    assert.equal(requests.filter(request=>request.phase==='lost-response').length,1);
    assert.equal(report.interceptorError,undefined);
    report.lostResponse={reconciled:true,writeRequests:1};
    await client.capture(`${output}/title-recovered-phone.png`);
    if(process.env.BB_PAGES_TITLE_DELETED==='1') {
      phase='deleted-title';
      await client.command('Network.setBlockedURLs',{urls:[`${serverUrl}/api/v1/plugins/pages/rpc/update`]});
      await edit('Deleted page title draft');
      await client.waitForText('Title save failed.');
      await pluginRpc('pages','remove',{id});removed=true;
      await client.waitForText('Page unavailable');
      await client.waitForText('No local content recovery was found');
      await client.waitForText('Retained title: Deleted page title draft');
      await client.capture(`${output}/deleted-title-phone.png`);
      await client.evaluate(`sessionStorage.setItem('qaTitleReadFailure','true')`);
      const oldDocument=await client.evaluate('performance.timeOrigin');
      await client.command('Page.reload');
      await wait(`performance.timeOrigin!==${oldDocument}&&document.body.innerText.includes('Retry reading title recovery')`);
      await client.evaluate(`sessionStorage.setItem('qaTitleReadFailure','false')`);
      await client.clickElementWithTextAndPointer('button','Retry reading title recovery');
      await client.waitForText('Retained title: Deleted page title draft');
      const sockets=await client.evaluate('window.__qaPagesSockets.length');assert.equal(sockets,0);
      const deletedDownloads=`${output}/deleted-downloads`;await mkdir(deletedDownloads,{recursive:true});
      await client.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:deletedDownloads});
      await client.clickElementWithTextAndPointer('button','Download title recovery');
      for(let i=0;i<100&&!(await readdir(deletedDownloads)).includes(`${id}-title-recovery.json`);i++)await sleep(100);
      const deletedBackup=JSON.parse(await readFile(`${deletedDownloads}/${id}-title-recovery.json`,'utf8'));
      assert.ok(deletedBackup.drafts.some(draft=>draft.title==='Deleted page title draft'));
      assert.equal((await pluginRpc('pages','get',{id})).page,null);
      report.deleted={retainedAfterReload:true,readRetry:true,bodyRecoveryAbsent:true,pagesSockets:sockets,notRecreated:true,exportFilename:`${id}-title-recovery.json`};
      await client.capture(`${output}/deleted-title-reloaded-phone.png`);
      const corruptKey=await client.evaluate(`(()=>{const key='bb-studio-pages:title:'+JSON.stringify([location.origin,${JSON.stringify(id)}])+':qa-cycle';localStorage.setItem(key,JSON.stringify({id:'qa-cycle',title:'Controlled cyclic record',base:'',at:Date.now(),supersedes:'qa-cycle'}));return key;})()`);
      const beforeCorruption=await client.evaluate('performance.timeOrigin');
      await client.command('Page.reload');
      await wait(`performance.timeOrigin!==${beforeCorruption}&&document.body.innerText.includes('Could not read all title recovery data')`);
      const corruptDownloads=`${output}/corrupt-downloads`;await mkdir(corruptDownloads,{recursive:true});
      await client.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:corruptDownloads});
      await client.clickElementWithTextAndPointer('button','Download title recovery');
      for(let i=0;i<100&&!(await readdir(corruptDownloads)).includes(`${id}-title-recovery.json`);i++)await sleep(100);
      const corruptBackup=JSON.parse(await readFile(`${corruptDownloads}/${id}-title-recovery.json`,'utf8'));
      assert.ok(corruptBackup.browserRecovery.records[corruptKey].includes('Controlled cyclic record'));
      assert.ok(JSON.stringify(corruptBackup.browserRecovery.records).includes('Deleted page title draft'));
      await client.capture(`${output}/corrupt-title-recovery-phone.png`);
      await client.evaluate(`localStorage.removeItem(${JSON.stringify(corruptKey)})`);
      await client.clickElementWithTextAndPointer('button','Retry reading title recovery');
      await client.waitForText('Retained title: Deleted page title draft');
      report.corruptRecovery={recognized:true,rawCorruptExport:true,validDraftPreserved:true,ownedInjectedRecordRemoved:true};
    }
    report.passed=true;
  }
} catch(error) { report.failure=String(error?.stack??error);await client.capture(`${output}/failure.png`).catch(()=>{});throw error; }
finally {
  await client.command('Network.setBlockedURLs',{urls:[]}).catch(()=>{});
  await client.command('Fetch.disable').catch(()=>{});
  try { if(id&&!removed){await pluginRpc('pages','remove',{id});removed=true;} }
  finally {
    client.socket?.close();
    const exited=new Promise(resolve=>browser.process.once('exit',resolve));browser.process.kill();await Promise.race([exited,sleep(5000)]);
    await rm(browser.profileDir,{recursive:true,force:true});
    report.cleanup={ownedPageRemoved:removed,ownedBrowserClosed:browser.process.exitCode!==null};
    await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2)+'\n');
  }
}
