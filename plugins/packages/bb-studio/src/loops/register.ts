import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { rpcContract, ownerInfo } from './contract';
import { LoopStore } from './store';
import { guardTasks } from '../tasks/store';
import { inLoopView, toLoop } from '../tasks/views';
type ThreadLike={title?:string|null;titleFallback?:string|null;archivedAt?:number|null;deletedAt?:number|null};
/** A `thread:<id>` owner by name. A deleted or missing thread has no link. */
export function threadOwner(owner:string,thread:ThreadLike|null):z.infer<typeof ownerInfo>{const threadId=owner.slice('thread:'.length);
 if(!thread||thread.deletedAt)return {owner,name:'A thread that was removed',threadId:null};
 const title=(thread.title||thread.titleFallback||'').trim()||'Untitled thread';return {owner,name:thread.archivedAt?`${title} (archived)`:title,threadId};}
/**
 * loops.get, the one loops RPC left now that personal to-dos are gone
 * (strands replaced them): an old to-do's or a task's card still reads.
 */
export function registerLoops(bb:BbPluginApi,db:Database.Database){
 const store=new LoopStore(db);
 const owner=async(id:string):Promise<z.infer<typeof ownerInfo>|null>=>{if(!id.startsWith('thread:'))return null;const threadId=id.slice('thread:'.length);return threadOwner(id,await bb.sdk.threads.get({threadId}).catch(()=>null) as ThreadLike|null);};
 const get=async(id:string)=>{const t=store.tasks.find(id);const l=t&&!inLoopView(t)?toLoop(t):store.get(id),o=await owner(l.owner);return {loop:l,history:store.history(id),...(o?{owner:o}:{})};};
 bb.rpc.register(rpcContract,guardTasks(db,{'loops.get':({id})=>get(id)},false,(message:string)=>bb.log.warn(message)));
 return {store};
}
