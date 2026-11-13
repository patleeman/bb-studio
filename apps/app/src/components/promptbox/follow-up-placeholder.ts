import { COMPACT_FIRST_MESSAGE_PLACEHOLDER, FIRST_MESSAGE_PLACEHOLDER } from "./follow-up-placeholder.fork";
import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import { assertNever } from "@bb/core-ui";

export function getFollowUpPromptPlaceholder(
  displayStatus: ThreadRuntimeDisplayStatus,
): string {
  switch (displayStatus) {
    case "provisioning":
      return "Setting up workspace...";
    case "starting":
      return "Starting thread...";
    case "stopping":
      return "Queue a message to run after the stop";
    case "waiting-for-host":
      return "Queue a message for when the host reconnects";
    case "error":
      return "Retry by sending a follow-up message";
    case "pending":
      return FIRST_MESSAGE_PLACEHOLDER;
    case "idle":
    case "active":
      return "Ask for a follow-up. @ to mention files, folders, sections, or threads";
    default:
      return assertNever(displayStatus);
  }
}

export function getCompactFollowUpPromptPlaceholder(
  displayStatus: ThreadRuntimeDisplayStatus,
): string {
  switch (displayStatus) {
    case "provisioning":
      return "Setting up...";
    case "starting":
      return "Starting...";
    case "stopping":
      return "Queue for after the stop";
    case "waiting-for-host":
      return "Queue for when the host is back";
    case "error":
      return "Send a follow-up";
    case "pending":
      return COMPACT_FIRST_MESSAGE_PLACEHOLDER;
    case "idle":
    case "active":
      return "Ask a follow-up";
    default:
      return assertNever(displayStatus);
  }
}
