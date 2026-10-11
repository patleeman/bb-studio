import { defineRpcContract } from "@get-bb/plugin-sdk";
import { rpcContract as studio } from "./contract";
import { rpcContract as chat } from "./chat/contract";
import { rpcContract as artifacts } from "./artifacts/contract";
export const rpcContract = defineRpcContract({ ...studio, ...chat, ...artifacts });
