import { z } from 'zod';
import { defineRpcContract } from '@get-bb/plugin-sdk';
// An event trigger's `label` says it in words ("when Unraid fixes the PHP CVE"); without one the UI prettifies the event key.
export const trigger = z.object({ type: z.enum(['none','time','event','place']), at: z.number().optional(), event: z.string().optional(), place: z.string().optional(), direction: z.enum(['arrive','leave']).optional(), label: z.string().trim().max(120).optional() });
export const loop = z.object({ id: z.string(), title: z.string().trim().min(1).max(500), why: z.string(), source: z.object({kind:z.string(),ref:z.string(),url:z.string().optional()}).nullable(), kind:z.enum(['do','decide','read','waiting']), options:z.array(z.string()), owner:z.string().regex(/^(patrick|cos|thread:.+)$/), trigger, priority:z.enum(['urgent','normal','low']), push:z.boolean(), status:z.enum(['queued','surfaced','snoozed','in_progress','done','dropped']), due:z.number().nullable(), area:z.string().nullable(), createdAt:z.number(), updatedAt:z.number(), closedAt:z.number().nullable(), closedBy:z.string().nullable() });
export type Loop = z.infer<typeof loop>;
export const add = loop.omit({id:true,createdAt:true,updatedAt:true,closedAt:true,closedBy:true}).partial().extend({title:loop.shape.title});
export const act = z.object({ id:z.string(), action:z.enum(['done','drop','got_it','choose','snooze','hand_off','nudge','keep']), option:z.string().optional(), owner:loop.shape.owner.optional(), snooze:z.enum(['later_today','tonight','tomorrow_morning','this_weekend','home','mac']).optional() });
export const update = z.object({id:z.string(), changes:add.partial().optional(), surfaceNow:z.boolean().optional()});
export const filters = z.object({area:z.string().optional(),owner:z.string().optional()});
// Saved place names from the phone, names only (never coordinates). iOS watches at most 20 regions.
export const places = z.object({names:z.array(z.string().trim().min(1).max(60)).max(20)});
// Why a due todo of Patrick's still waits: the daily budget is spent, or it's low priority and waits for the morning card.
export const hold = z.object({id:z.string(),reason:z.enum(['budget','morning'])});
// A thread owner by name: the thread's title, with threadId null when the thread is gone.
export const ownerInfo = z.object({owner:z.string(),name:z.string(),threadId:z.string().nullable()});
export const groups = z.object({needsYouNow:z.array(loop),comingUp:z.array(loop),agentsOnIt:z.array(loop),waitingOnOthers:z.array(loop),done:z.array(loop),held:z.array(hold).optional(),owners:z.array(ownerInfo).optional(),areas:z.array(z.string()).optional()});
export const rpcContract = defineRpcContract({
 'loops.list':{input:filters,output:groups}, 'loops.get':{input:z.object({id:z.string()}),output:z.object({loop:loop,history:z.array(z.object({type:z.string(),at:z.number(),data:z.string()})),owner:ownerInfo.optional()})},
 'loops.add':{input:z.object({text:z.string().trim().min(1).max(500)}),output:loop}, 'loops.update':{input:update,output:loop}, 'loops.act':{input:act,output:loop},
 'loops.fire':{input:z.object({event:z.string().min(1)}),output:z.object({matched:z.number()})},
 'loops.place':{input:z.object({place:z.string().min(1),direction:z.enum(['arrive','leave'])}),output:z.object({matched:z.number()})},
 'loops.setPlaces':{input:places,output:places}, 'loops.places':{input:z.object({}),output:places},
 'loops.morning':{input:z.object({}),output:z.object({date:z.string(),items:z.array(loop),more:z.number(),lowPriority:z.array(loop)})},
});
