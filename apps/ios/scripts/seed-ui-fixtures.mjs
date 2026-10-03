#!/usr/bin/env node
// Inert local fixtures: no provider call, transcription, or approval dispatch.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../packages/bb-studio/package.json', import.meta.url));
const Database = require('better-sqlite3');
const origin = process.env.BB_QA_SERVER_URL;
const projectId = process.env.BB_QA_PROJECT_ID;
const url = new URL(origin);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.port === '38886') throw new Error('Use an isolated staged origin');
const dataDir = await realpath(process.env.BB_QA_DATA_DIR);
const temp = await realpath(tmpdir());
if (![temp, '/private/tmp'].some(root => dataDir.startsWith(root + '/')) || !dataDir.endsWith('/data')) throw new Error('BB_QA_DATA_DIR must be an isolated temporary data directory');
const db = new Database(join(dataDir, 'bb.db'));
if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) throw new Error('Project does not belong to the staged data directory');
async function api(path, input, method = 'POST') {
  const response = await fetch(origin + '/api/v1' + path, {method, headers:{'Content-Type':'application/json'}, ...(method === 'GET' ? {} : {body:JSON.stringify(input)})});
  const result = await response.json();
  if (!response.ok) throw new Error(path + ': ' + JSON.stringify(result));
  return result;
}
async function rpc(method, input) { const result = await api('/plugins/studio/rpc/' + method, input); if (result.error) throw new Error(JSON.stringify(result.error)); return result.result; }
if (!(await api('/projects', null, 'GET')).some(project => project.id === projectId)) throw new Error('Staged server project is missing');
const marker = join(dirname(dataDir), 'native-ui-fixtures.json');
let fixtures;
try { fixtures = JSON.parse(await readFile(marker, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (fixtures?.version !== 3 || fixtures?.origin !== origin || fixtures?.projectId !== projectId) fixtures = null;
if (fixtures) {
  try {
    const timeline = await api('/threads/'+fixtures.BBGO_QA_MESSAGE_THREAD+'/timeline',null,'GET');
    if (!JSON.stringify(timeline).includes(fixtures.BBGO_QA_MESSAGE_TEXT)) throw new Error('Missing assistant fixture');
    for (const id of [fixtures.BBGO_QA_RECORDING,fixtures.BBGO_QA_RECORDING_MP4]) await rpc('talk_recording_get',{id});
  } catch { fixtures = null; }
}
if (!fixtures) {
  const thread = await api('/threads', {projectId, origin:'app', title:'Native sent-time fixture', environment:{type:'project-default'}, sendAt:Date.now()+365*86400000, input:[{type:'text', text:'Inert native UI fixture. Do not run.', mentions:[]}]});
  const threadId = thread.id ?? thread.thread.id;
  for (const queued of await api('/threads/'+threadId+'/queued-messages', null, 'GET')) await api('/threads/'+threadId+'/queued-messages/'+queued.id, null, 'DELETE');
  const createdRecordings = [];
  try {
    const itemId = 'ui-message-'+randomUUID();
    const text = 'The native UI fixture is ready. This assistant message was seeded locally for the sent-time menu test.';
    const turnId = 'ui-turn-'+randomUUID();
    const insert = db.prepare('INSERT INTO events (id,thread_id,scope_kind,turn_id,sequence,type,item_id,item_kind,data,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const first = db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE thread_id=?').get(threadId).next;
    const payload = {providerThreadId:'ui-fixture'};
    db.transaction(() => {
      insert.run(randomUUID(),threadId,'turn',turnId,first,'turn/started',null,null,JSON.stringify(payload),Date.now()-1000);
      insert.run(randomUUID(),threadId,'turn',turnId,first+1,'item/completed',itemId,'agentMessage',JSON.stringify({...payload,item:{type:'agentMessage',id:itemId,text}}),Date.now());
      insert.run(randomUUID(),threadId,'turn',turnId,first+2,'turn/completed',null,null,JSON.stringify({...payload,status:'completed'}),Date.now());
    })();
    const timeline = await api('/threads/'+threadId+'/timeline', null, 'GET');
    if (!JSON.stringify(timeline).includes(text)) throw new Error('Seeded assistant is absent from the real timeline');
    const dir = await mkdtemp(join(tmpdir(), 'bb-ui-audio-'));
    const recordings = {};
    try {
      for (const [format, codec, mimeType] of [['webm','libopus','audio/webm'],['m4a','aac','audio/mp4']]) {
        const file = join(dir, 'segment.'+format);
        execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','30','-af','volume=0.01','-c:a',codec,'-b:a','32k',file]);
        const recording = await rpc('talk_recording_create',{kind:'recording',projectId,threadId:null});
        createdRecordings.push(recording.id);
        await rpc('talk_recording_rename',{id:recording.id,title:'Native playback fixture ('+format+')'});
        const audio = await readFile(file);
        const startedAt = Date.now()-90000;
        const talk = new Database(join(dataDir,'plugins/studio/talk.db'));
        try {
          for (let index=0;index<3;index++) {
            const segmentId = 'nativeplayback-'+index;
            const relative = recording.id+'/'+segmentId+'.'+format;
            const target = join(dataDir,'plugins/studio/talk/audio',relative);
            await mkdir(dirname(target),{recursive:true});
            await writeFile(target,audio);
            // Completed fixture rows avoid waking transcription and provide seek links.
            talk.prepare(`INSERT INTO segments
              (recording_id,id,session_id,idx,started_at,duration_ms,mime_type,bytes,file,status,text,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,'done',?,?)`).run(recording.id,segmentId,'nativeplayback',index,
                startedAt+index*30000,30000,mimeType,audio.length,relative,
                'Native playback fixture segment '+(index+1)+'.',Date.now());
          }
        } finally { talk.close(); }
        await rpc('talk_recording_state',{id:recording.id,status:'paused'});
        recordings[format] = recording.id;
      }
    } finally { await rm(dir,{recursive:true,force:true}); }
    fixtures = {version:3,origin,projectId,BBGO_QA_MESSAGE_THREAD:threadId,BBGO_QA_MESSAGE_TEXT:text,BBGO_QA_RECORDING:recordings.webm,BBGO_QA_RECORDING_MP4:recordings.m4a};
    await writeFile(marker, JSON.stringify(fixtures,null,2)+'\n');
  } catch (error) {
    for (const id of createdRecordings) await rpc('talk_recording_delete',{id}).catch(() => {});
    await api('/threads/'+threadId,{childThreadsConfirmed:false},'DELETE').catch(() => {});
    throw error;
  }
}
// A completed summary is local fixture data; never invoke the summary model.
if (!fixtures.BBGO_QA_MEETING_RECORDING) {
  const recording = await rpc('talk_recording_create', {kind:'recording',projectId,threadId:null});
  await rpc('talk_recording_rename', {id:recording.id,title:'Native meeting notes fixture'});
  const talk = new Database(join(dataDir,'plugins/studio/talk.db'));
  try {
    talk.prepare("UPDATE recordings SET status = 'done', meeting_notes = ? WHERE id = ?")
      .run(JSON.stringify({summary:'The release checklist is ready for Friday.',decisions:['Review before release.'],actionItems:[]}),recording.id);
  } finally { talk.close(); }
  fixtures.BBGO_QA_MEETING_RECORDING = recording.id;
  await writeFile(marker, JSON.stringify(fixtures,null,2)+'\n');
}
// Enough real page content to exercise repeated native list/page navigation.
if (!fixtures.performancePages) {
  fixtures.performancePages = [];
  for (let index = 1; index <= 24; index++) {
    const result = await api('/plugins/pages/rpc/create', {
      projectId, parentId:null, title:'Native Performance '+String(index).padStart(2,'0'),
      markdown:'# Navigation fixture\n\n'+Array.from({length:12},(_,i)=>'Paragraph '+(i+1)+': Review the release checklist and confirm the Friday release window.').join('\n\n'),
    });
    if (!result.ok || !result.result?.page?.id) throw new Error('Performance page fixture failed');
    fixtures.performancePages.push(result.result.page.id);
  }
  await writeFile(marker, JSON.stringify(fixtures,null,2)+'\n');
}
db.close();
const env = Object.fromEntries(Object.entries(fixtures).filter(([key])=>key.startsWith('BBGO_QA_')));
env.BBGO_QA_PERFORMANCE_READY = fixtures.performancePages.length === 24 ? 'YES' : 'NO';
await writeFile(process.argv[2],JSON.stringify(env,null,2)+'\n');
console.log('Seeded assistant timeline and two 90-second segmented audio fixtures.');
