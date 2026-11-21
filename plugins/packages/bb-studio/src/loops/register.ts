import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { rpcContract, act, update, ownerInfo, type Loop } from './contract';
import { LoopStore } from './store';
import { guardTasks } from '../tasks/store';
import { inLoopView, toLoop } from '../tasks/views';
import { defaults, local, snooze, systemTimeZone } from './scheduler';
import { STUDIO_REALTIME_CHANNEL } from '../kit/contract';
import { ownerText } from './reference';
type ThreadLike={title?:string|null;titleFallback?:string|null;archivedAt?:number|null;deletedAt?:number|null};
/** A `thread:<id>` owner by name. A deleted or missing thread has no link. */
export function threadOwner(owner:string,thread:ThreadLike|null):z.infer<typeof ownerInfo>{const threadId=owner.slice('thread:'.length);
 if(!thread||thread.deletedAt)return {owner,name:'A thread that was removed',threadId:null};
 const title=(thread.title||thread.titleFallback||'').trim()||'Untitled thread';return {owner,name:thread.archivedAt?`${title} (archived)`:title,threadId};}
/**
 * The loops RPCs, kept for older phone builds now that personal to-dos are
 * gone (strands replaced them): no reminders run, nothing is added, and the
 * lists are empty. An old to-do's card still reads (loops.get) and its
 * actions still close or change the row; the Bot hears of a hand-off.
 */
export function registerLoops(bb:BbPluginApi,db:Database.Database,post:(text:string)=>Promise<void>,timeZone:()=>string=()=>systemTimeZone()){
 const store=new LoopStore(db,()=>bb.realtime.publish(STUDIO_REALTIME_CHANNEL,{pluginId:'studio'}));
 const config=()=>({...defaults,enabled:false,timeZone:timeZone()});
 const owner=async(id:string):Promise<z.infer<typeof ownerInfo>|null>=>{if(!id.startsWith('thread:'))return null;const threadId=id.slice('thread:'.length);return threadOwner(id,await bb.sdk.threads.get({threadId}).catch(()=>null) as ThreadLike|null);};
 let route:((x:z.infer<typeof act>)=>Promise<Loop|null>)|null=null;
 const action=async(x:z.infer<typeof act>)=>{if(route){const routed=await route(x);if(routed)return routed;}return direct(x);};
 const direct=async(x:z.infer<typeof act>)=>{const l=store.act(x,p=>snooze(p,config()));if(x.action==='nudge')await post(`The user asked you to nudge about ${JSON.stringify(l.title)}. Draft the nudge message and show it to the user in this chat for approval. Do not send it until they approve.`);else if(['hand_off','choose'].includes(x.action))await post(`The user chose ${x.action==='choose'?JSON.stringify(x.option??''):'to hand off'} ${JSON.stringify(l.title)}. Owner: ${ownerText(l.owner)}. Carry out the next step and report in this chat.`);return l;};
 const change=(x:z.infer<typeof update>)=>store.update(x.id,{...x.changes,...(x.surfaceNow?{status:'queued' as const,trigger:{type:'none' as const}}:{})});
 const get=async(id:string)=>{const t=store.tasks.find(id);const l=t&&!inLoopView(t)?toLoop(t):store.get(id),o=await owner(l.owner);return {loop:l,history:store.history(id),...(o?{owner:o}:{})};};
 const empty={needsYouNow:[],comingUp:[],agentsOnIt:[],waitingOnOthers:[],done:[],held:[],areas:[],owners:[]};
 bb.rpc.register(rpcContract,guardTasks(db,{
 'loops.list':()=>empty,'loops.get':({id})=>get(id),
 'loops.add':()=>{throw new Error('To-dos are gone from BB Studio. Tell your Bot in its chat instead.');},
 'loops.update':async(x:z.infer<typeof update>)=>change(x),'loops.act':action,
 'loops.fire':()=>({matched:0}),'loops.place':()=>({matched:0}),'loops.setPlaces':()=>({names:[]}),'loops.places':()=>({names:[]}),
 'loops.morning':()=>({date:local(Date.now(),timeZone()).date,items:[],more:0,lowPriority:[]}),
 },false,(message:string)=>bb.log.warn(message)));
 return {store,act:action,actDirect:direct,routeActs:(fn:(x:z.infer<typeof act>)=>Promise<Loop|null>)=>{route=fn;}};
}
