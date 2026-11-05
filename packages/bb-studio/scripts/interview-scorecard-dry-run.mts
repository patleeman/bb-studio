/** Scripted scorecard only: no voice, microphone, provider or real OpenAI call.
 * Run with the isolated staged BB's capture.env sourced. */
import { readFile, writeFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { VoiceLive, type VoiceLiveDeps } from '../src/voice/live/live';
import { DIMENSIONS, parsePack } from '../src/voice/live/interview';
import { MIGRATIONS } from '../src/migrations';
const base = process.env.BB_SERVER_URL ?? '';
const dir = process.env.BB_DATA_DIR ?? '';
if (base !== 'http://127.0.0.1:49320' || !dir.startsWith('/private/tmp/bb-studio-staged-interviewer/')) throw new Error('Source the interviewer staged capture.env first; refusing any other server.');
async function rpc(method: string, input: unknown): Promise<any> {
  const response = await fetch(`${base}/api/v1/plugins/studio/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json();
  if (!response.ok || !value.ok) throw new Error(JSON.stringify(value));
  return value.result;
}
const markdown = await readFile(new URL('../src/voice/live/fixtures/rate-limiter.md', import.meta.url), 'utf8');
const parent = (await rpc('pages.create', { projectId: null, parentId: null, title: 'Scripted interview demo', markdown: 'A staged scorecard dry run. No real voice session or model call.' })).page;
const page = (await rpc('pages.create', { projectId: null, parentId: parent.id, title: 'LLM API rate limiter', markdown })).page;
const tag = (await rpc('createTag', { name: 'interview-pack' })).tag;
await rpc('tagItems', { items: [{ pluginId: 'pages', id: page.id }], add: [tag.id], remove: [] });
const tree = await rpc('pages.tree', { projectId: null });
if (!tree.pages.some((p: any) => p.id === page.id)) throw new Error('Staged pack was not saved.');
const db = new Database(':memory:');
db.exec(MIGRATIONS.find(s => s.includes('CREATE TABLE voice_calls'))!);
const id = 'vl_scripted_scorecard';
const now = Date.now();
db.prepare('INSERT INTO voice_calls (id, bot_id, bot_name, model, voice, started_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'scripted', 'Interviewer demo', 'gpt-live-1', 'marin', now - 12 * 60000);
const append = db.prepare('INSERT INTO voice_call_events (call_id, at, kind, role, text, data) VALUES (?, ?, ?, ?, ?, ?)');
append.run(id, now, 'interview', null, null, JSON.stringify(parsePack({ id: page.id, title: page.title, parentId: parent.id, markdown })));
append.run(id, now, 'thread', null, null, JSON.stringify({ threadId: process.env.BB_CAPTURE_THREAD_ID }));
append.run(id, now, 'transcript', 'user', 'I would use Redis. I have not calculated counter memory or store QPS.', null);
append.run(id, now, 'evidence', null, null, JSON.stringify({ dimension: 'numbers', observation: 'Candidate explicitly omitted sizing.', quote: 'I have not calculated counter memory or store QPS.', at: now }));
const score = { dimensions: DIMENSIONS.map(dimension => ({ dimension, score: dimension === 'numbers' ? 1 : 2, label: dimension === 'numbers' ? 'missing' : 'weak', evidence: dimension === 'numbers' ? ['I have not calculated counter memory or store QPS.'] : ['Insufficient evidence in the scripted excerpt.'] })), overall: 'SCRIPTED DEMO: incomplete design; insufficient evidence for a real assessment.', topFixes: ['Calculate counter cardinality and update QPS.', 'Define reservation and settlement for token usage.', 'Explain store failure and multi-region accuracy.'], strongAnswer: 'A strong answer would quantify load, describe the request path and define quota settlement and failure behavior.', timeManagement: 'Only a 12-minute scripted excerpt; no conclusion about a full interview.' };
let saved: { id: string; markdown: string } | undefined;
const deps = {
  db, key: () => '', settings: () => ({}), now: () => now,
  fetch: async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(score) }] }], usage: { input_tokens: 1000, output_tokens: 300 } })),
  send: async () => {}, publish: () => {}, warn: (message: string) => process.stderr.write(message + '\n'),
  interview: { drawing: () => ({ elements: [{ id: 'gateway', type: 'rectangle', name: 'API gateway' }, { id: 'redis', type: 'rectangle', name: 'Redis counters' }] }), page: async (input: any) => {
    const result = (await rpc('pages.create', { ...input, projectId: null })).page;
    const actual = (await rpc('pages.markdown', { id: result.id })).markdown;
    saved = { id: result.id, markdown: actual };
    return result.id;
  } },
} as unknown as VoiceLiveDeps;
await new VoiceLive(deps).end(id);
if (!saved) throw new Error('No scorecard written.');
await writeFile('/tmp/interviewer-example-scorecard.md', saved.markdown);
process.stdout.write(JSON.stringify({ pack: page.id, scorecard: saved.id, markdown: saved.markdown }, null, 2) + '\n');
db.close();
