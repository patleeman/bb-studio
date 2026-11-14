import Foundation

// MARK: JSON that keeps key order

/// JSON with object keys in the server's order. Swift dictionaries lose it, and a
/// table's columns and a chart's default axis come from the order of a row's keys.
public indirect enum OrderedJSON: Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([OrderedJSON])
    case object([Field])

    public struct Field: Hashable, Sendable {
        public var key: String
        public var value: OrderedJSON
        public init(_ key: String, _ value: OrderedJSON) {
            self.key = key
            self.value = value
        }
    }

    public subscript(key: String) -> OrderedJSON? {
        if case .object(let fields) = self { return fields.first { $0.key == key }?.value }
        return nil
    }

    public var fields: [Field]? {
        if case .object(let fields) = self { return fields }
        return nil
    }

    public var array: [OrderedJSON]? {
        if case .array(let items) = self { return items }
        return nil
    }

    public var string: String? {
        if case .string(let text) = self { return text }
        return nil
    }

    public var bool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    public var isNull: Bool { self == .null }

    /// A JSON object, not an array: what the web calls a row.
    public var isRow: Bool { fields != nil }

    /// A finite number, or a string that reads as one (the web's `num`).
    public var number: Double? {
        switch self {
        case .number(let value) where value.isFinite: return value
        case .string(let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, let value = Double(trimmed), value.isFinite else { return nil }
            return value
        default: return nil
        }
    }

    /// Strings, numbers and booleans as text; anything else is "" (the web's `str`).
    public var text: String {
        switch self {
        case .string(let text): text
        case .number(let value): OrderedJSON.jsNumber(value)
        case .bool(let value): value ? "true" : "false"
        default: ""
        }
    }

    /// A number as JavaScript's `String(n)` writes it: `4`, `4.5`, `-0.25`.
    public static func jsNumber(_ value: Double) -> String {
        guard value.isFinite else { return value.isNaN ? "NaN" : value > 0 ? "Infinity" : "-Infinity" }
        if value == value.rounded(), abs(value) < 1e15 { return String(Int64(value)) }
        return String(value)
    }

    /// Compact JSON text, keys in order. Also a valid JavaScript literal.
    public var jsonText: String {
        var out = ""
        write(to: &out)
        return out
    }

    private func write(to out: inout String) {
        switch self {
        case .null: out += "null"
        case .bool(let value): out += value ? "true" : "false"
        case .number(let value): out += value.isFinite ? OrderedJSON.jsNumber(value) : "null"
        case .string(let text): OrderedJSON.quote(text, into: &out)
        case .array(let items):
            out += "["
            for (index, item) in items.enumerated() {
                if index > 0 { out += "," }
                item.write(to: &out)
            }
            out += "]"
        case .object(let fields):
            out += "{"
            for (index, field) in fields.enumerated() {
                if index > 0 { out += "," }
                OrderedJSON.quote(field.key, into: &out)
                out += ":"
                field.value.write(to: &out)
            }
            out += "}"
        }
    }

    private static func quote(_ text: String, into out: inout String) {
        out += "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            // Line and paragraph separators end a JavaScript string literal in older engines.
            case "\u{2028}", "\u{2029}", "<":
                out += String(format: "\\u%04x", scalar.value)
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
            }
        }
        out += "\""
    }

    /// Parses JSON text, keeping each object's keys in order.
    public static func parse(_ data: Data) throws -> OrderedJSON {
        var parser = Parser(bytes: [UInt8](data))
        parser.skipSpace()
        let value = try parser.value(depth: 0)
        parser.skipSpace()
        guard parser.index == parser.bytes.count else { throw ParseError(message: "Trailing characters in JSON") }
        return value
    }

    public struct ParseError: Error, CustomStringConvertible {
        public var message: String
        public var description: String { message }
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0

        mutating func skipSpace() {
            while index < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[index]) { index += 1 }
        }

        func fail(_ what: String) -> ParseError { ParseError(message: "\(what) at byte \(index)") }

        mutating func value(depth: Int) throws -> OrderedJSON {
            guard depth < 512 else { throw fail("JSON nested too deeply") }
            guard index < bytes.count else { throw fail("Unexpected end of JSON") }
            switch bytes[index] {
            case UInt8(ascii: "{"):
                index += 1
                var fields: [Field] = []
                skipSpace()
                if index < bytes.count, bytes[index] == UInt8(ascii: "}") { index += 1; return .object(fields) }
                while true {
                    skipSpace()
                    guard index < bytes.count, bytes[index] == UInt8(ascii: "\"") else { throw fail("Expected a key") }
                    let key = try string()
                    skipSpace()
                    guard index < bytes.count, bytes[index] == UInt8(ascii: ":") else { throw fail("Expected :") }
                    index += 1
                    skipSpace()
                    let item = try value(depth: depth + 1)
                    // A repeated key keeps its first place and its last value, as JSON.parse does.
                    if let existing = fields.firstIndex(where: { $0.key == key }) { fields[existing].value = item } else { fields.append(Field(key, item)) }
                    skipSpace()
                    guard index < bytes.count else { throw fail("Unexpected end of object") }
                    if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                    if bytes[index] == UInt8(ascii: "}") { index += 1; return .object(fields) }
                    throw fail("Expected , or }")
                }
            case UInt8(ascii: "["):
                index += 1
                var items: [OrderedJSON] = []
                skipSpace()
                if index < bytes.count, bytes[index] == UInt8(ascii: "]") { index += 1; return .array(items) }
                while true {
                    skipSpace()
                    items.append(try value(depth: depth + 1))
                    skipSpace()
                    guard index < bytes.count else { throw fail("Unexpected end of array") }
                    if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                    if bytes[index] == UInt8(ascii: "]") { index += 1; return .array(items) }
                    throw fail("Expected , or ]")
                }
            case UInt8(ascii: "\""):
                return .string(try string())
            case UInt8(ascii: "t"): try literal("true"); return .bool(true)
            case UInt8(ascii: "f"): try literal("false"); return .bool(false)
            case UInt8(ascii: "n"): try literal("null"); return .null
            default:
                let start = index
                while index < bytes.count, "+-0123456789.eE".utf8.contains(bytes[index]) { index += 1 }
                guard index > start, let text = String(bytes: bytes[start..<index], encoding: .ascii), let number = Double(text) else {
                    throw fail("Unexpected character")
                }
                return .number(number)
            }
        }

        mutating func literal(_ word: String) throws {
            let utf8 = Array(word.utf8)
            guard index + utf8.count <= bytes.count, Array(bytes[index..<index + utf8.count]) == utf8 else { throw fail("Unexpected word") }
            index += utf8.count
        }

        mutating func hex4() throws -> UInt32 {
            guard index + 4 <= bytes.count, let text = String(bytes: bytes[index..<index + 4], encoding: .ascii),
                let value = UInt32(text, radix: 16) else { throw fail("Bad \\u escape") }
            index += 4
            return value
        }

        mutating func string() throws -> String {
            index += 1  // the opening quote
            var out: [UInt8] = []
            while index < bytes.count {
                let byte = bytes[index]
                index += 1
                switch byte {
                case UInt8(ascii: "\""):
                    return String(decoding: out, as: UTF8.self)
                case UInt8(ascii: "\\"):
                    guard index < bytes.count else { throw fail("Unexpected end of string") }
                    let escape = bytes[index]
                    index += 1
                    switch escape {
                    case UInt8(ascii: "\""), UInt8(ascii: "\\"), UInt8(ascii: "/"): out.append(escape)
                    case UInt8(ascii: "b"): out.append(0x08)
                    case UInt8(ascii: "f"): out.append(0x0C)
                    case UInt8(ascii: "n"): out.append(0x0A)
                    case UInt8(ascii: "r"): out.append(0x0D)
                    case UInt8(ascii: "t"): out.append(0x09)
                    case UInt8(ascii: "u"):
                        var code = try hex4()
                        if (0xD800..<0xDC00).contains(code), index + 6 <= bytes.count, bytes[index] == UInt8(ascii: "\\"), bytes[index + 1] == UInt8(ascii: "u") {
                            let save = index
                            index += 2
                            let low = try hex4()
                            if (0xDC00..<0xE000).contains(low) { code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00) } else { index = save }
                        }
                        out.append(contentsOf: Array(String(Unicode.Scalar(code).map(Character.init) ?? "\u{FFFD}").utf8))
                    default: throw fail("Bad escape")
                    }
                default:
                    out.append(byte)
                }
            }
            throw fail("Unterminated string")
        }
    }
}

// MARK: RPC

/// A result read from order-keeping JSON.
public protocol OrderedRPCResult {
    init(orderedJSON: OrderedJSON) throws
}

extension OrderedJSON: OrderedRPCResult {
    public init(orderedJSON: OrderedJSON) { self = orderedJSON }
}

extension BBClient {
    /// An RPC result with object keys in the server's order. The Decodable `rpc`
    /// goes through dictionaries, which lose it.
    public func rpc<Result: OrderedRPCResult>(_ pluginId: String, _ method: String, _ input: JSONValue = .null) async throws -> Result {
        let data = try await rpcData(pluginId, method, input)
        let envelope = try OrderedJSON.parse(data)
        guard let result = envelope["result"] else {
            throw BBError(status: 200, message: "Missing result for \(pluginId).\(method)")
        }
        return try Result(orderedJSON: result)
    }
}
