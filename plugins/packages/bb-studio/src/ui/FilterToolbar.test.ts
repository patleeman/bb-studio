import { expect, it } from "vitest";
import { formatQuery, parseQuery, type QueryVocabulary } from "../query";
import { kindChoices, withoutStrayAppTypes } from "./FilterToolbar";

const vocabulary: QueryVocabulary = {
  kinds: [
    { id: "page", label: "Page", plural: "Pages" }, { id: "artifact", label: "Artifact", plural: "Artifacts" },
    { id: "design", label: "Design", plural: "Designs" }, { id: "mini", label: "App", plural: "Apps" },
  ],
  projects: [],
  tags: [],
};

it("offers artifacts and mini apps as one Apps kind choice, which filters by family", () => {
  expect(kindChoices(vocabulary).map((each) => [each.field, each.value, each.label])).toEqual([
    ["kind", "page", "Pages"], ["family", "app", "Apps"], ["kind", "design", "Designs"],
  ]);
});

it("drops the Interactive and Saved sub-filter when Apps is unchosen, and only then", () => {
  const apps = parseQuery("family:app type:mini");
  expect(formatQuery(withoutStrayAppTypes(apps, parseQuery("type:mini"), vocabulary))).toBe("");
  expect(formatQuery(withoutStrayAppTypes(apps, parseQuery("family:app type:mini kind:page"), vocabulary))).toBe("family:app type:mini kind:page");
  expect(formatQuery(withoutStrayAppTypes(parseQuery("type:mini"), parseQuery("type:mini kind:page"), vocabulary))).toBe("type:mini kind:page");
});
