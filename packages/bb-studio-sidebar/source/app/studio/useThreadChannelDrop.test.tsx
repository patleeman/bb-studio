// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelDropThreads, useThreadChannelDrop } from "./useThreadChannelDrop.js";
import { makeSidebarThread } from "../testing/fixtures.js";
const state = vi.hoisted(() => ({ sdk: { plugins: { callRpc: vi.fn() } }, open: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => state.sdk, experimental_Icon: () => null }));
vi.mock("@bb-studio/kit/app", () => ({ openAppPath: state.open }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const a = makeSidebarThread({ id: "a", title: "Release plan" }), b = makeSidebarThread({ id: "b", title: "API review" });
function Fixture({ nest = vi.fn() }: { nest?: () => Promise<unknown> }) {
  const drop = useThreadChannelDrop();
  return <><button onClick={() => drop.offer([a, b], nest)}>Drop threads</button>{drop.dialog}</>;
}
describe("drag threads together", () => {
  it("deduplicates sources and allows related ordinary threads without accepting self drops or oversized groups", () => {
    expect(channelDropThreads([a, a], b).map(thread => thread.id)).toEqual(["b", "a"]);
    expect(channelDropThreads([a], a)).toEqual([]);
    expect(channelDropThreads([], b)).toEqual([]);
    expect(channelDropThreads(Array.from({ length: 32 }, (_, i) => makeSidebarThread({ id: String(i) })), b)).toEqual([]);
  });
  it("creates a channel of references without moving either thread", async () => {
    const nest = vi.fn();
    state.sdk.plugins.callRpc.mockImplementation(async ({ method }) => method === "views" ? [] : { id: "new-channel" });
    render(<Fixture nest={nest} />);
    fireEvent.click(screen.getByText("Drop threads"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create channel" }).hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Release review" } });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    await waitFor(() => expect(state.open).toHaveBeenCalledWith("/plugins/bot-teams/channels/new-channel"));
    expect(state.sdk.plugins.callRpc.mock.calls[1]![0]).toMatchObject({ method: "viewCreate", input: { name: "Release review", members: [{ kind: "thread", id: "a" }, { kind: "thread", id: "b" }] } });
    expect(nest).not.toHaveBeenCalled();
  });
  it("keeps nesting available and allows cancel without any mutation", async () => {
    const nest = vi.fn().mockResolvedValue(undefined);
    state.sdk.plugins.callRpc.mockResolvedValue([]);
    render(<Fixture nest={nest} />);
    fireEvent.click(screen.getByText("Drop threads"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(nest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Drop threads"));
    await act(async () => fireEvent.click(screen.getByText("Nest threads")));
    expect(nest).toHaveBeenCalledOnce();
    expect(state.sdk.plugins.callRpc.mock.calls.every(([args]) => args.method === "views")).toBe(true);
  });
  it("keeps the dialog and request ID for retry after a failed channel creation", async () => {
    state.sdk.plugins.callRpc.mockImplementation(async ({ method }) => { if (method === "views") return []; throw new Error("Disconnected"); });
    render(<Fixture />);
    fireEvent.click(screen.getByText("Drop threads"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create channel" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    await screen.findByRole("alert");
    const requestId = state.sdk.plugins.callRpc.mock.calls[1]![0].input.requestId;
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    await waitFor(() => expect(state.sdk.plugins.callRpc).toHaveBeenCalledTimes(3));
    expect(state.sdk.plugins.callRpc.mock.calls[2]![0].input.requestId).toBe(requestId);
    expect(state.open).not.toHaveBeenCalled();
  });
});
