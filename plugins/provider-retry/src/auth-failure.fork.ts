import type { PluginTurnFailedEvent } from "@get-bb/plugin-sdk";

const AUTH_HTTP_STATUS_CODES = new Set([401]);

export function isAuthFailure(failure: PluginTurnFailedEvent): boolean {
  const errorInfo = failure.errorInfo;
  if (errorInfo === null) return false;
  return (
    errorInfo.category === "unauthorized" ||
    (errorInfo.httpStatusCode !== null &&
      AUTH_HTTP_STATUS_CODES.has(errorInfo.httpStatusCode))
  );
}
