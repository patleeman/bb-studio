import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { studioSchemas } from "../packages/bb-studio-kit/src/contract.ts";
import { nativeRpcInventory } from "./native-rpc-inventory.mjs";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
if (process.argv.some((arg) => arg.startsWith("--") && arg !== "--check")) {
  throw new Error("Usage: pnpm gen:contracts [--check]");
}

const plugins = [
  ["studio", "Studio", "../packages/bb-studio/src/contract.ts", "rpcContract"],
  ["bot-teams", "BotTeams", "../packages/bb-studio-teams/client-contract.ts", "rpcContract"],
  ["talk", "Talk", "../packages/bb-studio-talk/src/shared/contract.ts", "rpcContract"],
  ["pages", "Pages", "../packages/bb-studio-pages/src/contract.ts", "rpcContract"],
  ["studio-tasks", "Tasks", "../packages/bb-studio-tasks/server.ts", "rpcContract"],
  ["artifacts", "Artifacts", "../packages/bb-studio-artifacts/server.ts", "rpcContract"],
  ["excalidraw", "Draw", "../packages/bb-studio-draw/server.ts", "rpcContract"],
  ["studio-chat", "Chat", "../packages/bb-studio-chat/src/contract.ts", "rpcContract"],
  ["mobile", "Mobile", "../packages/bb-studio-mobile/server.ts", "mobileContract"],
  ["smart-decisions", "Decisions", "../packages/bb-studio-decisions/contract.ts", "rpcContract"],
  ["studio-tables", "Tables", "../packages/bb-studio-kit/src/tables/contract.ts", "tablesContract"],
  ["feed", "Feed", "../packages/bb-studio-feed/src/contract.ts", "rpcContract"],
];

const swiftKeywords = new Set("associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return switch throw try while as Any false is nil self Self super throws true where await async actor some".split(" "));
const pascal = (value) => String(value).replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, _sep, char) => char.toUpperCase()).replace(/[^A-Za-z0-9]/g, "") || "Value";
const identifier = (value) => {
  let name = String(value).replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(name)) name = `_${name}`;
  return swiftKeywords.has(name) ? `\`${name}\`` : name;
};
const quoted = (value) => JSON.stringify(value);

async function output(path, body) {
  const file = resolve(root, path);
  if (check) {
    let old;
    try { old = await readFile(file, "utf8"); } catch { old = null; }
    if (old !== body) throw new Error(`${path} is stale. Run pnpm gen:contracts.`);
  } else {
    await mkdir(resolve(file, ".."), { recursive: true });
    await writeFile(file, body);
  }
}

function schemaOf(value, io) {
  return z.toJSONSchema(value, { io, unrepresentable: "any" });
}

function swiftSource(namespace, methods, itemSchema) {
  const declarations = [];
  const usedNames = new Set();
  function unique(name) {
    let result = pascal(name);
    for (let n = 2; usedNames.has(result); n++) result = `${pascal(name)}${n}`;
    usedNames.add(result);
    return result;
  }
  function resolveRef(schema, rootSchema) {
    while (schema?.$ref) {
      if (!schema.$ref.startsWith("#/$defs/")) throw new Error(`Unsupported schema ref: ${schema.$ref}`);
      schema = rootSchema.$defs?.[schema.$ref.slice(8)];
      if (!schema) throw new Error("Missing schema definition");
    }
    return schema ?? {};
  }
  function typeFor(raw, name, rootSchema) {
    const schema = resolveRef(raw, rootSchema);
    const variants = schema.anyOf ?? schema.oneOf;
    if (variants) {
      const nonNull = variants.filter((part) => resolveRef(part, rootSchema).type !== "null");
      if (nonNull.length === 1) return typeFor(nonNull[0], name, rootSchema);
      return "StudioJSONValue";
    }
    if (Array.isArray(schema.type)) {
      const nonNull = schema.type.filter((type) => type !== "null");
      if (nonNull.length === 1) return typeFor({ ...schema, type: nonNull[0] }, name, rootSchema);
      return "StudioJSONValue";
    }
    if (schema.enum?.every((value) => typeof value === "string") && schema.enum.length > 0) {
      const type = unique(name);
      const cases = schema.enum.map((value, index) => ({ value, name: identifier(value) === "_" ? `value${index}` : identifier(value) }));
      if (new Set(cases.map((entry) => entry.name)).size !== cases.length) return "String";
      declarations.push(`  public enum ${type}: Sendable, Hashable, Codable {\n${cases.map(({ name }) => `    case ${name}`).join("\n")}\n    case unknown(String)\n\n    public init(from decoder: Decoder) throws {\n      let value = try decoder.singleValueContainer().decode(String.self)\n      switch value {\n${cases.map(({ value, name }) => `      case ${quoted(value)}: self = .${name}`).join("\n")}\n      default: self = .unknown(value)\n      }\n    }\n\n    public func encode(to encoder: Encoder) throws {\n      var container = encoder.singleValueContainer()\n      switch self {\n${cases.map(({ value, name }) => `      case .${name}: try container.encode(${quoted(value)})`).join("\n")}\n      case .unknown(let value): try container.encode(value)\n      }\n    }\n  }`);
      return type;
    }
    if (typeof schema.const === "string") return "String";
    if (typeof schema.const === "boolean") return "Bool";
    if (typeof schema.const === "number") return "Double";
    if (schema.type === "string") return "String";
    if (schema.type === "integer") return "Int";
    if (schema.type === "number") return "Double";
    if (schema.type === "boolean") return "Bool";
    if (schema.type === "array") return `[${typeFor(schema.items ?? {}, `${name}Item`, rootSchema)}]`;
    if (schema.type === "object" || schema.properties) {
      if (!schema.properties) {
        const value = schema.additionalProperties && typeof schema.additionalProperties === "object"
          ? typeFor(schema.additionalProperties, `${name}Value`, rootSchema) : "StudioJSONValue";
        return `[String: ${value}]`;
      }
      const type = unique(name);
      const fields = Object.entries(schema.properties).map(([key, value]) => ({
        key, property: identifier(key), type: typeFor(value, `${type}${pascal(key)}`, rootSchema),
      }));
      if (new Set(fields.map((field) => field.property)).size !== fields.length) throw new Error(`Swift property collision in ${type}`);
      const access = fields.map(({ property, type: fieldType }) => `    public var ${property}: ${fieldType}?`).join("\n");
      const init = fields.length ? `\n\n    public init(${fields.map(({ property, type: fieldType }) => `${property}: ${fieldType}? = nil`).join(", ")}) {\n${fields.map(({ property }) => `      self.${property} = ${property}`).join("\n")}\n    }` : "\n\n    public init() {}";
      const coding = fields.some(({ key, property }) => key !== property.replaceAll("`", ""))
        ? `\n\n    enum CodingKeys: String, CodingKey {\n${fields.map(({ key, property }) => `      case ${property}${key === property.replaceAll("`", "") ? "" : ` = ${quoted(key)}`}`).join("\n")}\n    }` : "";
      declarations.push(`  public struct ${type}: Sendable, Hashable, Codable {\n${access}${init}${coding}\n  }`);
      return type;
    }
    return "StudioJSONValue";
  }
  const aliases = [];
  for (const [method, pair] of Object.entries(methods)) {
    const base = unique(method);
    for (const direction of ["input", "output"]) {
      const name = `${base}${pascal(direction)}`;
      const schema = pair[direction];
      if (schema.type === "null") { aliases.push(`  public typealias ${name} = StudioJSONValue`); continue; }
      const type = typeFor(schema, name, schema);
      if (type !== name) aliases.push(`  public typealias ${name} = ${type}`);
    }
    aliases.push(`  public typealias ${base} = ${base}Output`);
  }
  if (itemSchema) {
    const type = typeFor(itemSchema, "StudioItem", itemSchema);
    if (type !== "StudioItem") aliases.push(`  public typealias StudioItem = ${type}`);
  }
  const names = Object.keys(methods).map((method) => `    public static let ${identifier(method)} = ${quoted(method)}`).join("\n");
  return `// Generated by scripts/gen-contracts.mjs. Do not edit.\nimport Foundation\n\npublic enum ${namespace} {\n  public enum Method {\n${names}\n  }\n\n${[...aliases, ...declarations].join("\n\n")}\n}\n${namespace === "Studio" ? jsonValueSource : ""}`;
}

const jsonValueSource = `\n/// A JSON value used when a contract accepts arbitrary data or a union of shapes.\npublic indirect enum StudioJSONValue: Sendable, Hashable, Codable {\n  case null\n  case bool(Bool)\n  case number(Double)\n  case string(String)\n  case array([StudioJSONValue])\n  case object([String: StudioJSONValue])\n\n  public init(from decoder: Decoder) throws {\n    let value = try decoder.singleValueContainer()\n    if value.decodeNil() { self = .null }\n    else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }\n    else if let number = try? value.decode(Double.self) { self = .number(number) }\n    else if let string = try? value.decode(String.self) { self = .string(string) }\n    else if let array = try? value.decode([StudioJSONValue].self) { self = .array(array) }\n    else { self = .object(try value.decode([String: StudioJSONValue].self)) }\n  }\n\n  public func encode(to encoder: Encoder) throws {\n    var value = encoder.singleValueContainer()\n    switch self {\n    case .null: try value.encodeNil()\n    case .bool(let item): try value.encode(item)\n    case .number(let item): try value.encode(item)\n    case .string(let item): try value.encode(item)\n    case .array(let item): try value.encode(item)\n    case .object(let item): try value.encode(item)\n    }\n  }\n}\n`;

const item = schemaOf(studioSchemas(z).item, "output");
const documents = new Map();
for (const [pluginId, namespace, path, exportName] of plugins) {
  const mod = await import(new URL(path, import.meta.url));
  const contract = mod[exportName];
  if (!contract) throw new Error(`Missing ${exportName} in ${path}`);
  const methods = Object.fromEntries(Object.entries(contract).map(([name, value]) => [name, {
    input: schemaOf(value.input, "input"), output: schemaOf(value.output, "output"),
  }]));
  const document = { pluginId, methods, ...(pluginId === "studio" ? { StudioItem: item } : {}) };
  documents.set(pluginId, { namespace, ...document });
  await output(`contracts/${pluginId}.schema.json`, `${JSON.stringify(document, null, 2)}\n`);
  await output(`apps/ios/Shared/Generated/${namespace}Contract.swift`, swiftSource(namespace, document.methods, document.StudioItem));
  console.log(`${check ? "Checked" : "Generated"} ${pluginId}: ${Object.keys(document.methods).length} methods`);
}
const native = await nativeRpcInventory(root, documents);
await output("contracts/native-rpc-inventory.json", `${JSON.stringify(native, null, 2)}\n`);
console.log(`${check ? "Checked" : "Generated"} native RPC inventory: ${native.calls.length} call sites`);
