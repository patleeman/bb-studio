import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { companion, appPath } = vi.hoisted(() => ({ companion: vi.fn(), appPath: vi.fn() }));
vi.mock("@bb-studio/kit/app", () => ({ openCompanion: companion, openAppPath: appPath }));
import { explainerPath, openExplainer, openExplainerPage } from "./explore";

beforeEach(() => {
  vi.clearAllMocks();
  companion.mockReturnValue(false);
});

describe("explainer navigation", () => {
  const explainer = { id: "expl_42", label: "How the queue retries" };
  const navigation = (result = true) => ({ openThreadPanel: vi.fn(() => result) }) as unknown as BbNavigate;

  it("uses the same explainer destination before and after its page is ready", () => {
    companion.mockReturnValue(true);
    const navigate = navigation();
    openExplainer(navigate, explainer);
    openExplainer(navigate, { ...explainer });
    expect(companion.mock.calls).toEqual([
      [{ kind: "path", path: "/plugins/explore/explainers/expl_42", title: explainer.label }],
      [{ kind: "path", path: "/plugins/explore/explainers/expl_42", title: explainer.label }],
    ]);
    expect(navigate.openThreadPanel).not.toHaveBeenCalled();
    expect(appPath).not.toHaveBeenCalled();
  });

  it("keeps the existing thread panel when companions are unavailable", () => {
    const navigate = navigation();
    expect(openExplainer(navigate, explainer)).toBe(true);
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "explainer", title: explainer.label, params: { explainerId: explainer.id } });
    expect(appPath).not.toHaveBeenCalled();
  });

  it("opens its main route when neither companions nor a thread panel are available", () => {
    openExplainer(navigation(false), explainer);
    expect(appPath).toHaveBeenCalledWith(explainerPath(explainer.id), { main: true });
  });

  it("opens the Pages plugin through a companion rather than an Explore panel", () => {
    companion.mockReturnValue(true);
    openExplainerPage("pg_42");
    expect(companion).toHaveBeenCalledWith({ kind: "path", path: "/plugins/pages/pages/pg_42" });
    expect(appPath).not.toHaveBeenCalled();
  });

  it("opens Pages in main without companions, even from an old Explore panel", () => {
    openExplainerPage("pg_42");
    expect(appPath).toHaveBeenCalledWith("/plugins/pages/pages/pg_42", { main: true });
  });
});
