import { z } from 'zod';
import { defineRpcContract } from '@get-bb/plugin-sdk';
// An event trigger's `label` says it in words ("when Unraid fixes the PHP CVE"); without one the UI prettifies the event key.
export const trigger = z.object({ type: z.enum(['none','time','event','place']), at: z.number().optional(), event: z.string().optional(), place: z.string().optional(), direction: z.enum(['arrive','leave']).optional(), label: z.string().trim().max(120).optional() });
export const loop = z.object({ id: z.string(), title: z.string().trim().min(1).max(500), why: z.string(), source: z.object({kind:z.string(),ref:z.string(),url:z.string().optional()}).nullable(), kind:z.enum(['do','decide','read','waiting']), options:z.array(z.string()), owner:z.string().regex(/^(patrick|cos|thread:.+)$/), trigger, priority:z.enum(['urgent','normal','low']), push:z.boolean(), status:z.enum(['queued','surfaced','snoozed','in_progress','done','dropped']), due:z.number().nullable(), area:z.string().nullable(), createdAt:z.number(), updatedAt:z.number(), closedAt:z.number().nullable(), closedBy:z.string().nullable() });
export type Loop = z.infer<typeof loop>;
// Why a due todo of the user's still waits: the daily budget is spent, or it's low priority and waits for the morning card.
export const hold = z.object({id:z.string(),reason:z.enum(['budget','morning'])});
// A thread owner by name: the thread's title, with threadId null when the thread is gone.
export const ownerInfo = z.object({owner:z.string(),name:z.string(),threadId:z.string().nullable()});
export const rpcContract = defineRpcContract({
 'loops.get':{input:z.object({id:z.string()}),output:z.object({loop:loop,history:z.array(z.object({type:z.string(),at:z.number(),data:z.string()})),owner:ownerInfo.optional()})},
});
