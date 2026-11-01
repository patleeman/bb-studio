import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { rpcContract, add, act, update, filters } from './contract';
import { LoopStore } from './store';
import { LoopScheduler, defaults, snooze } from './scheduler';
export const LOOP_TOOLS=['loops_add','loops_list','loops_update','loops_act','loops_fire','loops_morning'];
export function registerLoops(bb:BbPluginApi,db:Database.Database,post:(text:string)=>Promise<void>,notify:ConstructorParameters<typeof LoopScheduler>[3]){
 const store=new LoopStore(db);const settings=bb.settings.define({loopTimeZone:{type:'string',label:'Attention time zone',default:defaults.timeZone},loopDailyBudget:{type:'number',label:'Daily attention budget',default:5},loopQuietStart:{type:'number',label:'Quiet hours start',default:22},loopQuietEnd:{type:'number',label:'Quiet hours end',default:7}});
 let config=defaults;
 const refresh=(v:Record<string,unknown>)=>{const zone=String(v.loopTimeZone??defaults.timeZone);try{localCheck(zone);config={timeZone:zone,dailyBudget:Math.max(0,Number(v.loopDailyBudget??5)),quietStart:Number(v.loopQuietStart??22),quietEnd:Number(v.loopQuietEnd??7)};}catch(e){bb.log.warn(String(e));}};
 function localCheck(zone:string){new Intl.DateTimeFormat('en',{timeZone:zone}).format();}
 void settings.get().then(refresh);settings.onChange(refresh);
 const scheduler=new LoopScheduler(store,()=>config,post,notify);
 const action=async(x:z.infer<typeof act>)=>{const l=store.act(x,p=>snooze(p,config));if(['hand_off','nudge','choose'].includes(x.action))await post(`Loop ${l.id}: ${x.action}. ${x.option??''} Owner: ${l.owner}. Use loops_list to review and carry out the next step.`);return l;};
 const change=(x:z.infer<typeof update>)=>store.update(x.id,{...x.changes,...(x.surfaceNow?{status:'queued' as const,trigger:{type:'none' as const}}:{})});
 bb.rpc.register(rpcContract,{
 'loops.list':x=>store.groups(x),'loops.get':({id})=>({loop:store.get(id),history:store.history(id)}),
 'loops.add':async({text})=>{const l=store.add({title:text,status:'in_progress',owner:'cos'});await post(`Fill in draft loop ${l.id} from this typed line using loops_update, then queue it: ${JSON.stringify(text)}`);return l;},
 'loops.update':change,'loops.act':action,'loops.fire':({event})=>scheduler.fire(event),'loops.place':({place,direction})=>scheduler.fire(`place:${place}:${direction}`),'loops.morning':()=>scheduler.morning(),
 });
 bb.agents.registerTool({name:'loops_add',description:'Track an open obligation, decision or item to read. Set its owner and release trigger; avoid duplicating pending chat questions.',parameters:add,execute:x=>JSON.stringify(store.add(x))});
 bb.agents.registerTool({name:'loops_list',description:'Review tracked loops, grouped by who needs to act. Filter by area or owner.',parameters:filters,execute:x=>JSON.stringify(store.groups(x))});
 bb.agents.registerTool({name:'loops_update',description:'Fill in a captured draft or change a loop and its trigger. Surface now still respects the attention budget.',parameters:update,execute:x=>JSON.stringify(change(x))});
 bb.agents.registerTool({name:'loops_act',description:'Close, snooze, choose an option, nudge, keep or hand off a loop when there is evidence or the user asks.',parameters:act,execute:async x=>JSON.stringify(await action(x))});
 bb.agents.registerTool({name:'loops_fire',description:'Signal a named event such as reply:yassine to release loops waiting on it.',parameters:z.object({event:z.string().min(1)}),execute:({event})=>JSON.stringify(scheduler.fire(event))});
 bb.agents.registerTool({name:'loops_morning',description:'Get the top five due items or decisions and the remaining count for the morning message. Add calendar and good-to-know lines yourself.',parameters:z.object({}),execute:()=>JSON.stringify(scheduler.morning())});
 const timer=setInterval(()=>void scheduler.tick().catch(e=>bb.log.warn(String(e))),60_000);bb.onDispose(()=>clearInterval(timer));
 return {store,scheduler,setSettings:(value:typeof defaults)=>{config=value;}};
}
