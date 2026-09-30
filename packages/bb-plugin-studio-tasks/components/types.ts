// The shapes the app gets from the server, and a typed RPC hook.
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server";

type Contract = typeof rpcContract;
export type Task = z.infer<Contract["board"]["output"]>["tasks"][number];
export type Link = z.infer<Contract["get"]["output"]>["links"][number];
export type Handoff = z.infer<Contract["get"]["output"]>["handoffs"][number];
export type Linkable = z.infer<Contract["linkables"]["output"]>["items"][number];

export const useTasksRpc = () => useRpc<Contract>();

/** Realtime payloads on the tasks channel. */
export type TaskEvent = { type?: string; taskId?: string } | null;

export const SPIN = "animate-spin motion-reduce:animate-none";
