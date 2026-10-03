import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpClient, ensureChrome } from './driver.mjs';
import { pluginRpc, projectId, serverUrl, sleep } from './bb.mjs';

// Only run with the deliberately staged instance and an unused private port.
const manifest = await readFile('/tmp/bb-studio-goal-staged/capture.env', 'utf8');
assert.ok(manifest.includes(`export BB_DATA_DIR=${JSON.stringify(process.env.BB_DATA_DIR)}`));
assert.ok(manifest.includes(`export BB_SERVER_URL=${serverUrl}`));
assert.equal(process.env.BB_CAPTURE_CDP_PORT, '49569');
await assert.rejects(fetch('http://127.0.0.1:49569/json/version'), 'Private CDP port must be unused');
const output = resolve(process.env.BB_TABLE_LIFECYCLE_OUTPUT ?? 'docs/review-evidence/2026-10-02/table-lifecycle/before');
const expectPaging = process.env.BB_TABLE_EXPECT_PAGING === '1';
await mkdir(output, { recursive: true });
const browser = await ensureChrome();
assert.ok(browser.process, 'Verifier must own its browser');
const client = new CdpClient(browser.webSocketUrl);
await client.connect();
let id;
const report = { environment: {}, views: [], interactions: [], lifecycle: [], limits: [
  'Host headless Chrome, not physical iPhone/WKWebView or battery measurements.',
  'Readiness is the requested view mounted followed by two animation frames; includes local RPC and host scheduling.',
  'Performance Nodes includes detached nodes; documentNodes counts only the live document. Explicit GC is not normal user behavior.',
  'Twenty measured navigation cycles after three warmup cycles can bound this run; they do not prove the absence of all leaks.',
  'Whole-table loading and queryRows remain client-side. Fixtures have short card content, three lanes, and dates in the current month.',
  'The host is shared with other QA/build work. Sequential fixture timings are observations, not a controlled causal benchmark.',
] };
const key = async (key, code, modifiers = 0) => {
  await client.command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await client.command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
};
const click = async (selector) => {
  const point = await client.evaluate(`(() => {const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error('Missing click target'); el.scrollIntoView({block:'nearest',inline:'nearest'}); const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
  await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
};
const settled = async (predicate) => client.evaluate(`new Promise((resolve,reject) => {const start=performance.now(); function check(){ if (${predicate}) requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()))); else if(performance.now()-start>15000) reject(Error('Readiness timeout: '+location.pathname)); else setTimeout(check,20);} check();})`, true);
const metrics = async () => {
  for (let pass = 0; pass < 3; pass++) { await client.command('HeapProfiler.collectGarbage'); await sleep(60); }
  const values = Object.fromEntries((await client.command('Performance.getMetrics')).metrics.map(({name,value}) => [name,value]));
  return { heapUsed: values.JSHeapUsedSize, heapTotal: values.JSHeapTotalSize, nodes: values.Nodes, documents: values.Documents, listeners: values.JSEventListeners, layoutCount: values.LayoutCount, taskDuration: values.TaskDuration,
    ...await client.evaluate(`({documentNodes:document.querySelectorAll('*').length,cards:document.querySelectorAll('button[draggable]').length,dialogs:document.querySelectorAll('[role=dialog]').length,timeOrigin:performance.timeOrigin,token:window.__lifecycleToken})`) };
};
const layout = async (kind) => client.evaluate(`(() => {
  const selectors=${JSON.stringify(kind === 'calendar' ? 'section[aria-label="Calendar"] nav button' : 'nav[aria-label$="cards"] button')};
  const controls=Array.from(document.querySelectorAll(selectors)).map(button=>{const r=button.getBoundingClientRect();return {label:button.getAttribute('aria-label'),width:r.width,height:r.height};});
  const days=${kind === 'calendar' ? `Array.from(document.querySelectorAll('section[aria-label="Calendar"] button[aria-label^="Add a row on"]')).map(button=>{const day=button.parentElement.parentElement;const r=day.getBoundingClientRect();return {day:button.getAttribute('aria-label'),bottom:r.bottom,contentBottom:Math.max(...Array.from(day.querySelectorAll('button')).map(item=>item.getBoundingClientRect().bottom))};})` : '[]'};
  return {controls,days};
})()`);
const route = async (path, predicate) => {
  const started = await client.evaluate(`(() => {const start=performance.now(); const idx=typeof history.state?.idx==='number'?history.state.idx:0; const state={usr:null,key:Math.random().toString(36).slice(2,10),idx}; history.replaceState(state,'',${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate',{state})); return start;})()`);
  const ended = await settled(predicate);
  return Math.round((ended - started) * 10) / 10;
};
try {
  await client.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await client.command('Performance.enable');
  report.environment.browser = await client.command('Browser.getVersion');
  report.environment.source = process.env.BB_TABLE_LIFECYCLE_SOURCE ?? '8d78251';
  report.environment.expectedPaging = expectPaging;
  // Calendar.today() follows the viewer's local day, including at UTC month boundaries.
  const fixtureMonth = await client.evaluate(`(() => { const now=new Date(); return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0'); })()`);
  report.environment.fixtureMonth = fixtureMonth;
  const { table } = await pluginRpc('studio-tables', 'create', {
    title: 'Lifecycle QA 5000', projectId,
    columns: [{id:'name',name:'Name',type:'text'}, {id:'status',name:'Status',type:'select',options:['Ready','In review','Done']}, {id:'date',name:'Date',type:'date'}, {id:'qty',name:'Quantity',type:'number'}],
    rows: Array.from({length:5000},(_,index)=>({name:`Lifecycle fixture ${index+1}`,status:['Ready','In review','Done'][index%3],date:`${fixtureMonth}-${String(index%28+1).padStart(2,'0')}`,qty:index})),
  });
  id=table.id;
  const views = [{id:'qa-grid',name:'Grid QA',type:'table'}, {id:'qa-board',name:'Board QA',type:'board',groupBy:'status'}, {id:'qa-calendar',name:'Calendar QA',type:'calendar',dateBy:'date'}].map(view=>({groupBy:null,dateBy:null,filters:[],sorts:[],hidden:[],...view}));
  await pluginRpc('studio-tables','update',{id,views});
  const base=`/plugins/studio/tables/${id}`;
  // Page.navigate is used once, outside all measurements. Every measured route stays in this document.
  await client.navigate(base);
  await settled(`document.querySelector('[data-cell="0:0"]')`);
  report.environment.document = await client.evaluate(`({timeOrigin:performance.timeOrigin,token:(window.__lifecycleToken=crypto.randomUUID())})`);
  const selectors={grid:`document.querySelector('[data-cell="0:0"]')`,board:`document.querySelector('section[aria-label="Ready"]')`,calendar:`document.querySelector('section[aria-label="Calendar"]')`,closed:`!document.querySelector('input[aria-label="Table title"]') && document.body.innerText.includes('Tables')`};
  const path = kind => kind==='closed'?'/plugins/studio/tables':`${base}/view/qa-${kind}`;
  for (const kind of ['board','calendar','grid']) {
    const readyMs = await route(path(kind),selectors[kind]);
    const stats = {kind,readyMs,...await metrics()};
    if(expectPaging && kind!=='grid') {
      stats.layout=await layout(kind);
      assert.ok(stats.layout.controls.every(button=>button.width>=28&&button.height>=28),'Paging controls must retain 28px minimum bounds');
      assert.ok(stats.layout.days.every(day=>day.contentBottom<=day.bottom+1),'Calendar content overlaps the following week');
    }
    if(expectPaging && kind==='board') assert.equal(stats.cards,150,'Dense board must bound each of its three lanes');
    if(expectPaging && kind==='calendar') assert.equal(stats.cards,280,'Distributed calendar must bound all 28 populated days');
    await client.capture(`${output}/${kind}-desktop.png`);
    await client.command('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
    await settled(selectors[kind]);
    if(kind==='calendar') await client.evaluate(`(() => {const calendar=document.querySelector('section[aria-label="Calendar"]');calendar.scrollLeft=calendar.scrollWidth-calendar.clientWidth;})()`);
    stats.mobile=await client.evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,cards:document.querySelectorAll('button[draggable]').length,calendarWidth:document.querySelector('section[aria-label="Calendar"]')?.clientWidth})`);
    if(expectPaging && kind!=='grid') {
      stats.mobile.layout=await layout(kind);
      assert.ok(stats.mobile.layout.controls.every(button=>button.width>=28&&button.height>=28));
      assert.ok(stats.mobile.layout.days.every(day=>day.contentBottom<=day.bottom+1),'Mobile calendar content overlaps the following week');
    }
    assert.equal(stats.mobile.documentWidth,390,'The document must not overflow on mobile');
    await client.capture(`${output}/${kind}-mobile.png`);
    await client.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
    await settled(selectors[kind]);
    report.views.push(stats);
    if(kind==='board'||kind==='calendar') {
      if(expectPaging) {
        const day = `${fixtureMonth}-16`;
        const last = kind==='board'?'Last In review cards':`Last rows on ${day}`;
        const first = kind==='board'?'First In review cards':`First rows on ${day}`;
        await click(`button[aria-label="${last}"]`);
        await settled(`Array.from(document.querySelectorAll('button[draggable]')).some(button=>button.innerText.includes('Lifecycle fixture 5000'))`);
        const cardSelector = await client.evaluate(`(() => { const card=Array.from(document.querySelectorAll('button[draggable]')).find(button=>button.innerText.includes('Lifecycle fixture 5000')); card.setAttribute('data-qa-final-row','true'); return '[data-qa-final-row]';})()`);
        await click(cardSelector);
        await settled(`document.querySelector('[role=dialog] input[aria-label="Name"]')?.value==='Lifecycle fixture 5000'`);
        await click('[role=dialog] button[aria-label="Close"]');
        await settled(`!document.querySelector('[role=dialog]')`);
        await click(`button[aria-label="${first}"]`);
        report.interactions.push({kind,lastRowReachable:true,lastRowMouseOpened:true,returnedToFirstPage:true});
      }
      await click('button[draggable]');
      await settled(`document.querySelector('[role=dialog] input[aria-label="Name"]')`);
      const before = await client.evaluate(`document.querySelector('[role=dialog] input[aria-label="Name"]').value`);
      await click('[role=dialog] input[aria-label="Name"]');
      await client.evaluate(`document.querySelector('[role=dialog] input[aria-label="Name"]').select()`);
      await client.command('Input.insertText',{text:`${before} checked`});
      await key('Enter','Enter');
      await click('[role=dialog] button[aria-label="Close"]');
      await settled(`!document.querySelector('[role=dialog]')`);
      for(let retry=0;retry<60;retry++) {if((await pluginRpc('studio-tables','get',{id})).table.rows.some(row=>row.values.name===`${before} checked`)) break; if(retry===59) throw Error('Row edit was not persisted'); await sleep(100);}
      report.interactions.push({kind,mouseOpenedRow:true,titleEditPersisted:true,closedDialog:true});
    }
  }
  await route(path('calendar'),selectors.calendar);
  await click('button[aria-label="Next month"]');
  await settled(`document.querySelectorAll('section[aria-label="Calendar"] button[draggable]').length===0`);
  await click('button[aria-label="Previous month"]');
  await settled(`document.querySelectorAll('section[aria-label="Calendar"] button[draggable]').length>0`);
  report.interactions.push({kind:'calendar',monthRoundTrip:true});
  for(let cycle=-3;cycle<20;cycle++) {
    const timings={};
    for(const kind of ['board','calendar','grid','closed']) timings[kind]=await route(path(kind),selectors[kind]);
    const sample=await metrics();
    assert.equal(sample.timeOrigin,report.environment.document.timeOrigin,'Navigation reloaded the document');
    assert.equal(sample.token,report.environment.document.token,'Navigation replaced the document');
    assert.equal(sample.cards,0,'Closed table cards remain mounted');
    assert.equal(sample.dialogs,0,'Closed dialog remains mounted');
    if(cycle>=0) report.lifecycle.push({cycle:cycle+1,timings,...sample});
    if(cycle%5===4) process.stdout.write(`Completed ${cycle+1} measured cycles\n`);
  }
  // Stress the clustered-date path separately from normal distributed dates.
  await pluginRpc('studio-tables','patchRows',{id,update:table.rows.map(row=>({rowId:row.id,values:{date:`${fixtureMonth}-01`}}))});
  const denseMs=await route(path('calendar'),selectors.calendar);
  await settled(`document.querySelectorAll('button[draggable]').length>0`);
  report.denseCalendar={readyMs:denseMs,...await metrics()};
  if(expectPaging) assert.equal(report.denseCalendar.cards,10,'Dense calendar day must bound all 5000 events');
  await client.capture(`${output}/calendar-dense-desktop.png`);
  await client.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await settled(selectors.calendar);
  await client.evaluate(`(() => {const calendar=document.querySelector('section[aria-label="Calendar"]');calendar.scrollLeft=calendar.scrollWidth-calendar.clientWidth;})()`);
  if(expectPaging) {
    await click(`button[aria-label="Last rows on ${fixtureMonth}-01"]`);
    await settled(`Array.from(document.querySelectorAll('button[draggable]')).some(button=>button.innerText.includes('Lifecycle fixture 5000'))`);
    report.denseCalendar.mobileLastRowReachable=true;
    report.denseCalendar.mobileLayout=await layout('calendar');
    assert.ok(report.denseCalendar.mobileLayout.days.every(day=>day.contentBottom<=day.bottom+1));
  }
  report.denseCalendar.mobile=await client.evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,cards:document.querySelectorAll('button[draggable]').length})`);
  assert.equal(report.denseCalendar.mobile.documentWidth,390);
  await client.capture(`${output}/calendar-dense-mobile.png`);
  await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({views:report.views.map(({kind,readyMs,documentNodes,cards,mobile})=>({kind,readyMs,documentNodes,cards,mobileWidth:mobile.width,documentWidth:mobile.documentWidth})),lifecycle:report.lifecycle.map(({cycle,heapUsed,nodes,documents,listeners,documentNodes})=>({cycle,heapUsed,nodes,documents,listeners,documentNodes})),denseCalendar:{cards:report.denseCalendar.cards,documentNodes:report.denseCalendar.documentNodes,mobileLastRowReachable:report.denseCalendar.mobileLastRowReachable}},null,2)+'\n');
} finally {
  try {
    if(id) await pluginRpc('studio-tables','remove',{id});
  } finally {
    client.socket?.close();
    const exited=new Promise(resolve=>browser.process.once('exit',resolve)); browser.process.kill();
    await Promise.race([exited,sleep(5000)]);
    await rm(browser.profileDir,{recursive:true,force:true});
  }
}
