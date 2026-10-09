// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { SpaceNewMenu } from "./SpaceStudioList.js";

const rpc = vi.hoisted(() => ({ answer: (): unknown => ({ ok: true }), calls: [] as { method: string; input: unknown }[] }));
vi.mock("@get-bb/plugin-sdk/app", async (actual) => ({
  ...(await actual<object>()),
  useSdk: () => ({ plugins: { callRpc: ({ method, input }: { method: string; input: unknown }) => {
    rpc.calls.push({ method, input });
    return Promise.resolve(rpc.answer());
  } } }),
}));

installTestPluginRuntime();
afterEach(cleanup);

describe("SpaceNewMenu", () => {
  it("offers Retry when Studio's overview answer is malformed, instead of loading forever", async () => {
    rpc.answer = () => ({ ok: true });
    render(<SpaceNewMenu spaceId="sp_work" spaceName="Work" defaultProjectId={null} onNewThread={() => {}} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "New in Work" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Loading…" })).toBeNull();
  });
});
