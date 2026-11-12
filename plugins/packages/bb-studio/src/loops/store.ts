import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { add, loop, type Loop, act } from './contract';
import type { z } from 'zod';
/** A place trigger's key: the place name in lower case, as `place:<key>:arrive` events carry it. */
export const placeKey=(name:string)=>name.trim().toLowerCase();
/** Queued or snoozed: the todo waits for its trigger, whoever owns it. */
export const waitsForTrigger=(l:Pick<Loop,'status'|'closedAt'>)=>!l.closedAt&&(l.status==='queued'||l.status==='snoozed');
export class LoopStore {
 constructor(readonly db:Database.Database,readonly changed:()=>void=()=>{}) {}
 all():Loop[] { return this.db.prepare('SELECT record FROM bot_loops').all().map((r:any)=>loop.parse(JSON.parse(r.record))); }
 get(id:string):Loop { const r=this.db.prepare('SELECT record FROM bot_loops WHERE id=?').get(id) as any; if(!r)throw Error('Todo not found'); return loop.parse(JSON.parse(r.record)); }
 save(l:Loop):Loop { l=loop.parse(l);
 if(l.trigger.type==='place'&&l.trigger.place)l={...l,trigger:{...l.trigger,place:placeKey(l.trigger.place)}};
 const t=l.trigger;if(t.type==='time'&&!Number.isFinite(t.at)||t.type==='event'&&!t.event||t.type==='place'&&(!t.place||!t.direction))throw Error('Trigger fields are incomplete');
 if(['done','dropped'].includes(l.status)&&!l.closedAt)l={...l,closedAt:Date.now(),closedBy:'cos'};
  this.db.prepare('INSERT OR REPLACE INTO bot_loops VALUES (?,?)').run(l.id,JSON.stringify(l)); this.changed(); return l; }
 add(input:z.infer<typeof add>):Loop { const x=add.parse(input), now=Date.now(); return this.save({why:'',source:null,kind:'do',options:[],owner:'patrick',trigger:{type:'none'},priority:'normal',push:false,status:'queued',due:null,area:null,...x,id:`loop_${randomUUID()}`,createdAt:now,updatedAt:now,closedAt:null,closedBy:null}); }
 event(id:string,type:string,data:unknown={}) { this.db.prepare('INSERT INTO loop_events(loop_id,type,at,data) VALUES (?,?,?,?)').run(id,type,Date.now(),JSON.stringify(data)); }
 history(id:string) { return this.db.prepare('SELECT type,at,data FROM loop_events WHERE loop_id=? ORDER BY seq').all(id) as {type:string;at:number;data:string}[]; }
 // An open status on a closed todo reopens it (Undo on Done).
 update(id:string,changes:Partial<z.infer<typeof add>>) { const cur=this.get(id),x=add.partial().parse(changes); const reopen=!!cur.closedAt&&!!x.status&&!['done','dropped'].includes(x.status); if(reopen)this.event(id,'reopened',{status:x.status}); return this.save({...cur,...x,...(reopen?{closedAt:null,closedBy:null}:{}),updatedAt:Date.now()}); }
 act(input:z.infer<typeof act>,snooze:(preset:string)=>Loop['trigger']):Loop { const x=act.parse(input); return this.db.transaction(()=>{let l=this.get(x.id); if(l.closedAt)return l;
 if(x.action==='choose' && (l.kind!=='decide'||!x.option||!l.options.includes(x.option)))throw Error('Choose an existing option');
 if(['done','drop','got_it','choose'].includes(x.action)){l={...l,status:x.action==='drop'?'dropped':'done',closedAt:Date.now(),closedBy:'patrick'};this.event(l.id,'closed',{action:x.action,option:x.option});}
 else if(x.action==='snooze'){if(!x.snooze)throw Error('Choose a snooze preset');l={...l,status:'snoozed',trigger:snooze(x.snooze)};this.event(l.id,'snoozed',{until:l.trigger});}
 else if(x.action==='hand_off'){l={...l,status:'in_progress',owner:x.owner??'cos'};this.event(l.id,'handed_off',{owner:l.owner});}
 this.event(l.id,'acted',{action:x.action,option:x.option});return this.save({...l,updatedAt:Date.now()});})(); }
 // The phone's place names replace the list; one per name, ignoring case.
 places():string[] { const r=this.db.prepare("SELECT value FROM loop_scheduler WHERE key='places'").get() as {value:string}|undefined; return r?JSON.parse(r.value):[]; }
 setPlaces(names:string[]):string[] { const seen=new Set<string>(),kept:string[]=[]; for(const n of names.map(n=>n.trim()).filter(Boolean)){if(seen.has(placeKey(n)))continue;seen.add(placeKey(n));kept.push(n);} const list=kept.slice(0,20); this.db.prepare("INSERT OR REPLACE INTO loop_scheduler VALUES ('places',?)").run(JSON.stringify(list)); return list; }
 // Agents on it: started work (in progress, handed off). A todo anyone owns that waits for its trigger is Coming up.
 groups(filters:{area?:string;owner?:string}={}) {const g={needsYouNow:[] as Loop[],comingUp:[] as Loop[],agentsOnIt:[] as Loop[],waitingOnOthers:[] as Loop[],done:[] as Loop[]}; for(const l of this.all()){if(filters.area&&l.area?.trim()!==filters.area.trim()||filters.owner&&l.owner!==filters.owner)continue; if(l.closedAt){if(l.closedAt>Date.now()-7*86400000)g.done.push(l);}else if(l.kind==='waiting')g.waitingOnOthers.push(l);else if(l.owner!=='patrick'&&!waitsForTrigger(l))g.agentsOnIt.push(l);else if(l.owner==='patrick'&&l.status==='surfaced')g.needsYouNow.push(l);else g.comingUp.push(l);}return g;}
 areas():string[] {const g=this.groups(),count=new Map<string,number>(); for(const l of [...g.needsYouNow,...g.comingUp,...g.agentsOnIt,...g.waitingOnOthers,...g.done]){const a=l.area?.trim(); if(a)count.set(a,(count.get(a)??0)+1);} return [...count].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([a])=>a);}
}
