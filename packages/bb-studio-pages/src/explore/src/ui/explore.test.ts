import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appPath } = vi.hoisted(() => ({ appPath: vi.fn() }));
vi.mock("@bb-studio/kit/app", () => ({ openAppPath: appPath }));
import { explainerPath, openExplainer, openExplainerPage } from "./explore";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("explainer navigation", () => {
  const explainer = { id: "expl_42", label: "How the queue retries" };
  const navigation = (result = true) => ({ openThreadPanel: vi.fn(() => result) }) as unknown as BbNavigate;

  it("opens in its thread's panel", () => {
    const navigate = navigation();
    expect(openExplainer(navigate, explainer)).toBe(true);
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: "explainer", title: explainer.label, params: { explainerId: explainer.id } });
    expect(appPath).not.toHaveBeenCalled();
  });

  it("opens its main route without a thread panel", () => {
    openExplainer(navigation(false), explainer);
    expect(appPath).toHaveBeenCalledWith(explainerPath(explainer.id));
  });

  it("opens Pages in the main view, even from an Explore panel", () => {
    openExplainerPage("pg_42");
    expect(appPath).toHaveBeenCalledWith("/plugins/pages/pages/pg_42");
  });
});
