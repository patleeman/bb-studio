import { expect, it } from "vitest";
import { studioServices } from "./studio-services";

it("validates service records with the public item reference constraints", async () => {
  const services = studioServices({ plugins: { async callRpc({ outputSchema }) {
    return outputSchema.parse({ outgoing: [{ from: { pluginId: "", id: "item" }, to: { pluginId: "pages", id: "other" }, source: "pages", kind: "mention" }], backlinks: [] });
  } } });
  await expect(services.links({ pluginId: "pages", id: "item" })).rejects.toThrow();
});
