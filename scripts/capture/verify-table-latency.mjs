import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpClient, ensureChrome } from './driver.mjs';
import { pluginRpc, projectId, serverUrl, sleep } from './bb.mjs';

const manifest = await readFile('/tmp/bb-studio-goal-staged/capture.env','utf8');
assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(process.env.BB_DATA_DIR)}`));
assert.ok(manifest.includes(`export BB_SERVER_URL=${serverUrl}`));
assert.equal(process.env.BB_CAPTURE_CDP_PORT,'49569');
await assert.rejects(fetch('http://127.0.0.1:49569/json/version'),'Port must be unused');
const source = JSON.parse(execFileSync('sqlite3',[`${process.env.BB_DATA_DIR}/bb.db`,'-json',"SELECT p.git_resolved_commit AS commit_hash,p.enabled,a.content_hash AS artifact_hash FROM plugins p JOIN plugin_artifacts a ON a.id=p.active_artifact_id WHERE p.id='studio-tables';"],{encoding:'utf8'}))[0];
source.resolvedCommit=execFileSync('git',['-C',`${process.env.BB_DATA_DIR}/plugins/cache/git/github.com/patleeman/bb-studio/${source.commit_hash}`,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const expectedSource=process.env.BB_TABLE_LATENCY_SOURCE??'c2bc4da5c2019fee6704b891a9d11e5ad954d472';
assert.match(expectedSource,/^[a-f0-9]{40}$/);
assert.equal(source.resolvedCommit,expectedSource);
assert.equal(source.enabled,1);
const expectRetry=process.env.BB_TABLE_LATENCY_EXPECT_RETRY==='1';
const output=resolve(`docs/review-evidence/2026-10-02/table-latency${expectRetry?'/after':''}`);
await mkdir(output,{recursive:true});
const browser=await ensureChrome();
assert.ok(browser.process,'Must own the browser');
const client=new CdpClient(browser.webSocketUrl);
await client.connect();
let id;
let phase='shell';
const requests=new Map();
const report={source,expectRetry,profiles:[],recovery:{},limits:[
  'CDP emulation applies only to this owned Chrome session. The server and machine network are unchanged.',
  'Local staged BB with simulated latency/bandwidth, not an actual remote server, physical phone, VPN, radio, packet loss, thermal or battery test.',
  'Studio shell and plugin code are loaded before measurements. Each measured table editor mounts afresh; this is not a cold application launch.',
  'Whole 5000-row table data still loads before the editor becomes ready; row windowing does not paginate the server request.',
  'One sample per profile on a shared development host; timings are fixture observations, not a controlled benchmark or guarantee.',
  'The failure phase blocks only the table get endpoint. It tests initial load and recovery, not offline writes or durable queues.',
]};
client.socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data),p=message.params;
  if(message.method==='Network.requestWillBeSent'&&p.request.url===`${serverUrl}/api/v1/plugins/studio/rpc/get`&&p.request.postData?.includes(id)) requests.set(p.requestId,{phase,requestId:p.requestId,started:p.timestamp,method:p.request.method});
  const request=requests.get(p?.requestId);
  if(!request) return;
  if(message.method==='Network.responseReceived') {request.status=p.response.status;request.responseAt=p.timestamp;request.mimeType=p.response.mimeType;}
  if(message.method==='Network.loadingFinished') {request.finished=p.timestamp;request.encodedBytes=p.encodedDataLength;}
  if(message.method==='Network.loadingFailed') {request.failed=p.errorText;request.finished=p.timestamp;}
});
const settled=async predicate=>client.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){if(${predicate})requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now())));else if(performance.now()-start>90000)reject(Error('Readiness timed out'));else setTimeout(check,20);}check();})`,true);
const route=async path=>client.evaluate(`(()=>{const state={usr:null,key:Math.random().toString(36).slice(2,10),idx:history.state?.idx??0};history.replaceState(state,'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate',{state}));return performance.now();})()`);
const observeLoad=async expected=>client.evaluate(`new Promise((resolve,reject)=>{const started=performance.now();let loadingSeen=false,loadingAt=null;function check(){const status=document.querySelector('.studio-root [role=status]');if(status?.innerText.includes('Loading table')){loadingSeen=true;loadingAt??=performance.now();}const error=document.querySelector('.studio-root [role=alert]')?.innerText;const ready=Boolean(document.querySelector('[data-cell="0:0"]'));if(${JSON.stringify(expected)}==='ready'&&ready||${JSON.stringify(expected)}==='error'&&error){requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({elapsedMs:performance.now()-started,loadingSeen,loadingAt,error:error??null,ready})));}else if(performance.now()-started>90000)reject(Error('Load timed out'));else setTimeout(check,10);}check();})`,true);
const network=async settings=>client.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,...settings});
const finalRow=async()=>{
  await client.evaluate(`document.querySelector('textarea[aria-label="Table cells"]').focus()`);
  await client.command('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',modifiers:2});
  await client.command('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',modifiers:2});
  await settled(`document.querySelector('[data-cell="4999:1"]')`);
  const result=await client.evaluate(`(()=>{const cell=document.querySelector('[data-cell="4999:1"]'),r=cell.getBoundingClientRect();return {text:cell.innerText,top:r.top,bottom:r.bottom,height:innerHeight,mountedRows:document.querySelectorAll('tbody tr[data-row]').length};})()`);
  assert.equal(result.text,'4,999'); assert.ok(result.top>=0&&result.bottom<=result.height);assert.ok(result.mountedRows<80);
  return result;
};
try {
  await client.command('Network.enable');
  await client.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  report.browser=await client.command('Browser.getVersion');
  const {table}=await pluginRpc('studio-tables','create',{title:'Latency QA 5000',projectId,columns:[{id:'name',name:'Name',type:'text'},{id:'qty',name:'Quantity',type:'number'}],rows:Array.from({length:5000},(_,i)=>({name:`Latency fixture ${i+1}`,qty:i}))});
  id=table.id;
  await client.navigate(`/plugins/studio/tables/${id}`);
  await settled(`document.querySelector('[data-cell="0:0"]')`);
  report.document=await client.evaluate(`({timeOrigin:performance.timeOrigin,token:(window.__latencyToken=crypto.randomUUID())})`);
  const close=async()=>{await route('/plugins/studio/tables');await settled(`!document.querySelector('input[aria-label="Table title"]')&&document.body.innerText.includes('Tables')`);};
  for(const profile of [
    {name:'local-control',latency:0,downloadThroughput:-1,uploadThroughput:-1},
    {name:'150ms-1.5Mbps',latency:150,downloadThroughput:187500,uploadThroughput:46875},
    {name:'400ms-512Kbps',latency:400,downloadThroughput:64000,uploadThroughput:16000},
  ]) {
    await network({});await close();phase=profile.name;await network(profile);
    const started=await route(`/plugins/studio/tables/${id}`);
    const load=await observeLoad('ready');
    load.routeToReadyMs=Math.round((await client.evaluate('performance.now()')-started)*10)/10;
    assert.equal(load.error,null);
    if(profile.latency) assert.equal(load.loadingSeen,true,'Throttled load must expose its loading state');
    const req=[...requests.values()].filter(request=>request.phase===phase).at(-1);
    assert.ok(req?.finished&&!req.failed&&req.status===200,'Measured table get did not complete successfully');
    const response=await client.command('Network.getResponseBody',{requestId:req.requestId});
    const body=response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body;
    const payload=JSON.parse(body);
    assert.equal(payload.result.table.rows.length,5000,'Expected a complete table response');
    const result={profile,load,request:{...req,elapsedMs:Math.round((req.finished-req.started)*1000),decodedBytes:Buffer.byteLength(body),returnedRows:payload.result.table.rows.length},finalRow:await finalRow()};
    await client.capture(`${output}/${profile.name}.png`);
    report.profiles.push(result);
    process.stdout.write(`Verified ${profile.name}: ${load.routeToReadyMs}ms\n`);
  }
  await network({});await close();phase='blocked-initial-get';
  await client.command('Network.setBlockedURLs',{urls:[`${serverUrl}/api/v1/plugins/studio/rpc/get`]});
  await route(`/plugins/studio/tables/${id}`);
  report.recovery.failure=await observeLoad('error');
  await client.capture(`${output}/failed-load.png`);
  report.recovery.errorControls=await client.evaluate(`Array.from(document.querySelectorAll('.studio-root button')).map(button=>({text:button.innerText,label:button.getAttribute('aria-label')}))`);
  assert.equal(report.recovery.failure.ready,false);
  await client.command('Network.setBlockedURLs',{urls:[]});
  const restoredAt=Date.now(),requestsBefore=requests.size;
  await sleep(6000);
  report.recovery.afterRestore={observationMs:Date.now()-restoredAt,newGetRequests:requests.size-requestsBefore,...await client.evaluate(`({error:document.querySelector('.studio-root [role=alert]')?.innerText??null,ready:Boolean(document.querySelector('[data-cell="0:0"]')),retryAvailable:Array.from(document.querySelectorAll('.studio-root button')).some(button=>/retry|try again/i.test(button.innerText+' '+button.getAttribute('aria-label')))})`)};
  if(expectRetry) {
    assert.equal(report.recovery.afterRestore.retryAvailable,true,'Failed table must expose Retry');
    phase='explicit-retry';
    await network({latency:400,downloadThroughput:64000,uploadThroughput:16000});
    const point=await client.evaluate(`(()=>{const button=Array.from(document.querySelectorAll('.studio-root button')).find(button=>/retry|try again/i.test(button.innerText+' '+button.getAttribute('aria-label')));const r=button.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await client.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
    await client.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
    const retryReady=observeLoad('ready');
    await settled(`document.querySelector('.studio-root [role=status]')?.innerText.includes('Loading table')`);
    report.recovery.retryLoading=await client.evaluate(`({loading:document.querySelector('.studio-root [role=status]')?.innerText,error:document.querySelector('.studio-root [role=alert]')?.innerText??null})`);
    assert.equal(report.recovery.retryLoading.error,null,'Retry must clear the old alert while loading');
    await client.capture(`${output}/retry-loading.png`);
    report.recovery.retry=await retryReady;
    assert.equal(report.recovery.retry.loadingSeen,true);
    assert.equal(report.recovery.retry.error,null);
    report.recovery.retry.finalRow=await finalRow();
    const retried=[...requests.values()].filter(request=>request.phase==='explicit-retry');
    assert.equal(retried.length,1,'One Retry click must issue one table get');
    assert.equal(retried[0].status,200);
    report.recovery.retry.request=retried[0];
    await client.capture(`${output}/retry-recovered.png`);
    await network({});
  }
  phase='reopen-recovery';await close();const reopenStarted=await route(`/plugins/studio/tables/${id}`);
  report.recovery.reopen=await observeLoad('ready');
  report.recovery.reopen.routeToReadyMs=Math.round((await client.evaluate('performance.now()')-reopenStarted)*10)/10;
  report.recovery.reopen.finalRow=await finalRow();
  await client.capture(`${output}/recovered-load.png`);
  const doc=await client.evaluate(`({timeOrigin:performance.timeOrigin,token:window.__latencyToken})`);
  assert.deepEqual(doc,report.document,'Measured navigation must not reload the document');
  report.requests=[...requests.values()];
  await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({profiles:report.profiles.map(({profile,load,request})=>({name:profile.name,readyMs:load.routeToReadyMs,requestMs:request.elapsedMs,encodedBytes:request.encodedBytes,decodedBytes:request.decodedBytes,rows:request.returnedRows})),recovery:report.recovery},null,2)+'\n');
} finally {
  await client.command('Network.setBlockedURLs',{urls:[]}).catch(()=>{});
  await network({}).catch(()=>{});
  try {
    if(id) await pluginRpc('studio-tables','remove',{id});
  } finally {
    client.socket?.close();
    const exited=new Promise(resolve=>browser.process.once('exit',resolve));browser.process.kill();await Promise.race([exited,sleep(5000)]);
    await rm(browser.profileDir,{recursive:true,force:true});
  }
}
