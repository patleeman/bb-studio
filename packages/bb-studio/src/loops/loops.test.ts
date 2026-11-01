import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MIGRATIONS } from '../migrations';
import { LoopStore } from './store';
import { LoopScheduler, defaults as baseDefaults, snooze } from './scheduler';
import { rpcContract } from './contract';
import { loopPushActions, registerLoops, threadOwner } from './register';
const defaults={...baseDefaults,enabled:true};
let db:Database.Database,store:LoopStore,scheduler:LoopScheduler,post:ReturnType<typeof vi.fn<(text:string)=>Promise<void>>>,notify:ReturnType<typeof vi.fn<(loop:import('./contract').Loop)=>Promise<void>>>;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));db=new Database(':memory:');db.exec(MIGRATIONS.at(-1)!);store=new LoopStore(db);post=vi.fn(async(_text:string)=>{});notify=vi.fn(async(_loop:import('./contract').Loop)=>{});scheduler=new LoopScheduler(store,()=>defaults,post,notify);});
afterEach(()=>{db.close();vi.useRealTimers();});
it('persists and groups records with closure history',()=>{const l=store.add({title:'Call'});expect(store.get(l.id).title).toBe('Call');store.act({id:l.id,action:'done'},()=>({type:'none'}));expect(store.groups().done).toHaveLength(1);expect(store.history(l.id).map(e=>e.type)).toEqual(['closed','acted']);});
it.each(['done','drop','got_it','choose','snooze','hand_off','nudge','keep'] as const)('records %s actions',action=>{const l=store.add({title:'Choose',kind:'decide',options:['A']});const result=store.act({id:l.id,action,option:'A',snooze:'home'},p=>snooze(p,defaults));expect(store.history(l.id).some(e=>e.type==='acted')).toBe(true);if(action==='hand_off')expect(result.owner).toBe('cos');if(action==='snooze')expect(result.trigger).toEqual({type:'place',place:'home',direction:'arrive'});});
it('rejects invalid decisions and missing snooze presets atomically',()=>{const l=store.add({title:'Pick',kind:'decide',options:['A']});expect(()=>store.act({id:l.id,action:'choose',option:'B'},()=>({type:'none'}))).toThrow();expect(store.history(l.id)).toEqual([]);});
it('releases time, event and place triggers and sends once',async()=>{const time=store.add({title:'Now',push:true,trigger:{type:'time',at:Date.now()}});const event=store.add({title:'Reply',trigger:{type:'event',event:'reply:x'}});const place=store.add({title:'Home',trigger:{type:'place',place:'home',direction:'arrive'}});await scheduler.tick();expect(store.get(time.id).status).toBe('surfaced');expect(store.get(event.id).status).toBe('queued');expect(scheduler.fire('reply:x').matched).toBe(1);expect(scheduler.fire('place:home:arrive').matched).toBe(1);await scheduler.tick();await scheduler.tick();expect(post).toHaveBeenCalledTimes(3);expect(notify).toHaveBeenCalledTimes(1);expect(store.get(place.id).status).toBe('surfaced');});
it('enforces budget, low batching, quiet hours and urgent bypass',async()=>{for(let i=0;i<7;i++)store.add({title:`Task ${i}`});store.add({title:'Low',priority:'low'});await scheduler.tick();expect(post).toHaveBeenCalledTimes(5);vi.setSystemTime(new Date('2026-11-03T04:00:00Z'));store.add({title:'Urgent',priority:'urgent',push:true});await scheduler.tick();expect(post).toHaveBeenCalledTimes(6);expect(notify).toHaveBeenCalledTimes(1);});
it('sends stale list once on Monday',async()=>{const l=store.add({title:'Old',owner:'cos'});store.save({...l,updatedAt:Date.now()-4*86400000});await scheduler.tick();await scheduler.tick();expect(post).toHaveBeenCalledTimes(1);expect(post.mock.calls[0]?.[0]).toContain('Weekly stale');});
it('ranks morning items and reports the remainder',()=>{for(let i=0;i<7;i++)store.add({title:`Decision ${i}`,kind:'decide'});const urgent=store.add({title:'Outage',priority:'urgent',due:Date.now()});expect(scheduler.morning().items[0]?.id).toBe(urgent.id);expect(scheduler.morning().more).toBe(3);});
it('validates wire inputs and output',()=>{expect(()=>rpcContract['loops.act'].input.parse({id:'x',action:'invalid'})).toThrow();expect(rpcContract['loops.list'].output.parse(store.groups())).toEqual(store.groups());});
it.each(['later_today','tonight','tomorrow_morning','this_weekend','home','mac'])('resolves %s snooze',preset=>{const t=snooze(preset,defaults);expect(t.type==='place'||t.at!>Date.now()).toBe(true);});
it('releases snoozed time loops and repeats overdue pushes only the next day',async()=>{const l=store.add({title:'Late',push:true,due:Date.now()-1});await scheduler.tick();expect(notify).toHaveBeenCalledTimes(1);store.act({id:l.id,action:'snooze',snooze:'later_today'},p=>snooze(p,defaults));await scheduler.tick();expect(store.get(l.id).status).toBe('snoozed');vi.advanceTimersByTime(3*3600000);await scheduler.tick();expect(store.get(l.id).status).toBe('surfaced');expect(notify).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(24*3600000);await scheduler.tick();expect(notify).toHaveBeenCalledTimes(2);});
it('keeps a latched event across scheduler recreation',async()=>{const l=store.add({title:'Reply',trigger:{type:'event',event:'reply'}});scheduler.fire('reply');const restarted=new LoopScheduler(store,()=>defaults,post,notify);await restarted.tick();expect(store.get(l.id).status).toBe('surfaced');});

it('defaults OFF: releases no cards, urgent pushes or stale cards while store and events still work',async()=>{expect(baseDefaults.enabled).toBe(false);const l=store.add({title:'Urgent',priority:'urgent',push:true,trigger:{type:'event',event:'reply'}});const off=new LoopScheduler(store,()=>baseDefaults,post,notify);expect(off.fire('reply').matched).toBe(1);store.add({title:'Already surfaced',status:'surfaced',priority:'urgent',push:true});await off.tick();expect(store.get(l.id).status).toBe('queued');expect(post).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();expect(off.morning()).toBeDefined();});
it('keeps place names only, deduped ignoring case and replaced as a whole',()=>{expect(store.places()).toEqual([]);expect(store.setPlaces([' Home ','Office','home','Mom’s'])).toEqual(['Home','Office','Mom’s']);expect(store.places()).toEqual(['Home','Office','Mom’s']);store.setPlaces(['Gym']);expect(store.places()).toEqual(['Gym']);expect(()=>rpcContract['loops.setPlaces'].input.parse({names:Array.from({length:21},(_,i)=>`P${i}`)})).toThrow();expect(()=>rpcContract['loops.setPlaces'].input.parse({names:['x'.repeat(61)]})).toThrow();expect(rpcContract['loops.places'].output.parse({names:store.places()})).toEqual({names:['Gym']});});
it('matches place triggers by lower-case name',()=>{const l=store.add({title:'Plumber',trigger:{type:'place',place:'Home',direction:'arrive'}});expect(store.get(l.id).trigger.place).toBe('home');expect(scheduler.fire('place:home:arrive').matched).toBe(1);});
it('reopens a closed loop when an update sets an open status (Undo)',()=>{const l=store.add({title:'Call',status:'surfaced'});store.act({id:l.id,action:'done'},()=>({type:'none'}));const back=store.update(l.id,{status:'surfaced'});expect(back.closedAt).toBeNull();expect(back.status).toBe('surfaced');expect(store.history(l.id).map(e=>e.type)).toContain('reopened');expect(store.groups().needsYouNow.map(x=>x.id)).toEqual([l.id]);});
it('offers push actions by kind',()=>{expect(loopPushActions('read')).toEqual(['got_it','snooze']);expect(loopPushActions('decide')).toEqual(['choose','snooze']);expect(loopPushActions('do')).toEqual(['done','snooze']);});
it('tells listeners after every saved change',()=>{const changed=vi.fn();const live=new LoopStore(db,changed);const l=live.add({title:'Call'});live.act({id:l.id,action:'done'},()=>({type:'none'}));expect(changed).toHaveBeenCalledTimes(2);});

// Patrick's loops_list at 22:26 on Oct 31 (EDT), the Attention Router on.
const NIGHT=new Date('2026-11-01T02:26:00Z');
function realLoops(){const s=store;return {
 resume:s.add({title:'Review the OpenAI FDE resume, then send it to Yassine',area:'Job'}),
 vercel:s.add({title:'Vercel recruiter call',kind:'decide',options:['Take the call','Pass'],area:'Job'}),
 desktop:s.add({title:'Update the Linux desktop: sudo pacman -Syu, then reboot',priority:'low',trigger:{type:'event',event:'desktop:online'},area:'Systems'}),
 tailscale:s.add({title:'Remove the stale Tailscale node bb-server-red4',priority:'low',area:'Systems'}),
 speech:s.add({title:'Silent-speech Long read on other form factors?',kind:'decide',options:['Write it','Skip'],priority:'low',area:'Kensico'}),
 ghsa:s.add({title:'Check whether GitHub resumed security advisories (GHSA)',owner:'cos',trigger:{type:'time',at:1793631600000},area:'Kensico'}),
 kensico:s.add({title:"Review the Kensico lead's quieter notifications; decide on other leads",owner:'cos',trigger:{type:'time',at:1794074400000},area:'Systems'}),
 utilities:s.add({title:'Add the remaining utilities to the AI power Long read',owner:'thread:thr_egv6yq7mbp',trigger:{type:'time',at:1794148200000},status:'in_progress',area:'Kensico'}),
 php:s.add({title:"Remove red4's PHP upload-progress mitigation once Unraid ships a fix",owner:'cos',priority:'low',trigger:{type:'event',event:'unraid:php-cve-2026-115560-fixed'},area:'Systems'}),
 replies:s.add({title:'Replies from Nicole Thurn (OpenAI) and Lewis Fegan (Reflection AI)',kind:'waiting',owner:'cos',trigger:{type:'time',at:1793718000000},area:'Job'}),
};}
const ids=(list:{id:string}[])=>list.map(l=>l.id).sort();
it('groups queued loops by trigger, whoever owns them, and started work under Agents on it',()=>{vi.setSystemTime(NIGHT);const r=realLoops();const g=store.groups();
 expect(ids(g.comingUp)).toEqual(ids([r.resume,r.vercel,r.desktop,r.tailscale,r.speech,r.ghsa,r.kensico,r.php]));
 expect(ids(g.agentsOnIt)).toEqual([r.utilities.id]);expect(ids(g.waitingOnOthers)).toEqual([r.replies.id]);expect(g.needsYouNow).toEqual([]);
 const handed=store.act({id:r.resume.id,action:'hand_off'},()=>({type:'none'}));expect(handed.status).toBe('in_progress');expect(ids(store.groups().agentsOnIt)).toEqual(ids([r.resume,r.utilities]));
 store.act({id:r.ghsa.id,action:'snooze',snooze:'tonight'},p=>snooze(p,defaults));expect(store.groups().comingUp.map(l=>l.id)).toContain(r.ghsa.id);
 const surfaced=store.add({title:'Call back',status:'surfaced'});expect(ids(store.groups().needsYouNow)).toEqual([surfaced.id]);});
it('releases trigger-none loops at night as chat cards, within the budget and without a push',async()=>{vi.setSystemTime(NIGHT);const r=realLoops();const pushed=store.add({title:'Pay the invoice',push:true});
 await scheduler.tick();
 expect([r.resume,r.vercel,pushed].map(l=>store.get(l.id).status)).toEqual(['surfaced','surfaced','surfaced']);
 // Low priority waits for the morning card; the CoS's later times and events wait too.
 expect([r.tailscale,r.speech,r.desktop,r.ghsa,r.php].map(l=>store.get(l.id).status)).toEqual(['queued','queued','queued','queued','queued']);
 expect(post).toHaveBeenCalledTimes(3);expect(notify).not.toHaveBeenCalled();
 vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));await scheduler.tick();expect(notify).toHaveBeenCalledTimes(1);expect(notify.mock.calls[0]?.[0].id).toBe(pushed.id);});
it('still pushes urgent loops in quiet hours',async()=>{vi.setSystemTime(NIGHT);const l=store.add({title:'Server down',priority:'urgent'});await scheduler.tick();expect(store.get(l.id).status).toBe('surfaced');expect(notify).toHaveBeenCalledTimes(1);});
it('says why a due loop is held: the spent budget, or the morning card for low priority',async()=>{vi.setSystemTime(NIGHT);const r=realLoops();const tight=new LoopScheduler(store,()=>({...defaults,dailyBudget:1}),post,notify);
 expect(tight.held()).toEqual(expect.arrayContaining([{id:r.tailscale.id,reason:'morning'},{id:r.speech.id,reason:'morning'}]));
 expect(tight.held().filter(h=>h.reason==='budget')).toHaveLength(1);
 await tight.tick();expect(post).toHaveBeenCalledTimes(1);const waiting=tight.held().find(h=>h.reason==='budget');expect(waiting&&store.get(waiting.id).status).toBe('queued');
 expect(tight.held().map(h=>h.id)).not.toContain(r.desktop.id);});
it('releases what queued while the Attention Router was off on the next tick after it turns on',async()=>{let settings={...defaults,enabled:false};const s=new LoopScheduler(store,()=>settings,post,notify);const l=store.add({title:'Call'});await s.tick();expect(store.get(l.id).status).toBe('queued');settings={...settings,enabled:true};await s.tick();expect(store.get(l.id).status).toBe('surfaced');});
it("starts the CoS's and threads' loops when their time comes, with no card or budget",async()=>{vi.setSystemTime(NIGHT);const r=realLoops();vi.setSystemTime(new Date(1793631600000+60_000));const s=new LoopScheduler(store,()=>({...defaults,dailyBudget:0}),post,notify);await s.tick();
 expect(store.get(r.ghsa.id).status).toBe('in_progress');expect(store.history(r.ghsa.id).map(e=>e.type)).toContain('started');expect(post.mock.calls.some(([text])=>text.includes(r.ghsa.id)&&text.includes('is due'))).toBe(true);
 expect(store.get(r.kensico.id).status).toBe('queued');expect(ids(store.groups().agentsOnIt)).toEqual(ids([r.ghsa,r.utilities]));
 expect(s.fire('unraid:php-cve-2026-115560-fixed').matched).toBe(1);await s.tick();expect(store.get(r.php.id).status).toBe('in_progress');});
it('names a thread owner by its title, marks it archived, and drops the link once it is gone',()=>{
 expect(threadOwner('thread:thr_a',{title:'AI power Long read'})).toEqual({owner:'thread:thr_a',name:'AI power Long read',threadId:'thr_a'});
 expect(threadOwner('thread:thr_a',{title:null,titleFallback:'Utilities pass'})).toMatchObject({name:'Utilities pass'});
 expect(threadOwner('thread:thr_a',{title:'Old',archivedAt:5})).toEqual({owner:'thread:thr_a',name:'Old (archived)',threadId:'thr_a'});
 expect(threadOwner('thread:thr_a',null)).toEqual({owner:'thread:thr_a',name:'A thread that was removed',threadId:null});});
it('serves loops.list with held reasons and thread owners, and ticks when the Attention Router turns on',async()=>{
 const handlers:Record<string,(x:any)=>unknown>={};let onChange:(v:Record<string,unknown>)=>void=()=>{};
 const bb={realtime:{publish:vi.fn()},log:{warn:vi.fn()},onDispose:vi.fn(),agents:{registerTool:vi.fn()},ui:{registerMentionProvider:vi.fn()},rpc:{register:(_c:unknown,h:typeof handlers)=>Object.assign(handlers,h)},
  settings:{define:()=>({get:async()=>({loopsEnabled:false}),onChange:(f:typeof onChange)=>{onChange=f;}})},
  sdk:{threads:{get:async({threadId}:{threadId:string})=>{if(threadId==='thr_egv6yq7mbp')return {title:'AI power Long read'};throw Error('Not found');}}}};
 const loops=registerLoops(bb as never,db,post,notify);await vi.advanceTimersByTimeAsync(0);
 const l=loops.store.add({title:'Call'});const owned=loops.store.add({title:'Utilities',owner:'thread:thr_egv6yq7mbp',status:'in_progress'});loops.store.add({title:'Gone',owner:'thread:thr_gone',status:'in_progress'});
 loops.store.add({title:'Low',priority:'low'});
 const list=await handlers['loops.list']!({}) as import('zod').infer<typeof rpcContract['loops.list']['output']>;
 expect(rpcContract['loops.list'].output.parse(list)).toBeTruthy();expect(list.held).toEqual([expect.objectContaining({reason:'morning'})]);
 expect(list.owners).toEqual(expect.arrayContaining([{owner:'thread:thr_egv6yq7mbp',name:'AI power Long read',threadId:'thr_egv6yq7mbp'},{owner:'thread:thr_gone',name:'A thread that was removed',threadId:null}]));
 expect((await handlers['loops.get']!({id:owned.id}) as {owner?:unknown}).owner).toMatchObject({name:'AI power Long read'});
 expect(store.get(l.id).status).toBe('queued');onChange({loopsEnabled:true});await vi.advanceTimersByTimeAsync(0);expect(store.get(l.id).status).toBe('surfaced');});

it('releases Patrick\'s own Surface now at once, past the morning hold and the budget, and says why when it can\'t',async()=>{
 const handlers:Record<string,(x:any)=>unknown>={};let onChange:(v:Record<string,unknown>)=>void=()=>{};
 const bb={realtime:{publish:vi.fn()},log:{warn:vi.fn()},onDispose:vi.fn(),agents:{registerTool:vi.fn()},ui:{registerMentionProvider:vi.fn()},rpc:{register:(_c:unknown,h:typeof handlers)=>Object.assign(handlers,h)},
  settings:{define:()=>({get:async()=>({loopsEnabled:true,loopDailyBudget:0}),onChange:(f:typeof onChange)=>{onChange=f;}})},sdk:{threads:{get:async()=>null}}};
 const loops=registerLoops(bb as never,db,post,notify);await vi.advanceTimersByTimeAsync(0);
 const low=loops.store.add({title:'Tailscale node',priority:'low'});const later=loops.store.add({title:'Later',trigger:{type:'time',at:Date.now()+86400000}});
 await loops.scheduler.tick();expect(store.get(low.id).status).toBe('queued');expect(loops.scheduler.held()).toEqual([{id:low.id,reason:'morning'}]);
 post.mockClear();
 for(const l of [low,later]){const out=await handlers['loops.update']!({id:l.id,surfaceNow:true}) as {status:string};expect(out.status).toBe('surfaced');}
 expect(post).toHaveBeenCalledTimes(2);expect(post.mock.calls[0]![0]).toContain(`::loop{id="${low.id}"}`);
 expect(store.groups().needsYouNow.map(l=>l.id)).toEqual(expect.arrayContaining([low.id,later.id]));
 // Pressing it again doesn't post a second card; it isn't counted against the budget.
 await handlers['loops.update']!({id:low.id,surfaceNow:true});expect(post).toHaveBeenCalledTimes(2);
 expect((db.prepare("SELECT count(*) n FROM loop_events WHERE type='surfaced'").get() as {n:number}).n).toBe(0);
 const cos=loops.store.add({title:'CoS job',owner:'cos'});await expect(handlers['loops.update']!({id:cos.id,surfaceNow:true})).rejects.toThrow('Only your own loops');
 loops.store.act({id:low.id,action:'done'},()=>({type:'none'}));await expect(handlers['loops.update']!({id:low.id,surfaceNow:true})).rejects.toThrow('already closed');
 onChange({loopsEnabled:false});await expect(handlers['loops.update']!({id:later.id,surfaceNow:true})).rejects.toThrow('Attention Router is off');
 // The Bot's own surfaceNow keeps the policy: queued, trigger none, held for the morning.
 const botLow=loops.store.add({title:'Bot low',priority:'low',trigger:{type:'time',at:Date.now()+3600000}});const tool=(bb.agents.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(c=>c[0]).find((t:{name:string})=>t.name==='loops_update');
 expect(JSON.parse(await tool.execute({id:botLow.id,surfaceNow:true}))).toMatchObject({status:'queued',trigger:{type:'none'}});});

it('gives the Bot a mentioned or referenced loop: the @loop provider, loops_get, and the hint in the tool descriptions',async()=>{
 const bb={realtime:{publish:vi.fn()},log:{warn:vi.fn()},onDispose:vi.fn(),agents:{registerTool:vi.fn()},ui:{registerMentionProvider:vi.fn()},rpc:{register:vi.fn()},
  settings:{define:()=>({get:async()=>({loopsEnabled:true}),onChange:()=>{}})},sdk:{threads:{get:async()=>null}}};
 const loops=registerLoops(bb as never,db,post,notify);await vi.advanceTimersByTimeAsync(0);
 const l=loops.store.add({title:'Reply to Yassine\nabout the referral',why:'The posting closes Friday.',trigger:{type:'event',event:'reply:yassine',label:'when Yassine replies'}});
 loops.store.add({title:'Pay the tax'});
 const provider=(bb.ui.registerMentionProvider as ReturnType<typeof vi.fn>).mock.calls[0]![0];
 expect(provider.id).toBe('loop');
 expect((await provider.search({query:'yassine'})).map((i:{id:string})=>i.id)).toEqual([l.id]);
 const {context}=await provider.resolve(l.id);
 for(const part of [`id: ${l.id}`,'title: Reply to Yassine about the referral','why: The posting closes Friday.','trigger: event reply:yassine (when Yassine replies)','it is the topic'])expect(context).toContain(part);
 // A loop deleted since doesn't block the send.
 expect((await provider.resolve('loop_gone')).context).toContain('no longer exists');
 const tools=(bb.agents.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(c=>c[0]);
 const get=tools.find((t:{name:string})=>t.name==='loops_get');
 expect(JSON.parse(await get.execute({id:l.id})).loop.id).toBe(l.id);
 for(const name of ['loops_get','loops_list'])expect(tools.find((t:{name:string})=>t.name===name).description).toContain('::loop{id="…"} line');
});
