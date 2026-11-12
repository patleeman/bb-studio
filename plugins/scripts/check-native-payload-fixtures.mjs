import { readFile } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
const root = new URL("../", import.meta.url);
const fixtures = JSON.parse(await readFile(new URL("../ios/Tests/Fixtures/native-payloads.json", root), "utf8"));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
for (const fixture of fixtures) {
  const contract = JSON.parse(await readFile(new URL(`contracts/${fixture.plugin}.schema.json`, root), "utf8"));
  if (fixture.event) {
    const schema = contract.events?.[fixture.event];
    if (!schema) throw new Error(`${fixture.id}: ${fixture.plugin} has no event ${fixture.event}`);
    const validate = ajv.compile(schema);
    if (!validate(fixture.payload)) throw new Error(`${fixture.id} payload: ${ajv.errorsText(validate.errors)}`);
    continue;
  }
  for (const side of ["input", "output"]) {
    const validate = ajv.compile(contract.methods[fixture.method][side]);
    if (!validate(fixture[side])) throw new Error(`${fixture.id} ${side}: ${ajv.errorsText(validate.errors)}`);
  }
}
console.log(`Validated ${fixtures.length} native request/response and event fixtures against generated plugin schemas.`);
