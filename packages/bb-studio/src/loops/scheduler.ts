import type { Loop } from './contract';
import { LoopStore } from './store';
export type Settings={timeZone:string;dailyBudget:number;quietStart:number;quietEnd:number};
export const defaults:Settings={timeZone:'America/New_York',dailyBudget:5,quietStart:22,quietEnd:7};
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
 async tick(){if(this.running)return;this.running=true;try{const now=Date.now(),s=this.settings(),p=local(now,s.timeZone);const quiet=s.quietStart>s.quietEnd?p.hour>=s.quietStart||p.hour<s.quietEnd:p.hour>=s.quietStart&&p.hour<s.quietEnd;
 let count=(this.store.db.prepare("SELECT at FROM loop_events WHERE type='surfaced'").all() as {at:number}[]).filter(e=>local(e.at,s.timeZone).date===p.date).length;
 const candidates=this.store.all().filter(l=>!l.closedAt&&['queued','snoozed'].includes(l.status)).sort((a,b)=>({urgent:0,normal:1,low:2}[a.priority]-{urgent:0,normal:1,low:2}[b.priority]));
 for(const l of candidates){if(l.owner!=='patrick'||l.trigger.type==='event'||l.trigger.type==='place'||l.trigger.type==='time'&&(l.trigger.at===undefined||l.trigger.at>now))continue;
 if(l.priority!=='urgent'&&(quiet||count>=s.dailyBudget||l.priority==='low'))continue;
 await this.post(`Please post this card in your chat exactly once: ::loop{id="${l.id}"}`);
 this.store.update(l.id,{status:'surfaced'});this.store.event(l.id,'surfaced');count++;
 }
 for(const l of this.store.all().filter(l=>l.status==='surfaced'&&(l.push||l.priority==='urgent'))){if(quiet&&l.priority!=='urgent')continue;const notified=this.store.history(l.id).filter(e=>e.type==='notified');if(notified.length&&!(l.due!==null&&l.due<now&&local(notified.at(-1)!.at,s.timeZone).date!==p.date))continue;await this.notify(l);this.store.event(l.id,'notified');}
 if(p.weekday==='Mon'&&p.hour>=9&&!quiet){const key=`stale:${p.date}`;if(!this.store.db.prepare('SELECT key FROM loop_scheduler WHERE key=?').get(key)){const stale=this.store.all().filter(l=>!l.closedAt&&l.updatedAt<now-3*86400000);if(stale.length)await this.post('Weekly stale loops: offer Keep or Drop for '+stale.map(l=>`::loop{id="${l.id}"}`).join(' '));this.store.db.prepare('INSERT INTO loop_scheduler VALUES (?,?)').run(key,'sent');}}
 }finally{this.running=false;}}
}
