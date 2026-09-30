import test from "node:test";
import assert from "node:assert/strict";
import type { PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import type { ThreadStatusView } from "../contract";
import { channelStatusPresentation } from "../channel-status";

const thread = (indicator: ThreadStatusView["indicator"], threadId = "thr_1"):
  ThreadStatusView => ({ threadId, status: "idle", indicator });
const present = (options: Partial<Parameters<typeof channelStatusPresentation>[0]> = {}) =>
  channelStatusPresentation({
    threads: [], work: undefined, active: false, unread: false,
    draft: false, needsAttention: false, rowStatuses: new Map(), ...options,
  });

test("channels distinguish queued work, background work, and local drafts", () => {
  assert.equal(present({ work: { queued: 1, running: 0 }, active: true }).shortLabel,
    "Queued");
  assert.equal(present({ threads: [thread("background-agent")],
    work: { queued: 0, running: 1 }, active: true }).shortLabel, "Agent running");
  assert.equal(present({ threads: [thread("runtime")],
    work: { queued: 0, running: 1 }, active: true }).label, "Channel working");
  assert.equal(present({ threads: [thread("background-agent"),
    thread("background-agent", "thr_2")] }).label, "2 × Background agent running");
  assert.equal(present({ threads: [thread("background-command")], draft: true })
    .shortLabel, "Command running · Draft");
  assert.equal(present({ draft: true }).shortLabel, "Draft");
  assert.equal(present({ unread: true }).shortLabel, "Unread");
});

test("channel attention wins over work and reports concurrent states", () => {
  const status = present({ needsAttention: true,
    threads: [thread("background-agent"), thread("queued-failed", "thr_2")],
    work: { queued: 1, running: 1 }, active: true });
  assert.equal(status.shortLabel, "Needs you");
  assert.match(status.label, /Background agent running/);
  assert.match(status.label, /failed to send/);
  assert.match(status.label, /queued/);
});

test("plugin thread row statuses such as edit pending reach the channel", () => {
  const edit: PluginSidebarThreadRowStatus = {
    icon: "Edit", label: "Edit pending", tone: "running",
  };
  const status = present({ threads: [thread("none")],
    rowStatuses: new Map([["thr_1", edit]]) });
  assert.equal(status.shortLabel, "Edit pending");
  assert.equal(status.icon, "Edit");
  assert.equal(status.tone, "working");
});

test("unused pending bot threads do not appear as channel drafts", () => {
  assert.equal(present({ threads: [thread("draft")] }).shortLabel, "Ready");
  assert.equal(present({ threads: [thread("unread-success")] }).shortLabel, "Ready");
});
