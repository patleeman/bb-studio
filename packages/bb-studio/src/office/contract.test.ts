import { describe, expect, it } from "vitest";
import { officeContract, spaceSettingsSchema } from "./contract";

describe("office RPC boundary", () => {
  it("rejects invalid trust and blank names before any mutation", () => {
    expect(officeContract.space_create.input.safeParse({ name: "  " }).success).toBe(false);
    expect(officeContract.space_settings_set.input.safeParse({ spaceId: "s", settings: { defaultTrust: "full" } }).success).toBe(false);
    expect(officeContract.folder_archive.input.safeParse({}).success).toBe(false);
  });
  it("allows explicit clearing of optional model and kind defaults", () => {
    expect(spaceSettingsSchema.parse({ enabledItemKinds: null, defaultTrust: "ask", defaultBotModel: null })).toEqual({ enabledItemKinds: null, defaultTrust: "ask", defaultBotModel: null, todayArchiveAfter: "3d" });
    expect(officeContract.space_settings_set.input.parse({ spaceId: "s", settings: { enabledItemKinds: [] } }).settings).toEqual({ enabledItemKinds: [] });
  });
});
