import { defineRpcContract } from "@get-bb/plugin-sdk";
import { rpcContract as studio } from "./contract";
import { rpcContract as chat } from "./chat/contract";
export const rpcContract = defineRpcContract({ ...studio, ...chat });
