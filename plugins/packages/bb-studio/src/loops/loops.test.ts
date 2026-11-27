import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MIGRATIONS } from '../migrations';
import { rpcContract } from './contract';
import { registerLoops, threadOwner } from './register';
import { seedTodo } from '../tasks/test/tools';
let db:Database.Database;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));db=new Database(':memory:');db.exec(MIGRATIONS.find((sql)=>sql.includes('CREATE TABLE bot_loops'))!);db.exec(MIGRATIONS.find((sql)=>sql.includes('CREATE TABLE tasks'))!);});
afterEach(()=>{db.close();vi.useRealTimers();});
it('names a thread owner by its title, marks it archived, and drops the link once it is gone',()=>{
 expect(threadOwner('thread:thr_a',{title:'AI power Long read'})).toEqual({owner:'thread:thr_a',name:'AI power Long read',threadId:'thr_a'});
 expect(threadOwner('thread:thr_a',{title:null,titleFallback:'Utilities pass'})).toMatchObject({name:'Utilities pass'});
 expect(threadOwner('thread:thr_a',{title:'Old',archivedAt:5})).toEqual({owner:'thread:thr_a',name:'Old (archived)',threadId:'thr_a'});
 expect(threadOwner('thread:thr_a',null)).toEqual({owner:'thread:thr_a',name:'A thread that was removed',threadId:null});});
it('hardcodes no area names in the Loops UI or the iOS app',async()=>{
 const {existsSync,readFileSync}=await import('node:fs');const paths=['./ui/model.ts','../../../../apps/ios/iOS/Loops/LoopsView.swift','../../../../../ios/iOS/Loops/LoopsView.swift'].map(path=>new URL(path,import.meta.url)).filter(url=>existsSync(url));
 expect(paths.length).toBeGreaterThanOrEqual(1);for(const url of paths)expect(readFileSync(url,'utf8')).not.toMatch(/\bAREAS\b|static let areas|"(Job|Larkspur|Systems)"/);});

it('registers only loops.get, which still reads an old to-do with its owner, and no tools',async()=>{
 const handlers:Record<string,(x:any)=>unknown>={};const registerTool=vi.fn();const registerMentionProvider=vi.fn();
 const bb={realtime:{publish:vi.fn()},log:{warn:vi.fn()},onDispose:vi.fn(),agents:{registerTool},ui:{registerMentionProvider},rpc:{register:(_c:unknown,h:typeof handlers)=>Object.assign(handlers,h)},sdk:{threads:{get:async()=>({title:'Plumbing'})}}};
 registerLoops(bb as never,db);
 expect(Object.keys(handlers)).toEqual(['loops.get']);
 const old=seedTodo(db,{title:'Call the plumber',status:'surfaced',owner:'thread:thr_p'});
 const got=rpcContract['loops.get'].output.parse(await handlers['loops.get']!({id:old.id}));
 expect(got.loop.title).toBe('Call the plumber');
 expect(got.owner).toEqual({owner:'thread:thr_p',name:'Plumbing',threadId:'thr_p'});
 expect(registerTool).not.toHaveBeenCalled();expect(registerMentionProvider).not.toHaveBeenCalled();
});
