import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Called only after the parent seeder verifies the temporary staged database. */
export async function seedThreadFixtures({ db, api, rpc, fixtures, dataDir, projectId }) {
  if (fixtures.threadFixturesVersion === 3) return;
  const environment = db.prepare('SELECT e.* FROM environments e JOIN threads t ON t.environment_id=e.id WHERE t.id=? AND t.project_id=?')
    .get(process.env.BBGO_QA_THREAD, projectId);
  if (!environment) throw new Error('Thread fixtures need the staged workspace thread');
  const root = await realpath(environment.path);
  if (!root.startsWith(await realpath(dirname(dataDir)) + '/')) throw new Error('Fixture workspace must belong to this temporary stage');
  const qa = join(root, 'qa');
  await mkdir(qa, {recursive:true});
  await writeFile(join(qa,'chart.html'), '<!doctype html><html><body><h1 id="chart">Waiting</h1><script>document.getElementById("chart").textContent="QA chart (script ran)"</script></body></html>');
  await writeFile(join(qa,'notes.md'), '# QA notes\n\nThe release is ready.\n');
  await writeFile(join(qa,'icon.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1cAAAAASUVORK5CYII=','base64'));
  async function thread(title, turns) {
    const made = await api('/threads',{projectId,origin:'app',title,environment:{type:'project-default'},sendAt:1924992000000,input:[{type:'text',text:'Inert UI fixture. Do not run.',mentions:[]}]});
    const id = made.id ?? made.thread.id;
    for (const queued of await api('/threads/'+id+'/queued-messages',null,'GET')) await api('/threads/'+id+'/queued-messages/'+queued.id,null,'DELETE');
    db.prepare('UPDATE threads SET environment_id=?, status=? WHERE id=?').run(environment.id,'idle',id);
    const insert = db.prepare('INSERT INTO events (id,thread_id,scope_kind,turn_id,sequence,type,item_id,item_kind,data,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    let sequence = db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE thread_id=?').get(id).next;
    db.transaction(()=>{
      for (const items of turns) {
        const turnId=randomUUID(), payload={providerThreadId:'ui-fixture'};
        const event=(type,item=null,extra={})=>insert.run(randomUUID(),id,'turn',turnId,sequence++,type,item?.id??null,item?.type??null,JSON.stringify({...payload,...extra,...(item?{item}:{})}),Date.now());
        event('turn/started');
        for (const item of items) event('item/completed',{id:randomUUID(),...item});
        event('turn/completed',null,{status:'completed'});
      }
    })();
    // Parse through the real timeline boundary before handing IDs to XCTest.
    await api('/threads/'+id+'/timeline',null,'GET');
    return id;
  }
  const message=text=>({type:'agentMessage',text});
  fixtures.BBGO_QA_FILE_THREAD=await thread('Native file-link fixture',[[message('Read [README.md]('+join(root,'README.md')+').')]]);
  fixtures.BBGO_QA_VIS_THREAD=await thread('Native inline preview fixture',[[message('QA inline-vis reply\n\n::inline-vis{file="qa/chart.html" height="160"}\n\n::inline-vis{file="qa/notes.md" height="120"}\n\n::inline-vis{file="qa/missing.md" height="120"}\n\n::inline-vis{file="qa/chart.html" height="bad"}')]]);
  fixtures.BBGO_QA_IMAGE_THREAD=await thread('Native image fixture',[[message('QA image reply\n\n![QA silk icon]('+join(qa,'icon.png')+')\n\nText before ![QA inline sheet](file://'+join(qa,'icon.png')+') text after.\n\n![QA missing image]('+join(qa,'missing.png')+')')]]);
  const artifact=await rpc('artifacts_importFile',{projectId,name:'QA-artifact.md',mime:'text/markdown',bytes:Buffer.from('# QA artifact\n\nThe release is ready.\n').toString('base64')});
  fixtures.BBGO_QA_ARTIFACT=artifact.id;
  fixtures.BBGO_QA_ARTIFACT_THREAD=await thread('Native artifact-card fixture',[[message('The saved result.\n\n::artifact{id="'+artifact.id+'"}')]]);
  fixtures.BBGO_QA_REACTIONS_THREAD=await thread('Native reactions fixture',[
    ...Array.from({length:16},(_,i)=>[message('The release review '+(i+1)+'.\n\n'+('The checklist is ready for the Friday release window. ').repeat(8))]),
    [message('The release checklist is ready. Choose the next review step.\n\n::reactions{items="👍 Agree|❓ Clarify"}')],
  ]);
  fixtures.BBGO_PROBE_THREAD=await thread('Native probe fixture',[[message('The earlier release review is complete.')],[
    {type:'fileChange',status:'completed',approvalStatus:null,changes:[{path:join(root,'README.md'),kind:'update',diff:'@@ -1 +1 @@\n-# Orbit\n+# Orbit release\n'}]},
    message('The release checklist is ready. The release window is Friday.'),
  ]]);
  fixtures.threadFixturesVersion=3;
}
