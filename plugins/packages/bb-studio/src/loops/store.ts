import type Database from 'better-sqlite3';
import type { Loop } from './contract';
import { TaskStore } from '../tasks/store';
import { inLoopView, toLoop } from '../tasks/views';
/** A place trigger's key: the place name in lower case, as `place:<key>:arrive` events carry it. */
export const placeKey=(name:string)=>name.trim().toLowerCase();
/** Old to-dos, read in their old shape from the tasks table (loops.get, the Bot's attention). */
export class LoopStore {
 readonly tasks:TaskStore;
 constructor(readonly db:Database.Database) { this.tasks=new TaskStore(db); }
 all():Loop[] { return this.tasks.all().filter(inLoopView).map(toLoop); }
 get(id:string):Loop { const t=this.tasks.find(id); if(!t||!inLoopView(t))throw Error('Todo not found'); return toLoop(t); }
 history(id:string) { return this.tasks.history(id); }
}
