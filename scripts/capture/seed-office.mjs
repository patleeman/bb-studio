import { createRequire } from 'node:module';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pluginRpc, projectId, threadId } from './bb.mjs';
const require = createRequire(new URL('../../packages/bb-studio/package.json', import.meta.url));
const Database = require('better-sqlite3');

/** Local, inert fixtures only. Never dispatch a bot or answer the seeded approval. */
export async function seedOffice() {
  const dataDir = await realpath(process.env.BB_DATA_DIR);
  const temp = await realpath(tmpdir());
  if (![temp, '/private/tmp'].some(root => dataDir.startsWith(root + '/')) || !dataDir.endsWith('/data'))
    throw new Error('Office fixtures require an isolated staged data directory under the temporary directory');
  const marker = resolve(dataDir, '../office-fixtures.json');
  try { return JSON.parse(await readFile(marker, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const call = (method, input) => pluginRpc('studio', method, input);
  const bots = [];
  const existing = (await call("teams_list", null)).bots;
  for (const [name, avatar, description] of [['Atlas','🧭','Research and release checks'],['Scribe','📝','Notes and clear reports'],['Quinn','🎨','Design review']]) {
    bots.push(existing.find(b => b.name === name) ?? await call('teams_create', { name, avatar, description, projectId, trust:'ask', providerId:'codex', model:'gpt-6-luna', intervalMinutes:0, mission:'A deterministic staged teammate. Do not run without an explicit user request.' }));
  }
  const bot = bots[0];
  const existingChannels = await call('teams_views', {});
  const channel = existingChannels.find(c => c.name === 'ORBIT-42 release room') ?? await call('teams_viewCreate', {name:'ORBIT-42 release room',members:bots.slice(0,2).map(b=>({kind:'bot',id:b.id})),requestId:randomUUID()});
  await call('talk_dm', {botId:bot.id});
  const desk = await call('bot_desk', {botId:bot.id});
  const {task} = await call('tasks_create', {projectId,title:'Review the ORBIT-42 release checklist',description:'The checklist is ready for your review.',status:'review'});
  // Assign an inert already-reviewed fixture directly, avoiding task-assignment dispatch.
  const tasks = new Database(join(dataDir,'plugins/studio/tasks.db'));
  try { tasks.prepare('UPDATE tasks SET assignee = ? WHERE id = ?').run(`bot:${bot.id}`,task.id); } finally { tasks.close(); }
  const {post} = await call('feed_publish', {title:'ORBIT-42 checks are ready',body:'The release checklist and inventory are ready. Please confirm the Friday release window.',author:'Atlas',topic:'Release',story:'stage9-orbit',projectId});
  const approvalId = 'stage9-'+randomUUID();
  const core = new Database(join(dataDir,'bb.db'));
  try {
    const now = Date.now();
    core.prepare(`INSERT INTO pending_interactions
      (id,thread_id,origin_kind,plugin_id,renderer_id,status,payload,created_at,updated_at)
      VALUES (?,?,'plugin','studio','office-trust','pending',?,?,?)`).run(approvalId,threadId,JSON.stringify({kind:'plugin',title:'Atlas wants to edit the release checklist',data:{toolName:'pages_edit',arguments:{page:'ORBIT-42 launch checklist',change:'Mark the review complete'},botId:bot.id,botName:'Atlas',botAvatar:'🧭',summary:'Ask first: approve this change outside Atlas’s own work.'}}),now,now);
  } finally { core.close(); }
  const {spaces} = await call('spaces_list',{});
  const result = {projectId,threadId,spaceId:spaces.find(s=>s.isDefault)?.id ?? spaces[0].id,botId:bot.id,bots:bots.map(b=>({id:b.id,name:b.name})),channelId:channel.id,dmThreadId:desk.directThreadId,taskId:task.id,postId:post.id,approvalId};
  const inbox = await call('inbox_list',{spaceId:'all'});
  if (!inbox.events.some(e=>e.key==='interaction:'+approvalId) || !inbox.events.some(e=>e.type==='report'&&e.title==='ORBIT-42 checks are ready')) throw new Error('Seeded request/report absent from live Inbox');
  await writeFile(marker,JSON.stringify(result,null,2)+'\n');
  return result;
}
if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) console.log(JSON.stringify(await seedOffice(),null,2));
