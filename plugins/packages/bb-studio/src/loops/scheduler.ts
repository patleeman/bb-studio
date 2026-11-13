import type { Loop } from './contract';
import { LoopStore, waitsForTrigger } from './store';
export type Hold='budget'|'morning';
const RANK={urgent:0,normal:1,low:2} as const;
/** A none trigger, or a time trigger that has come. Events and places become due times when they fire. */
export const isDue=(l:Pick<Loop,'trigger'>,now:number)=>l.trigger.type==='none'||l.trigger.type==='time'&&l.trigger.at!==undefined&&l.trigger.at<=now;
export type Settings={enabled:boolean;timeZone:string;dailyBudget:number;quietStart:number;quietEnd:number};
export const defaults:Settings={enabled:false,timeZone:'America/New_York',dailyBudget:5,quietStart:22,quietEnd:7};
export function local(now:number,zone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(now);const p=Object.fromEntries(parts.map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),minute:Number(p.minute),weekday:p.weekday};}
// Resolve wall-clock presets in the configured zone, including DST offsets.
export function snooze(preset:string,settings:Settings,now=Date.now()):Loop['trigger'] {
 if(preset==='home')return {type:'place',place:'home',direction:'arrive'};
 if(preset==='later_today')return {type:'time',at:now+3*3600000};
 const p=local(now,settings.timeZone);let wall=new Date(`${p.date}T00:00:00Z`);const hour=preset==='tonight'?19:preset==='this_weekend'?10:preset==='mac'?7:8;const minute=preset==='mac'?45:0;
 if(preset==='this_weekend'){let days=(6-wall.getUTCDay()+7)%7;if(!days&&p.hour>=10)days=7;wall.setUTCDate(wall.getUTCDate()+days);}else if(preset!=='tonight'||p.hour>=19)wall.setUTCDate(wall.getUTCDate()+1);
 wall.setUTCHours(hour,minute);let at=wall.getTime();for(let i=0;i<4;i++){const q=local(at,settings.timeZone);const observed=Date.parse(`${q.date}T${String(q.hour).padStart(2,'0')}:${String(q.minute).padStart(2,'0')}:00Z`);at+=wall.getTime()-observed;}return {type:'time',at};
}
export class LoopScheduler {
 private running=false;
 constructor(readonly store:LoopStore,readonly settings:()=>Settings,readonly post:(text:string)=>Promise<void>,readonly notify:(loop:Loop)=>Promise<void>){}
 fire(event:string){let matched=0;for(const l of this.store.all()){const t=l.trigger;if(!l.closedAt&&['queued','snoozed'].includes(l.status)&&((t.type==='event'&&t.event===event)||(t.type==='place'&&`place:${t.place}:${t.direction}`===event))){this.store.update(l.id,{trigger:{type:'time',at:Date.now()}});matched++;}}return {matched};}
 morning(){const now=Date.now(),date=local(now,this.settings().timeZone).date;const open=this.store.all().filter(l=>!l.closedAt);const items=open.filter(l=>l.owner==='patrick'&&(l.kind==='decide'||l.due!==null&&local(l.due,this.settings().timeZone).date<=date)).sort((a,b)=>({urgent:0,normal:1,low:2}[a.priority]-{urgent:0,normal:1,low:2}[b.priority])||(a.due??Infinity)-(b.due??Infinity));return {date,items:items.slice(0,5),more:Math.max(0,items.length-5),lowPriority:open.filter(l=>l.priority==='low'&&l.status==='queued')};}
 /** Whether `now` falls in quiet hours (they hold pushes, never cards). */
 quiet(now=Date.now()){const s=this.settings(),h=local(now,s.timeZone).hour;return s.quietStart>s.quietEnd?h>=s.quietStart||h<s.quietEnd:h>=s.quietStart&&h<s.quietEnd;}
 /**
  * The user's due todos in release order, each released now or held: by the
  * daily budget (cards released today in the configured zone), or, low
  * priority, for the morning card. Urgent bypasses the budget. Quiet hours
  * don't hold cards: a card in the chat at night counts toward the budget,
  * and only its push waits.
  */
 plan(now=Date.now()){const s=this.settings(),date=local(now,s.timeZone).date;
 let count=(this.store.db.prepare("SELECT at FROM loop_events WHERE type='surfaced'").all() as {at:number}[]).filter(e=>local(e.at,s.timeZone).date===date).length;
 return this.store.all().filter(l=>l.owner==='patrick'&&waitsForTrigger(l)&&isDue(l,now)).sort((a,b)=>RANK[a.priority]-RANK[b.priority]).map(loop=>{
  const held:Hold|null=loop.priority==='urgent'?null:loop.priority==='low'?'morning':count>=s.dailyBudget?'budget':null;
  if(!held)count++;return {loop,held};});}
 /** Why each due todo of the user's waits (loops.list `held`). */
 held(now=Date.now()){return this.plan(now).flatMap(({loop,held})=>held?[{id:loop.id,reason:held}]:[]);}
 /**
  * The user pressed Surface now: post the card right away, skipping the
  * low-priority morning hold and the daily budget (their own ask, so it
  * isn't an interruption and doesn't count toward the budget). Throws why
  * when it can't, so the button never silently does nothing.
  */
 async surfaceNow(id:string){const l=this.store.get(id);
 if(!this.settings().enabled)throw Error('Todo reminders are off. Turn them on in Bot settings ▸ Attention.');
 if(l.closedAt)throw Error('This todo is already closed.');
 if(l.owner!=='patrick')throw Error('Only your own todos can be surfaced. Take it back first.');
 if(l.status!=='surfaced')await this.post(`Please post this card in your chat exactly once: ::loop{id="${l.id}"}`);
 this.store.event(l.id,'surfaced_by_you');return this.store.update(l.id,{status:'surfaced'});}
 async tick(){if(this.running||!this.settings().enabled)return;this.running=true;try{const now=Date.now(),s=this.settings(),p=local(now,s.timeZone),quiet=this.quiet(now);
 for(const {loop:l,held} of this.plan(now)){if(!this.settings().enabled)return;if(held)continue;
 await this.post(`Please post this card in your chat exactly once: ::loop{id="${l.id}"}`);
 this.store.update(l.id,{status:'surfaced'});this.store.event(l.id,'surfaced');
 }
 // A todo the Bot or a thread owns starts when its time comes (a latched event is a due time): no card, no budget.
 for(const l of this.store.all().filter(l=>l.owner!=='patrick'&&waitsForTrigger(l)&&l.trigger.type==='time'&&isDue(l,now))){if(!this.settings().enabled)return;
 await this.post(`Todo ${l.id} is due: ${JSON.stringify(l.title)}. Owner: ${l.owner}. ${l.owner==='cos'?'Carry out the next step now':'Ask that thread to carry out the next step'}, and record progress with todos_update or todos_act.`);
 this.store.update(l.id,{status:'in_progress'});this.store.event(l.id,'started');
 }
 for(const l of this.store.all().filter(l=>l.status==='surfaced'&&(l.push||l.priority==='urgent'))){if(!this.settings().enabled)return;if(quiet&&l.priority!=='urgent')continue;const notified=this.store.history(l.id).filter(e=>e.type==='notified');if(notified.length&&!(l.due!==null&&l.due<now&&local(notified.at(-1)!.at,s.timeZone).date!==p.date))continue;await this.notify(l);this.store.event(l.id,'notified');}
 if(this.settings().enabled&&p.weekday==='Mon'&&p.hour>=9&&!quiet){const key=`stale:${p.date}`;if(!this.store.db.prepare('SELECT key FROM loop_scheduler WHERE key=?').get(key)){const stale=this.store.all().filter(l=>!l.closedAt&&l.updatedAt<now-3*86400000);if(stale.length)await this.post('Weekly stale todos: offer Keep or Drop for '+stale.map(l=>`::loop{id="${l.id}"}`).join(' '));this.store.db.prepare('INSERT INTO loop_scheduler VALUES (?,?)').run(key,'sent');}}
 }finally{this.running=false;}}
}
