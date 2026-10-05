import { rpcContract as botContract } from "./contract";
import { commandContract } from "./command-contract";

export const rpcContract = { ...botContract, ...commandContract };
