import Foundation

// Studio Dashboards: widgets on a grid, each with a data source the Studio
// server refreshes (`dashboards.*`). The phone shows them read-only in one
// column; editing, settings and script approval stay on the desktop in v1.
// Readers here mirror packages/bb-studio/src/dashboards/ui/widgets.tsx.

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

// MARK: Dashboards

public struct Dashboard: Hashable, Sendable {
    public struct LayoutItem: Hashable, Sendable {
        public var widgetId: String
        public var x: Int
        public var y: Int
        public var w: Int
        public var h: Int
    }

    public struct Widget: Hashable, Sendable, Identifiable {
        public var id: String
        /// stat, line, bar, area, pie, table, list, ticker, note, embed, clock, image, progress or custom.
        public var type: String
        public var title: String?
        public var options: OrderedJSON
        /// none, static, url, script or push.
        public var sourceKind: String
        public var customType: String?
        public var html: String?
        /// Script sources: whether the exact command is approved.
        public var scriptApproved: Bool?

        /// The tile's heading: its title, or a stat's label.
        public var heading: String? {
            if let title, !title.isEmpty { return title }
            if type == "stat", let label = options["label"]?.string, !label.isEmpty { return label }
            return nil
        }

        /// Whether the widget reads a data source at all.
        public var usesData: Bool { !["note", "embed", "clock", "image"].contains(type) }

        /// Whether Refresh can fetch it now.
        public var fetchable: Bool { sourceKind == "url" || (sourceKind == "script" && scriptApproved == true) }
    }

    public struct DataView: Hashable, Sendable {
        public var value: OrderedJSON
        /// Milliseconds since 1970.
        public var fetchedAt: Double?
        public var error: String?
        public var errorAt: Double?
        /// ok, error, pending, approval, static or none.
        public var status: String
    }

    public struct WidgetType: Hashable, Sendable {
        public var id: String
        public var name: String
        public var html: String
        public var defaultOptions: OrderedJSON
    }

    public var id: String
    public var name: String
    public var projectId: String?
    public var updatedAt: Double
    /// In the server's grid order (lg).
    public var widgets: [Widget]
    /// lg, md and sm.
    public var layouts: [String: [LayoutItem]]
    public var data: [String: DataView]
    public var widgetTypes: [WidgetType]

    public var displayName: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Untitled dashboard" : trimmed
    }

    /// Reads `dashboards.get`'s `dashboard`.
    public init?(_ json: OrderedJSON) {
        guard let id = json["id"]?.string else { return nil }
        self.id = id
        name = json["name"]?.string ?? ""
        projectId = json["projectId"]?.string
        updatedAt = json["updatedAt"]?.number ?? 0
        widgets = (json["widgets"]?.array ?? []).compactMap { item in
            guard let id = item["id"]?.string, let type = item["type"]?.string else { return nil }
            return Widget(
                id: id, type: type, title: item["title"]?.string,
                options: item["options"]?.isRow == true ? item["options"]! : .object([]),
                sourceKind: item["source"]?["kind"]?.string ?? "none",
                customType: item["customType"]?.string, html: item["html"]?.string,
                scriptApproved: item["script"]?["approved"]?.bool)
        }
        var layouts: [String: [LayoutItem]] = [:]
        for field in json["layouts"]?.fields ?? [] {
            layouts[field.key] = (field.value.array ?? []).compactMap { item in
                guard let id = item["i"]?.string else { return nil }
                return LayoutItem(
                    widgetId: id, x: Int(item["x"]?.number ?? 0), y: Int(item["y"]?.number ?? 0),
                    w: Int(item["w"]?.number ?? 1), h: Int(item["h"]?.number ?? 1))
            }
        }
        self.layouts = layouts
        var data: [String: DataView] = [:]
        for item in json["data"]?.array ?? [] {
            guard let widgetId = item["widgetId"]?.string else { continue }
            data[widgetId] = DataView(
                value: item["value"] ?? .null, fetchedAt: item["fetchedAt"]?.number, error: item["error"]?.string,
                errorAt: item["errorAt"]?.number, status: item["status"]?.string ?? "none")
        }
        self.data = data
        widgetTypes = (json["widgetTypes"]?.array ?? []).compactMap { item in
            guard let id = item["id"]?.string else { return nil }
            return WidgetType(
                id: id, name: item["name"]?.string ?? "", html: item["html"]?.string ?? "",
                defaultOptions: item["defaultOptions"]?.isRow == true ? item["defaultOptions"]! : .object([]))
        }
    }

    /// The breakpoints from the narrowest, which is the one meant for a phone.
    static let narrowestFirst = ["sm", "md", "lg"]

    /// The narrowest layout that places any widget.
    public var phoneLayout: [LayoutItem] {
        for name in Self.narrowestFirst { if let items = layouts[name], !items.isEmpty { return items } }
        return []
    }

    /// Widgets as one column: by the phone layout's rows, then columns. Widgets it
    /// doesn't place come last, in the server's order.
    public var stacked: [Widget] {
        let items = Dictionary(phoneLayout.map { ($0.widgetId, $0) }, uniquingKeysWith: { first, _ in first })
        return widgets.enumerated().sorted { a, b in
            switch (items[a.element.id], items[b.element.id]) {
            case let (left?, right?):
                if left.y != right.y { return left.y < right.y }
                if left.x != right.x { return left.x < right.x }
                return a.offset < b.offset
            case (.some, nil): return true
            case (nil, .some): return false
            case (nil, nil): return a.offset < b.offset
            }
        }.map(\.element)
    }

    /// A widget's height on the desktop grid, in points: 36-pt rows with 12-pt gaps, less its header.
    public func gridHeight(_ widget: Widget) -> Double {
        let h = Double(phoneLayout.first { $0.widgetId == widget.id }?.h ?? 4)
        return max(60, 36 * h + 12 * (h - 1) - 34)
    }

    /// A custom widget's HTML: its own, or its library type's.
    public func customHTML(_ widget: Widget) -> String? {
        if let html = widget.html, !html.isEmpty { return html }
        guard let typeId = widget.customType else { return nil }
        return widgetTypes.first { $0.id == typeId }.flatMap { $0.html.isEmpty ? nil : $0.html }
    }

    /// The library type's default options under the widget's own.
    public func customOptions(_ widget: Widget) -> OrderedJSON {
        var fields = widget.customType.flatMap { id in widgetTypes.first { $0.id == id } }?.defaultOptions.fields ?? []
        for field in widget.options.fields ?? [] {
            if let index = fields.firstIndex(where: { $0.key == field.key }) { fields[index] = field } else { fields.append(field) }
        }
        return .object(fields)
    }
}

// MARK: Times

public enum DashboardTime {
    /// "just now", "4m ago", "3h ago", "2d ago" (shared.ts `ago`).
    public static func ago(_ at: Double, now: Double) -> String {
        let seconds = max(0, ((now - at) / 1000).rounded())
        if seconds < 45 { return "just now" }
        let minutes = (seconds / 60).rounded()
        if minutes < 60 { return "\(Int(minutes))m ago" }
        let hours = (minutes / 60).rounded()
        if hours < 48 { return "\(Int(hours))h ago" }
        return "\(Int((hours / 24).rounded()))d ago"
    }

    public enum Tone: Equatable { case normal, warning, error }

    /// The tile's footer: when its data came in, or what went wrong. Nil for
    /// widgets without a fetched source.
    public static func freshness(_ data: Dashboard.DataView?, now: Double) -> (text: String, tone: Tone)? {
        guard let data, data.status != "none", data.status != "static" else { return nil }
        switch data.status {
        case "error":
            if let fetchedAt = data.fetchedAt {
                let failed = data.errorAt.map { " \(ago($0, now: now))" } ?? ""
                return ("Failed\(failed); showing \(ago(fetchedAt, now: now))", .error)
            }
            return ("Couldn't load", .error)
        case "approval": return ("Needs approval on desktop", .warning)
        case "pending": return (data.error != nil ? "Couldn't load" : "Waiting for data", .normal)
        default: return ("Updated \(data.fetchedAt.map { ago($0, now: now) } ?? "")", .normal)
        }
    }

    /// A countdown: "2d 3h 4m", "1h 2m 3s", "4m 5s", or "Now".
    public static func countdown(_ target: Double, now: Double) -> String {
        let left = Int(max(0, ((target - now) / 1000).rounded()))
        if left == 0 { return "Now" }
        let (d, h, m, s) = (left / 86400, left % 86400 / 3600, left % 3600 / 60, left % 60)
        return d > 0 ? "\(d)d \(h)h \(m)m" : h > 0 ? "\(h)h \(m)m \(s)s" : "\(m)m \(s)s"
    }

    /// An ISO time, with or without fractional seconds, a date, or an RSS (RFC 822) time.
    public static func parse(_ text: String) -> Date? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        let full = ISO8601DateFormatter()
        full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = full.date(from: trimmed) { return date }
        full.formatOptions = [.withInternetDateTime]
        if let date = full.date(from: trimmed) { return date }
        let local = DateFormatter()
        local.locale = Locale(identifier: "en_US_POSIX")
        // RSS dates: "Tue, 10 Jun 2003 04:00:00 GMT" or "+0000".
        for format in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd", "EEE, d MMM yyyy HH:mm:ss zzz", "EEE, d MMM yyyy HH:mm:ss Z", "d MMM yyyy HH:mm:ss Z"] {
            local.dateFormat = format
            if let date = local.date(from: trimmed) { return date }
        }
        return nil
    }
}

// MARK: The viewer heartbeat

/// When the phone tells the server it's watching a dashboard. URL and script
/// widgets refresh only while some client does, so the phone beats while the
/// screen is on top and the app active, and leaves as soon as either stops.
public struct DashboardViewing: Equatable, Sendable {
    /// `dashboards.view`: "Heartbeat while a client shows the dashboard (every 30 s)".
    /// The server counts a viewer for 75 s after its last beat.
    public static let interval: Duration = .seconds(30)
    /// One id per app launch, so the server counts this phone once.
    public static let clientId = "ios_" + UUID().uuidString.prefix(12).lowercased()

    public enum Action: Equatable, Sendable { case beat, leave }

    public var visible = false
    public var active = true

    public init(visible: Bool = false, active: Bool = true) {
        self.visible = visible
        self.active = active
    }

    public var watching: Bool { visible && active }

    /// What to send when the state changes: beat on starting to watch, leave on stopping.
    public static func action(from old: DashboardViewing, to new: DashboardViewing) -> Action? {
        guard old.watching != new.watching else { return nil }
        return new.watching ? .beat : .leave
    }
}

// MARK: Reading widget data

/// How each built-in widget reads its data value and options, leniently: shapes it
/// doesn't know read as nil, and the tile says so instead of failing.
public enum DashboardRead {
    public static func safeURL(_ value: OrderedJSON?) -> URL? {
        let text = (value?.text ?? "").trimmingCharacters(in: .whitespaces)
        guard text.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
        return URL(string: text)
    }

    // MARK: Stat

    public enum StatNumber: Hashable, Sendable {
        case number(Double)
        case text(String)
    }

    public struct Stat: Hashable, Sendable {
        public var value: StatNumber?
        public var delta: String?
        /// up, down or flat.
        public var trend: String?
        public var series: [Double]
        public var caption: String?
    }

    private static func fromSeries(_ series: [Double]) -> Stat {
        let last = series.last
        let prev = series.count > 1 ? series[series.count - 2] : nil
        let change = last.flatMap { last in prev.map { last - $0 } }
        let pct = change.flatMap { change in prev.flatMap { $0 != 0 ? change / abs($0) * 100 : nil } }
        var delta: String?
        if let pct {
            delta = (pct >= 0 ? "+" : "") + String(format: abs(pct) < 10 ? "%.1f" : "%.0f", pct) + "%"
        } else if let change {
            delta = (change >= 0 ? "+" : "") + OrderedJSON.jsNumber(change)
        }
        let trend = change.map { $0 > 0 ? "up" : $0 < 0 ? "down" : "flat" }
        return Stat(value: last.map(StatNumber.number), delta: delta, trend: trend, series: series, caption: nil)
    }

    /// A number, a string, a series, rows, or {value, delta, trend, series, caption}.
    public static func stat(_ value: OrderedJSON, options: OrderedJSON) -> Stat {
        let field = options["field"]?.text ?? ""
        if let number = value.number { return Stat(value: .number(number), series: []) }
        if case .string(let text) = value { return Stat(value: .text(text), series: []) }
        if let items = value.array {
            let series = items.compactMap { item -> Double? in
                if item.isRow, !field.isEmpty { return item[field]?.number }
                if let fields = item.fields { return fields.lazy.compactMap(\.value.number).first }
                return item.number
            }
            return fromSeries(series)
        }
        if value.isRow {
            let series = value["series"]?.array?.compactMap(\.number) ?? []
            let base = !series.isEmpty && value["value"] == nil ? fromSeries(series) : nil
            let trend = value["trend"]?.string.flatMap { ["up", "down", "flat"].contains($0) ? $0 : nil }
            let delta: String?
            switch value["delta"] {
            case nil, .null?: delta = base?.delta
            case .number(let number)?: delta = (number >= 0 ? "+" : "") + OrderedJSON.jsNumber(number)
            case let other?: delta = other.text
            }
            let key = field.isEmpty ? "value" : field
            let own: StatNumber? = value[key]?.number.map(StatNumber.number) ?? value[key].flatMap { $0.text.isEmpty ? nil : .text($0.text) }
            let impliedTrend: String? = delta.flatMap { $0.hasPrefix("-") || $0.hasPrefix("−") ? "down" : $0.hasPrefix("+") ? "up" : nil }
            let caption = value["caption"]?.text ?? ""
            return Stat(
                value: base?.value ?? own, delta: delta, trend: trend ?? base?.trend ?? impliedTrend, series: series,
                caption: caption.isEmpty ? nil : caption)
        }
        return Stat(series: [])
    }

    /// `prefix` + the number (`decimals`, or up to 2 below 100) + `unit`.
    public static func format(_ value: StatNumber?, options: OrderedJSON, locale: Locale = .current) -> String {
        let prefix = options["prefix"]?.text ?? ""
        let unit = options["unit"]?.text ?? ""
        switch value {
        case nil: return "—"
        case .text(let text)?: return prefix + text + unit
        case .number(let number)?:
            let formatter = NumberFormatter()
            formatter.locale = locale
            formatter.numberStyle = .decimal
            if let decimals = options["decimals"]?.number {
                formatter.minimumFractionDigits = Int(decimals)
                formatter.maximumFractionDigits = Int(decimals)
            } else {
                formatter.maximumFractionDigits = abs(number) >= 100 ? 0 : 2
            }
            return prefix + (formatter.string(from: NSNumber(value: number)) ?? OrderedJSON.jsNumber(number)) + unit
        }
    }

    // MARK: Charts

    /// Rows a chart can plot, from an array of rows or {data|rows: [...]}.
    public static func chartRows(_ value: OrderedJSON) -> [OrderedJSON]? {
        let rows = value.array ?? value["data"]?.array ?? value["rows"]?.array
        guard let rows else { return nil }
        let clean = Array(rows.filter(\.isRow).prefix(500))
        return clean.isEmpty ? nil : clean
    }

    /// The category key and the numeric series keys, from options or the rows (Pages' `resolveChart`).
    public static func resolveChart(_ rows: [OrderedJSON], options: OrderedJSON) -> (x: String, series: [String]) {
        var keys: [String] = []
        for row in rows { for field in row.fields ?? [] where !keys.contains(field.key) { keys.append(field.key) } }
        let x = options["x"]?.string
            ?? keys.first { key in rows.contains { if case .string? = $0[key] { true } else { false } } }
            ?? keys.first ?? "x"
        let series = options["series"]?.array.map { Array($0.compactMap(\.string).prefix(8)) }
            ?? Array(keys.filter { key in key != x && rows.contains { if case .number? = $0[key] { true } else { false } } }.prefix(8))
        return (x, series)
    }

    public struct ChartPoint: Identifiable, Hashable, Sendable {
        public var id: Int
        public var x: String
        public var series: String
        public var value: Double
    }

    public struct Chart: Hashable, Sendable {
        public var x: String
        public var series: [String]
        public var points: [ChartPoint]
        public var rows: Int
    }

    public static func chart(_ value: OrderedJSON, options: OrderedJSON) -> Chart? {
        guard let rows = chartRows(value) else { return nil }
        let (x, series) = resolveChart(rows, options: options)
        var points: [ChartPoint] = []
        for row in rows {
            for name in series {
                guard let number = row[name]?.number else { continue }
                points.append(ChartPoint(id: points.count, x: row[x]?.text ?? "", series: name, value: number))
            }
        }
        return points.isEmpty ? nil : Chart(x: x, series: series, points: points, rows: rows.count)
    }

    // MARK: Table

    public struct Table: Hashable, Sendable {
        public var columns: [String]
        public var rows: [[OrderedJSON]]
    }

    /// An array of objects, or {columns, rows}; `columns` and `maxRows` options.
    public static func table(_ value: OrderedJSON, options: OrderedJSON) -> Table? {
        let max = Int(min(1000, Swift.max(1, options["maxRows"]?.number ?? 200)))
        if let columnsJSON = value["columns"]?.array, let rowsJSON = value["rows"]?.array {
            let columns = columnsJSON.map(\.text)
            return Table(columns: columns, rows: rowsJSON.prefix(max).map { row in
                if let cells = row.array { return cells }
                if row.isRow { return columns.map { row[$0] ?? .null } }
                return [row]
            })
        }
        guard let rows = chartRows(value) else { return nil }
        let wanted = options["columns"]?.array.map { $0.map(\.text).filter { !$0.isEmpty } }
        var columns = wanted ?? []
        if wanted == nil {
            for row in rows.prefix(50) { for field in row.fields ?? [] where !columns.contains(field.key) { columns.append(field.key) } }
            columns = Array(columns.prefix(20))
        }
        return Table(columns: columns, rows: rows.prefix(max).map { row in columns.map { row[$0] ?? .null } })
    }

    public static func cellText(_ value: OrderedJSON, locale: Locale = .current) -> String {
        switch value {
        case .null: return ""
        case .array, .object: return value.jsonText
        case .number(let number):
            let formatter = NumberFormatter()
            formatter.locale = locale
            formatter.numberStyle = .decimal
            formatter.maximumFractionDigits = 3
            return formatter.string(from: NSNumber(value: number)) ?? OrderedJSON.jsNumber(number)
        default: return value.text
        }
    }

    // MARK: List

    public struct ListItem: Hashable, Sendable {
        public var title: String
        public var link: URL?
        public var summary: String?
        public var date: String?
    }

    /// {title, link?, summary?, date?} entries or strings, or a feed {items: [...]}.
    public static func list(_ value: OrderedJSON) -> [ListItem]? {
        guard let items = value.array ?? value["items"]?.array else { return nil }
        return items.prefix(200).compactMap { item in
            switch item {
            case .string, .number: return ListItem(title: item.text)
            case .object:
                let title = ["title", "name", "label", "text"].lazy.map { item[$0]?.text ?? "" }.first { !$0.isEmpty } ?? ""
                guard !title.isEmpty else { return nil }
                let summary = (item["summary"] ?? item["subtitle"] ?? item["description"])?.text ?? ""
                let date = (item["date"] ?? item["time"] ?? item["published"])?.text ?? ""
                return ListItem(
                    title: title, link: safeURL(item["link"] ?? item["url"] ?? item["href"]),
                    summary: summary.isEmpty ? nil : summary, date: date.isEmpty ? nil : date)
            default: return nil
            }
        }
    }

    // MARK: Ticker

    public struct TickerEntry: Hashable, Sendable {
        public var label: String
        public var value: String
        public var delta: String
    }

    /// {label, value?, delta?} entries or strings.
    public static func ticker(_ value: OrderedJSON) -> [TickerEntry] {
        let raw = value.array ?? value["items"]?.array ?? []
        return raw.prefix(100).compactMap { item -> TickerEntry? in
            switch item {
            case .string, .number: return TickerEntry(label: item.text, value: "", delta: "")
            case .object:
                let label = (item["label"] ?? item["title"] ?? item["name"] ?? item["symbol"])?.text ?? ""
                return TickerEntry(label: label, value: (item["value"] ?? item["price"])?.text ?? "",
                                   delta: (item["delta"] ?? item["change"])?.text ?? "")
            default: return nil
            }
        }.filter { !$0.label.isEmpty || !$0.value.isEmpty }
    }

    // MARK: Progress

    public struct Progress: Hashable, Sendable {
        public var value: Double
        public var min: Double
        public var max: Double
        public var label: String
        public var fraction: Double { Swift.min(1, Swift.max(0, (value - min) / (max - min))) }
    }

    /// A number, or {value, max?, min?, label?}.
    public static func progress(_ value: OrderedJSON, options: OrderedJSON) -> Progress? {
        let row = value.isRow
        guard let number = (row ? value["value"] : value)?.number else { return nil }
        let min = (row ? value["min"]?.number : nil) ?? options["min"]?.number ?? 0
        let max = (row ? value["max"]?.number : nil) ?? options["max"]?.number ?? 100
        let label = (row ? value["label"]?.text : nil).flatMap { $0.isEmpty ? nil : $0 } ?? options["label"]?.text ?? ""
        return Progress(value: number, min: min, max: max > min ? max : min + 1, label: label)
    }

    // MARK: Image and embed

    /// http(s), a data:image URL, or one of BB's own file routes, resolved against the server.
    public static func image(_ value: OrderedJSON, options: OrderedJSON, server: URL) -> URL? {
        let text = (value.string ?? options["url"]?.text ?? "").trimmingCharacters(in: .whitespaces)
        if text.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil { return URL(string: text) }
        if text.range(of: #"^data:image/(png|jpe?g|gif|webp|svg\+xml);"#, options: [.regularExpression, .caseInsensitive]) != nil { return URL(string: text) }
        if text.hasPrefix("/api/v1/") { return URL(string: text, relativeTo: server)?.absoluteURL }
        return nil
    }

    public enum Embed: Hashable, Sendable {
        /// A Studio item's app path.
        case item(String)
        case thread(String)
        case web(URL)
        case none
    }

    /// `href` (a Studio item path), `threadId`, or `url`, in that order.
    public static func embed(_ options: OrderedJSON) -> Embed {
        let href = (options["href"]?.text ?? "").trimmingCharacters(in: .whitespaces)
        if href.hasPrefix("/plugins/") { return .item(href) }
        let thread = (options["threadId"]?.text ?? "").trimmingCharacters(in: .whitespaces)
        if !thread.isEmpty { return .thread(thread) }
        if let url = safeURL(options["url"]) { return .web(url) }
        return .none
    }
}

// MARK: Custom widgets

/// A custom widget's document, the same one the desktop puts in its sandboxed
/// iframe (dashboards/ui/custom-frame.tsx): the CSP allows inline scripts and
/// styles and data: images only, and no network.
public enum DashboardCustomFrame {
    public static let stateMessage = "bb-widget-state"
    public static let readyMessage = "bb-widget-ready"
    public static let heightMessage = "bb-widget-height"
    public static let maxHeight: Double = 4000
    public static let csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"

    static let boot = #"(function(){var state={data:null,options:{},theme:{mode:"light",colors:{}},size:{width:0,height:0}};window.bbWidget=state;"#
        + #"function apply(next){state.data=next.data===undefined?null:next.data;state.options=next.options||{};state.theme=next.theme||state.theme;state.size=next.size||state.size;var root=document.documentElement;root.style.colorScheme=state.theme.mode;var colors=state.theme.colors||{};for(var key in colors){if(typeof colors[key]==="string")root.style.setProperty("--bb-"+key,colors[key])}window.dispatchEvent(new CustomEvent("bbwidget",{detail:state}))}"#
        + #"addEventListener("message",function(event){if(event.source!==parent)return;var d=event.data;if(d&&d.type==="bb-widget-state")apply(d)});"#
        + #"var last=0;function post(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==last){last=h;parent.postMessage({type:"bb-widget-height",height:h},"*")}}"#
        + #"addEventListener("load",function(){parent.postMessage({type:"bb-widget-ready"},"*");if(window.ResizeObserver&&document.body)new ResizeObserver(post).observe(document.body);post()});})();"#

    /// CSP first, then the boot script, then the widget.
    public static func document(_ html: String) -> String {
        #"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content=""#
            + csp
            + #""><style>html,body{margin:0;padding:0;background:transparent;color:var(--bb-foreground,inherit);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}</style><script>"#
            + boot + "</script></head><body>" + html + "</body></html>"
    }

    /// The script that hands the widget its state, as the desktop's postMessage does.
    public static func stateScript(data: OrderedJSON, options: OrderedJSON, dark: Bool, width: Double, height: Double) -> String {
        let colors: [OrderedJSON.Field] = [
            .init("foreground", .string(dark ? "#f4f4f5" : "#18181b")),
            .init("background", .string(dark ? "#09090b" : "#ffffff")),
            .init("muted", .string(dark ? "#a1a1aa" : "#71717a")),
            .init("border", .string(dark ? "#27272a" : "#e4e4e7")),
            .init("accent", .string("#6366f1")),
            .init("series", .array(dashboardSeriesColors.map { .string($0) })),
        ]
        let message: OrderedJSON = .object([
            .init("type", .string(stateMessage)),
            .init("data", data),
            .init("options", options),
            .init("theme", .object([.init("mode", .string(dark ? "dark" : "light")), .init("colors", .object(colors))])),
            .init("size", .object([.init("width", .number(width.rounded())), .init("height", .number(height.rounded()))])),
        ])
        return "window.postMessage(\(message.jsonText),\"*\");"
    }

    /// The height a widget asks for (`{height}`), clamped; nil for anything else.
    public static func askedHeight(_ body: Any) -> Double? {
        guard let message = body as? [String: Any], let height = (message["height"] as? NSNumber)?.doubleValue, height.isFinite else { return nil }
        return min(maxHeight, max(0, height.rounded(.up)))
    }
}

/// Pages' chart colors (pages/chart-spec.ts `SERIES_COLORS`).
public let dashboardSeriesColors = ["#6366f1", "#14b8a6", "#f59e0b", "#ec4899", "#0ea5e9", "#84cc16", "#a855f7", "#ef4444"]

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
        let body = try JSONEncoder().encode(input)
        let (status, data) = try await raw(method: "POST", path: "/api/v1/plugins/\(pluginId)/rpc/\(method)", body: body)
        guard (200..<300).contains(status), let envelope = try? OrderedJSON.parse(data), envelope["ok"]?.bool == true else {
            throw BBError(status: status, message: Self.errorMessage(data) ?? "\(pluginId).\(method) failed (HTTP \(status))")
        }
        return try Result(orderedJSON: envelope["result"] ?? .null)
    }

    /// One dashboard with its widgets' last data; nil when it's gone.
    public func dashboard(_ id: String) async throws -> Dashboard? {
        let result: OrderedJSON = try await rpc("studio", Studio.Method.dashboards_get, ["id": .string(id)])
        guard let json = result["dashboard"], !json.isNull else { return nil }
        return Dashboard(json)
    }

    /// The viewer heartbeat; `leave` when the phone stops showing it.
    public func viewDashboard(_ id: String, leave: Bool = false) async throws {
        var input: [String: JSONValue] = ["id": .string(id), "clientId": .string(DashboardViewing.clientId)]
        if leave { input["leave"] = .bool(true) }
        let _: Studio.DashboardsViewOutput = try await rpc("studio", Studio.Method.dashboards_view, .object(input))
    }

    /// Refreshes the dashboard's url and approved script widgets now; the ids it refreshed.
    @discardableResult
    public func refreshDashboard(_ id: String) async throws -> [String] {
        let result: Studio.DashboardsRefreshOutput = try await rpc("studio", Studio.Method.dashboards_refresh, ["id": .string(id)])
        return result.refreshed ?? []
    }

    public static func isDashboardId(_ value: String) -> Bool { value.wholeMatch(of: /dsh_[0-9a-f]{16}/) != nil }
}
