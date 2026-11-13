import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { rpcContract, add, act, update, filters, ownerInfo, type Loop } from './contract';
import { LoopStore, placeKey } from './store';
import { LoopScheduler, defaults, snooze } from './scheduler';
/** The lock-screen actions a todo's push offers, by kind (the app's BB_LOOP categories). */
export function loopPushActions(kind:Loop['kind']):('done'|'snooze'|'got_it'|'choose')[]{return kind==='read'?['got_it','snooze']:kind==='decide'?['choose','snooze']:['done','snooze'];}
import { STUDIO_REALTIME_CHANNEL } from '../kit/contract';
import { defineItemMention } from '../kit/server/mention';
import { LOOP_MENTION, LOOP_TOPIC_HINT, loopContext } from './reference';
import { KIND } from './ui/model';
type ThreadLike={title?:string|null;titleFallback?:string|null;archivedAt?:number|null;deletedAt?:number|null};
/** A `thread:<id>` owner by name. A deleted or missing thread has no link. */
export function threadOwner(owner:string,thread:ThreadLike|null):z.infer<typeof ownerInfo>{const threadId=owner.slice('thread:'.length);
 if(!thread||thread.deletedAt)return {owner,name:'A thread that was removed',threadId:null};
 const title=(thread.title||thread.titleFallback||'').trim()||'Untitled thread';return {owner,name:thread.archivedAt?`${title} (archived)`:title,threadId};}
const TOOL_VERBS=['add','list','get','update','act','fire','morning'];
/** Every tool under both names: todos_x, and loops_x, its alias from before the rename. */
export const LOOP_TOOLS=[...TOOL_VERBS.map(v=>`todos_${v}`),...TOOL_VERBS.map(v=>`loops_${v}`)];
/** Todos' settings are Studio settings (src/settings): loopsEnabled under Threads, the rest under Bot ▸ Controls ▸ Attention. The time zone is this Mac's. */
type LoopSettings={get():Promise<Record<string,unknown>>;onChange(listener:(next:Record<string,unknown>)=>void):void};
export function registerLoops(bb:BbPluginApi,db:Database.Database,post:(text:string)=>Promise<void>,notify:ConstructorParameters<typeof LoopScheduler>[3],settings:LoopSettings,timeZone:()=>string=()=>defaults.timeZone,every:(name:string,everyMs:number,work:()=>void)=>void=(_name,everyMs,work)=>{const timer=setInterval(work,everyMs);bb.onDispose(()=>clearInterval(timer));}){
 // Every saved change tells open windows (cards, the Todos tab, badges) to refetch.
 const store=new LoopStore(db,()=>bb.realtime.publish(STUDIO_REALTIME_CHANNEL,{pluginId:'studio'}));
 let config=defaults;
 const scheduler=new LoopScheduler(store,()=>config,post,notify);
 const tick=()=>void scheduler.tick().catch(e=>bb.log.warn(String(e)));
 // Turning Todos on releases what queued while it was off, without waiting a minute.
 const refresh=(v:Record<string,unknown>)=>{const zone=timeZone();try{localCheck(zone);const was=config.enabled;config={enabled:v.loopsEnabled===true,timeZone:zone,dailyBudget:Math.max(0,Number(v.loopDailyBudget??5)),quietStart:Number(v.loopQuietStart??22),quietEnd:Number(v.loopQuietEnd??7)};if(!was&&config.enabled)tick();}catch(e){bb.log.warn(String(e));}};
 function localCheck(zone:string){new Intl.DateTimeFormat('en',{timeZone:zone}).format();}
 void settings.get().then(refresh);settings.onChange(refresh);
 // A thread owner's name: the thread's title, "(archived)" once archived, or a fallback when it's gone.
 const owner=async(id:string):Promise<z.infer<typeof ownerInfo>|null>=>{if(!id.startsWith('thread:'))return null;const threadId=id.slice('thread:'.length);return threadOwner(id,await bb.sdk.threads.get({threadId}).catch(()=>null) as ThreadLike|null);};
 const list=async(x:z.infer<typeof filters>)=>{const g=store.groups(x);const ids=new Set([...g.needsYouNow,...g.comingUp,...g.agentsOnIt,...g.waitingOnOthers,...g.done].map(l=>l.owner));return {...g,held:scheduler.held(),areas:store.areas(),owners:(await Promise.all([...ids].map(owner))).filter((o):o is z.infer<typeof ownerInfo>=>!!o)};};
 const action=async(x:z.infer<typeof act>)=>{const l=store.act(x,p=>snooze(p,config));if(x.action==='nudge')await post(`Todo ${l.id}: nudge. Draft the nudge message and show it to Patrick in this chat for approval. Do not send it until he approves.`);else if(['hand_off','choose'].includes(x.action))await post(`Todo ${l.id}: ${x.action}. ${x.option??''} Owner: ${l.owner}. Use todos_list to review and carry out the next step.`);return l;};
 const change=(x:z.infer<typeof update>)=>store.update(x.id,{...x.changes,...(x.surfaceNow?{status:'queued' as const,trigger:{type:'none' as const}}:{})});
 // A spoken or typed line becomes a draft todo the Bot fills in.
 const addLine=async(text:string)=>{const l=store.add({title:text,status:'in_progress',owner:'cos'});await post(`Fill in draft todo ${l.id} from this typed line using todos_update, then queue it: ${JSON.stringify(text)}`);return l;};
 const get=async(id:string)=>{const l=store.get(id),o=await owner(l.owner);return {loop:l,history:store.history(id),...(o?{owner:o}:{})};};
 bb.rpc.register(rpcContract,{
 'loops.list':list,'loops.get':({id})=>get(id),
 'loops.add':({text})=>addLine(text),
 'loops.update':async(x:z.infer<typeof update>)=>{if(!x.surfaceNow)return change(x);if(x.changes)store.update(x.id,x.changes);return scheduler.surfaceNow(x.id);},'loops.act':action,'loops.fire':({event})=>scheduler.fire(event),'loops.place':({place,direction})=>scheduler.fire(`place:${placeKey(place)}:${direction}`),'loops.setPlaces':({names})=>({names:store.setPlaces(names)}),'loops.places':()=>({names:store.places()}),'loops.morning':()=>scheduler.morning(),
 });
 // Each tool is registered twice: todos_x, and loops_x as its alias.
 const tool=<S extends z.ZodTypeAny>(verb:string,description:string,parameters:S,execute:(x:z.infer<S>)=>string|Promise<string>)=>{bb.agents.registerTool({name:`todos_${verb}`,description,parameters,execute});bb.agents.registerTool({name:`loops_${verb}`,description:`Alias of todos_${verb}.`,parameters,execute});};
 tool('add','Track an open obligation, decision or item to read. Set its owner and release trigger; give an event trigger a short label in words ("when Unraid fixes the PHP CVE"). Avoid duplicating pending chat questions.',add,x=>JSON.stringify(store.add(x)));
 tool('list','Review tracked todos, grouped by who needs to act. Filter by area or owner. When Patrick wants to go through his todos with you, post ::loops{open="pane"} once on its own line: a card that opens the Todos list beside your chat, so it stays up while you talk. '+LOOP_TOPIC_HINT,filters,async x=>JSON.stringify(await list(x)));
 tool('get','Read one todo by id: its record, history and owner. '+LOOP_TOPIC_HINT,z.object({id:z.string().min(1)}),async({id})=>JSON.stringify(await get(id)));
 tool('update','Fill in a captured draft or change a todo and its trigger. Surface now (from you, the Bot) still respects the attention budget; Patrick\'s own Remind me now button releases at once.',update,x=>JSON.stringify(change(x)));
 tool('act','Close, snooze, choose an option, nudge, keep or hand off a todo when there is evidence or the user asks.',act,async x=>JSON.stringify(await action(x)));
 tool('fire','Signal a named event such as reply:sam to release todos waiting on it.',z.object({event:z.string().min(1)}),({event})=>JSON.stringify(scheduler.fire(event)));
 tool('morning','Get the top five due items or decisions and the remaining count for the morning message. Write the morning message in exactly this shape, one card in the chat: a "## <Weekday, Mon D>" heading; "**Calendar**" then "- <time> · <event>" lines; "**On today\'s list**" then one ::loop{id="<id>" row="1"} line per item, in order; ::loops{more="<more>"} when more is above 0; "**Good to know**" then at most 3 "- " lines (personal only, no Larkspur or tech news). Leave out an empty section. Put a blank line before each bold label (**Calendar**, **On today\'s list**, **Good to know**), or the markdown runs the label into the bullet above it.',z.object({}),()=>JSON.stringify(scheduler.morning()));
 // `@loop` in any composer, and the chip Discuss puts in the Bot chat: the Bot gets the todo as context.
 // A todo deleted since is said so rather than thrown, which would block the send.
 bb.ui.registerMentionProvider(defineItemMention({id:LOOP_MENTION,label:'Todos',
  search:({query})=>{const q=query.trim().toLowerCase();const g=store.groups();return [...g.needsYouNow,...g.comingUp,...g.agentsOnIt,...g.waitingOnOthers,...g.done].filter(l=>!q||l.title.toLowerCase().includes(q)).map(l=>({id:l.id,title:l.title,subtitle:l.closedAt?'Done':KIND[l.kind].label,icon:KIND[l.kind].icon}));},
  resolve:(id)=>{try{return {context:loopContext(store.get(id))};}catch{return {context:`Patrick mentioned todo ${id}, which no longer exists.`};}}}));
 every('todos',60_000,tick);
 return {store,scheduler,act:action,add:addLine,enabled:()=>config.enabled,setSettings:(value:typeof defaults)=>{config=value;}};
}
