import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MIGRATIONS } from '../migrations';
import { LoopStore } from './store';
import { defaults as baseDefaults, snooze, systemTimeZone } from './scheduler';
import { rpcContract } from './contract';
import { registerLoops, threadOwner } from './register';
const defaults={...baseDefaults,enabled:true,timeZone:'America/New_York'};
let db:Database.Database,store:LoopStore,post:ReturnType<typeof vi.fn<(text:string)=>Promise<void>>>,notify:ReturnType<typeof vi.fn<(loop:import('./contract').Loop)=>Promise<void>>>;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));db=new Database(':memory:');db.exec(MIGRATIONS.find((sql)=>sql.includes('CREATE TABLE bot_loops'))!);db.exec(MIGRATIONS.find((sql)=>sql.includes('CREATE TABLE tasks'))!);store=new LoopStore(db);post=vi.fn(async(_text:string)=>{});notify=vi.fn(async(_loop:import('./contract').Loop)=>{});});
afterEach(()=>{db.close();vi.useRealTimers();});
it('persists and groups records with closure history',()=>{const l=store.add({title:'Call'});expect(store.get(l.id).title).toBe('Call');store.act({id:l.id,action:'done'},()=>({type:'none'}));expect(store.groups().done).toHaveLength(1);expect(store.history(l.id).map(e=>e.type)).toEqual(['closed','acted']);});
it.each(['done','drop','got_it','choose','snooze','hand_off','nudge','keep'] as const)('records %s actions',action=>{const l=store.add({title:'Choose',kind:'decide',options:['A']});const result=store.act({id:l.id,action,option:'A',snooze:'home'},p=>snooze(p,defaults));expect(store.history(l.id).some(e=>e.type==='acted')).toBe(true);if(action==='hand_off')expect(result.owner).toBe('cos');if(action==='snooze')expect(result.trigger).toEqual({type:'place',place:'home',direction:'arrive'});});
it('rejects invalid decisions and missing snooze presets atomically',()=>{const l=store.add({title:'Pick',kind:'decide',options:['A']});expect(()=>store.act({id:l.id,action:'choose',option:'B'},()=>({type:'none'}))).toThrow();expect(store.history(l.id)).toEqual([]);});
it('derives areas from the stored loops, most used first, and filters by one',()=>{store.add({title:'A1',area:'Alpha'});store.add({title:'B1',area:'Beta'});store.add({title:'B2',area:'Beta'});store.add({title:'None'});store.add({title:'Blank',area:'  '});expect(store.areas()).toEqual(['Beta','Alpha']);expect(store.groups({area:'Alpha'}).needsYouNow.concat(store.groups({area:'Alpha'}).comingUp).map(l=>l.title)).toEqual(['A1']);const old=store.add({title:'Old',area:'Gamma'});store.act({id:old.id,action:'done'},()=>({type:'none'}));expect(store.areas()).toContain('Gamma');vi.setSystemTime(Date.now()+8*86400000);expect(store.areas()).toEqual(['Beta','Alpha']);});
it('validates wire inputs and output',()=>{expect(()=>rpcContract['loops.act'].input.parse({id:'x',action:'invalid'})).toThrow();expect(rpcContract['loops.list'].output.parse(store.groups())).toEqual(store.groups());});
it.each(['later_today','tonight','tomorrow_morning','this_weekend','home','mac'])('resolves %s snooze',preset=>{const t=snooze(preset,defaults);expect(t.type==='place'||t.at!>Date.now()).toBe(true);});
it('falls back to this computer\'s time zone, never a fixed city',()=>{expect(baseDefaults.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);expect(systemTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');expect(systemTimeZone('')).toBe('UTC');});
it('keeps place names only, deduped ignoring case and replaced as a whole',()=>{expect(store.places()).toEqual([]);expect(store.setPlaces([' Home ','Office','home','Mom’s'])).toEqual(['Home','Office','Mom’s']);expect(store.places()).toEqual(['Home','Office','Mom’s']);store.setPlaces(['Gym']);expect(store.places()).toEqual(['Gym']);expect(()=>rpcContract['loops.setPlaces'].input.parse({names:Array.from({length:21},(_,i)=>`P${i}`)})).toThrow();expect(()=>rpcContract['loops.setPlaces'].input.parse({names:['x'.repeat(61)]})).toThrow();expect(rpcContract['loops.places'].output.parse({names:store.places()})).toEqual({names:['Gym']});});
it('reopens a closed todo when an update sets an open status (Undo)',()=>{const l=store.add({title:'Call',status:'surfaced'});store.act({id:l.id,action:'done'},()=>({type:'none'}));const back=store.update(l.id,{status:'surfaced'});expect(back.closedAt).toBeNull();expect(back.status).toBe('surfaced');expect(store.history(l.id).map(e=>e.type)).toContain('reopened');expect(store.groups().needsYouNow.map(x=>x.id)).toEqual([l.id]);});
it('tells listeners after every saved change',()=>{const changed=vi.fn();const live=new LoopStore(db,changed);const l=live.add({title:'Call'});live.act({id:l.id,action:'done'},()=>({type:'none'}));expect(changed).toHaveBeenCalledTimes(2);});

// A sample todos_list at 22:26 on Oct 31 (EDT), Todos on.
const NIGHT=new Date('2026-11-01T02:26:00Z');
function realLoops(){const s=store;return {
 plan:s.add({title:'Draft the Q3 planning doc',area:'Job'}),
 vendor:s.add({title:'Vendor demo call',kind:'decide',options:['Take the call','Pass'],area:'Job'}),
 desktop:s.add({title:'Update the Linux desktop: sudo pacman -Syu, then reboot',priority:'low',trigger:{type:'event',event:'desktop:online'},area:'Systems'}),
 tailscale:s.add({title:'Remove the stale Tailscale node old-build-box',priority:'low',area:'Systems'}),
 speech:s.add({title:'Silent-speech Long read on other form factors?',kind:'decide',options:['Write it','Skip'],priority:'low',area:'Larkspur'}),
 ghsa:s.add({title:'Check whether GitHub resumed security advisories (GHSA)',owner:'cos',trigger:{type:'time',at:1793631600000},area:'Larkspur'}),
 larkspur:s.add({title:"Review the Larkspur lead's quieter notifications; decide on other leads",owner:'cos',trigger:{type:'time',at:1794074400000},area:'Systems'}),
 utilities:s.add({title:'Add the remaining utilities to the AI power Long read',owner:'thread:thr_demo000014',trigger:{type:'time',at:1794148200000},status:'in_progress',area:'Larkspur'}),
 php:s.add({title:"Remove the NAS's PHP upload-progress mitigation once the vendor ships a fix",owner:'cos',priority:'low',trigger:{type:'event',event:'nas:php-fix-shipped'},area:'Systems'}),
 replies:s.add({title:'Replies from Sam and Jordan about the onboarding flow',kind:'waiting',owner:'cos',trigger:{type:'time',at:1793718000000},area:'Job'}),
};}
const ids=(list:{id:string}[])=>list.map(l=>l.id).sort();
it('groups queued todos by trigger, whoever owns them, and started work under Agents on it',()=>{vi.setSystemTime(NIGHT);const r=realLoops();const g=store.groups();
 expect(ids(g.comingUp)).toEqual(ids([r.plan,r.vendor,r.desktop,r.tailscale,r.speech,r.ghsa,r.larkspur,r.php]));
 expect(ids(g.agentsOnIt)).toEqual([r.utilities.id]);expect(ids(g.waitingOnOthers)).toEqual([r.replies.id]);expect(g.needsYouNow).toEqual([]);
 const handed=store.act({id:r.plan.id,action:'hand_off'},()=>({type:'none'}));expect(handed.status).toBe('in_progress');expect(ids(store.groups().agentsOnIt)).toEqual(ids([r.plan,r.utilities]));
 store.act({id:r.ghsa.id,action:'snooze',snooze:'tonight'},p=>snooze(p,defaults));expect(store.groups().comingUp.map(l=>l.id)).toContain(r.ghsa.id);
 const surfaced=store.add({title:'Call back',status:'surfaced'});expect(ids(store.groups().needsYouNow)).toEqual([surfaced.id]);});
it('names a thread owner by its title, marks it archived, and drops the link once it is gone',()=>{
 expect(threadOwner('thread:thr_a',{title:'AI power Long read'})).toEqual({owner:'thread:thr_a',name:'AI power Long read',threadId:'thr_a'});
 expect(threadOwner('thread:thr_a',{title:null,titleFallback:'Utilities pass'})).toMatchObject({name:'Utilities pass'});
 expect(threadOwner('thread:thr_a',{title:'Old',archivedAt:5})).toEqual({owner:'thread:thr_a',name:'Old (archived)',threadId:'thr_a'});
 expect(threadOwner('thread:thr_a',null)).toEqual({owner:'thread:thr_a',name:'A thread that was removed',threadId:null});});
it('hardcodes no area names in the Loops UI or the iOS app',async()=>{
 const {existsSync,readFileSync}=await import('node:fs');const paths=['./ui/model.ts','../../../../apps/ios/iOS/Loops/LoopsView.swift','../../../../../ios/iOS/Loops/LoopsView.swift'].map(path=>new URL(path,import.meta.url)).filter(url=>existsSync(url));
 expect(paths.length).toBeGreaterThanOrEqual(1);for(const url of paths)expect(readFileSync(url,'utf8')).not.toMatch(/\bAREAS\b|static let areas|"(Job|Larkspur|Systems)"/);});

it('answers older phones safely now that to-dos are gone: empty lists, no add, nothing fired, and no tools or reminders',async()=>{
 const handlers:Record<string,(x:any)=>unknown>={};const registerTool=vi.fn();const registerMentionProvider=vi.fn();
 const bb={realtime:{publish:vi.fn()},log:{warn:vi.fn()},onDispose:vi.fn(),agents:{registerTool},ui:{registerMentionProvider},rpc:{register:(_c:unknown,h:typeof handlers)=>Object.assign(handlers,h)},sdk:{threads:{get:async()=>null}}};
 const loops=registerLoops(bb as never,db,post,()=>'America/New_York');
 const old=loops.store.add({title:'Call the plumber',status:'surfaced',trigger:{type:'time',at:Date.now()-1}});
 const list=await handlers['loops.list']!({}) as import('zod').infer<typeof rpcContract['loops.list']['output']>;
 expect(rpcContract['loops.list'].output.parse(list)).toMatchObject({needsYouNow:[],comingUp:[],agentsOnIt:[],waitingOnOthers:[],done:[]});
 expect(rpcContract['loops.morning'].output.parse(await handlers['loops.morning']!({}))).toEqual({date:'2026-11-02',items:[],more:0,lowPriority:[]});
 expect(() => handlers['loops.add']!({text:'Buy milk'})).toThrow('To-dos are gone from BB Studio. Tell your Bot in its chat instead.');
 expect(await handlers['loops.fire']!({event:'reply:sam'})).toEqual({matched:0});
 expect(await handlers['loops.place']!({place:'home',direction:'arrive'})).toEqual({matched:0});
 expect(await handlers['loops.setPlaces']!({names:['Home']})).toEqual({names:[]});
 // An old card still reads and closes.
 expect((await handlers['loops.get']!({id:old.id}) as {loop:{title:string}}).loop.title).toBe('Call the plumber');
 expect((await handlers['loops.act']!({id:old.id,action:'done'}) as {status:string}).status).toBe('done');
 await vi.advanceTimersByTimeAsync(10*60_000);
 expect(post).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();
 expect(registerTool).not.toHaveBeenCalled();expect(registerMentionProvider).not.toHaveBeenCalled();
});
