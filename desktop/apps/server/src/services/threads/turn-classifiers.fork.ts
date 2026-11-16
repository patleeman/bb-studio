import type {
  ExperimentalCompletedTurn,
  ExperimentalTurnClassification,
  ExperimentalTurnClassifier,
  ForkPluginHooks,
} from "@get-bb/plugin-sdk";
import { requestPluginApproval } from "../fork-approvals/index.js";
import { registerSkillsRegistryPolicy } from "../skills/registry-policy.fork.js";
import { registerBeforeThreadDelete } from "./thread-delete-hooks.fork.js";
import { registerTurnContextProvider } from "./turn-context.fork.js";
import { readThreadForkPoint } from "./thread-fork-point.fork.js";
import type { DbConnection } from "@bb/db";

const classifiers = new Map<string, ExperimentalTurnClassifier>();

export function classifyTurn(
  turn: ExperimentalCompletedTurn,
): Required<ExperimentalTurnClassification> {
  let quiet = false;
  for (const classify of classifiers.values()) {
    try {
      if (classify(turn)?.quiet === true) quiet = true;
    } catch {
      continue;
    }
  }
  return { quiet };
}

export function registerTurnClassifier(
  pluginId: string,
  classifier: ExperimentalTurnClassifier,
): () => void {
  classifiers.set(pluginId, classifier);
  return () => {
    if (classifiers.get(pluginId) === classifier) classifiers.delete(pluginId);
  };
}

export function forkPluginHooks(args: {
  pluginId: string;
  assertLive: () => void;
  disposeHooks: Array<() => void | Promise<void>>;
  db: DbConnection;
}): ForkPluginHooks {
  return {
    experimental_classifyTurns(classifier) {
      args.assertLive();
      if (typeof classifier !== "function") {
        throw new Error("experimental_classifyTurns expects a function");
      }
      args.disposeHooks.push(registerTurnClassifier(args.pluginId, classifier));
    },
    experimental_requestApproval(request) {
      args.assertLive();
      return requestPluginApproval(args.pluginId, request);
    },
    experimental_beforeThreadDelete(handler) {
      args.assertLive();
      if (typeof handler !== "function") {
        throw new Error("experimental_beforeThreadDelete expects a function");
      }
      args.disposeHooks.push(
        registerBeforeThreadDelete(args.pluginId, handler),
      );
    },
    experimental_threadForkPoint(threadId) {
      args.assertLive();
      if (typeof threadId !== "string" || threadId === "") {
        return Promise.resolve(null);
      }
      return Promise.resolve(readThreadForkPoint(args.db, threadId));
    },
    experimental_skillsRegistryPolicy(policy) {
      args.assertLive();
      if (typeof policy !== "function") {
        throw new Error("experimental_skillsRegistryPolicy expects a function");
      }
      args.disposeHooks.push(
        registerSkillsRegistryPolicy(args.pluginId, policy, args.db),
      );
    },
    experimental_turnContext(provider) {
      args.assertLive();
      if (typeof provider !== "function") {
        throw new Error("experimental_turnContext expects a function");
      }
      args.disposeHooks.push(
        registerTurnContextProvider(args.pluginId, provider),
      );
    },
  };
}
