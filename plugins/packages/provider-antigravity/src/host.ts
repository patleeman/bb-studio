import { experimental_defineProviderBridge } from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_acpProviderBridge,
  experimental_registerAcpDialect,
} from "@get-bb/plugin-sdk/provider-bridge/acp";
import { z } from "zod";
import { ANTIGRAVITY_ACP_DIALECT } from "./dialect.js";
import {
  getAntigravityInstallationRun,
  getAntigravityInstallationStatus,
} from "./maintenance.js";

experimental_registerAcpDialect(ANTIGRAVITY_ACP_DIALECT);

const installationStatusRequestSchema = z.object({
  id: z.union([z.number(), z.string()]),
  method: z.literal("provider/installation/status"),
  params: z
    .object({
      checkUpdates: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
});

const installationRunRequestSchema = z.object({
  id: z.union([z.number(), z.string()]),
  method: z.literal("provider/installation/run"),
  params: z
    .object({
      action: z.enum(["install", "update"]),
    })
    .passthrough(),
});

function writeJsonRpc(
  write: (line: string) => void,
  payload: Record<string, unknown>,
): void {
  write(`${JSON.stringify(payload)}\n`);
}

export function createAntigravityBridgeLineHandler(deps: {
  fallback: (line: string) => void;
  write?: (line: string) => void;
  getStatus?: typeof getAntigravityInstallationStatus;
  getRun?: typeof getAntigravityInstallationRun;
}): (line: string) => void {
  const write =
    deps.write ?? ((line: string) => process.stdout.write(line));
  const getStatus = deps.getStatus ?? getAntigravityInstallationStatus;
  const getRun = deps.getRun ?? getAntigravityInstallationRun;

  return (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      deps.fallback(line);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      deps.fallback(line);
      return;
    }

    const statusReq = installationStatusRequestSchema.safeParse(parsed);
    if (statusReq.success) {
      const checkUpdates = statusReq.data.params?.checkUpdates ?? true;
      void getStatus(checkUpdates)
        .then((result) => {
          writeJsonRpc(write, {
            jsonrpc: "2.0",
            id: statusReq.data.id,
            result,
          });
        })
        .catch((error: unknown) => {
          writeJsonRpc(write, {
            jsonrpc: "2.0",
            id: statusReq.data.id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        });
      return;
    }

    const runReq = installationRunRequestSchema.safeParse(parsed);
    if (runReq.success) {
      void getRun(runReq.data.params.action)
        .then((result) => {
          writeJsonRpc(write, {
            jsonrpc: "2.0",
            id: runReq.data.id,
            result,
          });
        })
        .catch((error: unknown) => {
          writeJsonRpc(write, {
            jsonrpc: "2.0",
            id: runReq.data.id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        });
      return;
    }

    deps.fallback(line);
  };
}

const acpBridge = experimental_acpProviderBridge;

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine: createAntigravityBridgeLineHandler({
    fallback: (line) => acpBridge.handleLine(line),
  }),
  onClose: () => acpBridge.onClose?.(),
  onSigterm: () => acpBridge.onSigterm?.(),
  onSigint: () => acpBridge.onSigint?.(),
});
