import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { rpcContract, add, act, update, filters, ownerInfo, type Loop } from './contract';
import { LoopStore, placeKey } from './store';
import { LoopScheduler, defaults, snooze } from './scheduler';
/** The lock-screen actions a loop's push offers, by kind (the app's BB_LOOP categories). */
export function loopPushActions(kind:Loop['kind']):('done'|'snooze'|'got_it'|'choose')[]{return kind==='read'?['got_it','snooze']:kind==='decide'?['choose','snooze']:['done','snooze'];}
import { STUDIO_REALTIME_CHANNEL } from '../kit/contract';
type ThreadLike={title?:string|null;titleFallback?:string|null;archivedAt?:number|null;deletedAt?:number|null};
/** A `thread:<id>` owner by name. A deleted or missing thread has no link. */
export function threadOwner(owner:string,thread:ThreadLike|null):z.infer<typeof ownerInfo>{const threadId=owner.slice('thread:'.length);
 if(!thread||thread.deletedAt)return {owner,name:'A thread that was removed',threadId:null};
 const title=(thread.title||thread.titleFallback||'').trim()||'Untitled thread';return {owner,name:thread.archivedAt?`${title} (archived)`:title,threadId};}
export const LOOP_TOOLS=['loops_add','loops_list','loops_update','loops_act','loops_fire','loops_morning'];
export function registerLoops(bb:BbPluginApi,db:Database.Database,post:(text:string)=>Promise<void>,notify:ConstructorParameters<typeof LoopScheduler>[3]){
 // Every saved change tells open windows (cards, the Loops tab, badges) to refetch.
 const store=new LoopStore(db,()=>bb.realtime.publish(STUDIO_REALTIME_CHANNEL,{pluginId:'studio'}));const settings=bb.settings.define({loopsEnabled:{type:'boolean',label:'Attention Router',default:false},loopTimeZone:{type:'string',label:'Attention time zone',default:defaults.timeZone},loopDailyBudget:{type:'number',label:'Daily attention budget',default:5},loopQuietStart:{type:'number',label:'Quiet hours start',default:22},loopQuietEnd:{type:'number',label:'Quiet hours end',default:7}});
 let config=defaults;
 const scheduler=new LoopScheduler(store,()=>config,post,notify);
 const tick=()=>void scheduler.tick().catch(e=>bb.log.warn(String(e)));
 // Turning the Attention Router on releases what queued while it was off, without waiting a minute.
 const refresh=(v:Record<string,unknown>)=>{const zone=String(v.loopTimeZone??defaults.timeZone);try{localCheck(zone);const was=config.enabled;config={enabled:v.loopsEnabled===true,timeZone:zone,dailyBudget:Math.max(0,Number(v.loopDailyBudget??5)),quietStart:Number(v.loopQuietStart??22),quietEnd:Number(v.loopQuietEnd??7)};if(!was&&config.enabled)tick();}catch(e){bb.log.warn(String(e));}};
 function localCheck(zone:string){new Intl.DateTimeFormat('en',{timeZone:zone}).format();}
 void settings.get().then(refresh);settings.onChange(refresh);
 // A thread owner's name: the thread's title, "(archived)" once archived, or a fallback when it's gone.
 const owner=async(id:string):Promise<z.infer<typeof ownerInfo>|null>=>{if(!id.startsWith('thread:'))return null;const threadId=id.slice('thread:'.length);return threadOwner(id,await bb.sdk.threads.get({threadId}).catch(()=>null) as ThreadLike|null);};
 const list=async(x:z.infer<typeof filters>)=>{const g=store.groups(x);const ids=new Set([...g.needsYouNow,...g.comingUp,...g.agentsOnIt,...g.waitingOnOthers,...g.done].map(l=>l.owner));return {...g,held:scheduler.held(),owners:(await Promise.all([...ids].map(owner))).filter((o):o is z.infer<typeof ownerInfo>=>!!o)};};
 const action=async(x:z.infer<typeof act>)=>{const l=store.act(x,p=>snooze(p,config));if(x.action==='nudge')await post(`Loop ${l.id}: nudge. Draft the nudge message and show it to Patrick in this chat for approval. Do not send it until he approves.`);else if(['hand_off','choose'].includes(x.action))await post(`Loop ${l.id}: ${x.action}. ${x.option??''} Owner: ${l.owner}. Use loops_list to review and carry out the next step.`);return l;};
 const change=(x:z.infer<typeof update>)=>store.update(x.id,{...x.changes,...(x.surfaceNow?{status:'queued' as const,trigger:{type:'none' as const}}:{})});
 bb.rpc.register(rpcContract,{
 'loops.list':list,'loops.get':async({id})=>{const l=store.get(id),o=await owner(l.owner);return {loop:l,history:store.history(id),...(o?{owner:o}:{})};},
 'loops.add':async({text})=>{const l=store.add({title:text,status:'in_progress',owner:'cos'});await post(`Fill in draft loop ${l.id} from this typed line using loops_update, then queue it: ${JSON.stringify(text)}`);return l;},
 'loops.update':async(x:z.infer<typeof update>)=>{if(!x.surfaceNow)return change(x);if(x.changes)store.update(x.id,x.changes);return scheduler.surfaceNow(x.id);},'loops.act':action,'loops.fire':({event})=>scheduler.fire(event),'loops.place':({place,direction})=>scheduler.fire(`place:${placeKey(place)}:${direction}`),'loops.setPlaces':({names})=>({names:store.setPlaces(names)}),'loops.places':()=>({names:store.places()}),'loops.morning':()=>scheduler.morning(),
 });
 bb.agents.registerTool({name:'loops_add',description:'Track an open obligation, decision or item to read. Set its owner and release trigger; give an event trigger a short label in words ("when Unraid fixes the PHP CVE"). Avoid duplicating pending chat questions.',parameters:add,execute:x=>JSON.stringify(store.add(x))});
 bb.agents.registerTool({name:'loops_list',description:'Review tracked loops, grouped by who needs to act. Filter by area or owner.',parameters:filters,execute:async x=>JSON.stringify(await list(x))});
 bb.agents.registerTool({name:'loops_update',description:'Fill in a captured draft or change a loop and its trigger. Surface now (from you, the Bot) still respects the attention budget; Patrick\'s own Surface now button releases at once.',parameters:update,execute:x=>JSON.stringify(change(x))});
 bb.agents.registerTool({name:'loops_act',description:'Close, snooze, choose an option, nudge, keep or hand off a loop when there is evidence or the user asks.',parameters:act,execute:async x=>JSON.stringify(await action(x))});
 bb.agents.registerTool({name:'loops_fire',description:'Signal a named event such as reply:yassine to release loops waiting on it.',parameters:z.object({event:z.string().min(1)}),execute:({event})=>JSON.stringify(scheduler.fire(event))});
 bb.agents.registerTool({name:'loops_morning',description:'Get the top five due items or decisions and the remaining count for the morning message. Write the morning message in exactly this shape, one card in the chat: a "## <Weekday, Mon D>" heading; "**Calendar**" then "- <time> · <event>" lines; "**On today\'s list**" then one ::loop{id="<id>" row="1"} line per item, in order; ::loops{more="<more>"} when more is above 0; "**Good to know**" then at most 3 "- " lines (personal only, no Kensico or tech news). Leave out an empty section. Put a blank line before each bold label (**Calendar**, **On today\'s list**, **Good to know**), or the markdown runs the label into the bullet above it.',parameters:z.object({}),execute:()=>JSON.stringify(scheduler.morning())});
 const timer=setInterval(tick,60_000);bb.onDispose(()=>clearInterval(timer));
 return {store,scheduler,enabled:()=>config.enabled,setSettings:(value:typeof defaults)=>{config=value;}};
}
