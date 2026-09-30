import Charts
import SwiftUI

/// A page's Markdown: BB Pages' extensions (mentions, callouts, and ```chart /
/// ```stats / ```embed data blocks) mapped onto `MarkdownText` and a few native views.
struct PageMarkdown: View {
    let source: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(PageSegment.parse(source).enumerated()), id: \.offset) { _, segment in
                switch segment {
                case .markdown(let text): MarkdownText(text)
                case .stats(let items): StatsGrid(items: items)
                case .chart(let chart): PageChart(chart: chart)
                case .embed(let embed): EmbedCard(embed: embed)
                }
            }
        }
    }
}

enum PageSegment {
    case markdown(String)
    case stats([StatItem])
    case chart(ChartSpec)
    case embed(Embed)

    private final class Box {
        let segments: [PageSegment]
        init(_ segments: [PageSegment]) { self.segments = segments }
    }

    /// Pages re-render whenever the tree changes; parse each source once.
    nonisolated(unsafe) private static let cache = NSCache<NSString, Box>()

    static func parse(_ source: String) -> [PageSegment] {
        if let hit = cache.object(forKey: source as NSString) { return hit.segments }
        let segments = parseUncached(source)
        cache.setObject(Box(segments), forKey: source as NSString)
        return segments
    }

    private static func parseUncached(_ source: String) -> [PageSegment] {
        var segments: [PageSegment] = []
        var text: [String] = []
        var fence: String?
        let lines = source.components(separatedBy: "\n")
        var index = 0

        func flush() {
            let joined = text.joined(separator: "\n")
            if !joined.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { segments.append(.markdown(joined)) }
            text = []
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            index += 1
            if let open = fence {
                if trimmed.hasPrefix(open) { fence = nil }
                text.append(line)
                continue
            }
            if let kind = trimmed.wholeMatch(of: /```(chart|stats|embed)\s*/)?.1, line.first == "`" {
                var body: [String] = []
                while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    body.append(lines[index])
                    index += 1
                }
                index += 1
                if let segment = data(String(kind), body.joined(separator: "\n")) {
                    flush()
                    segments.append(segment)
                } else {
                    text += [line] + body + ["```"]
                }
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                fence = String(trimmed.prefix(3))
                text.append(line)
                continue
            }
            text.append(prepare(line))
        }
        flush()
        return segments
    }

    private static func data(_ kind: String, _ json: String) -> PageSegment? {
        let data = Data(json.utf8)
        let decoder = JSONDecoder()
        switch kind {
        case "stats": return (try? decoder.decode([StatItem].self, from: data)).flatMap { $0.isEmpty ? nil : .stats($0) }
        case "chart": return (try? decoder.decode(ChartSpec.self, from: data)).flatMap { $0.data.isEmpty ? nil : .chart($0) }
        case "embed": return (try? decoder.decode(Embed.self, from: data)).map { .embed($0) }
        default: return nil
        }
    }

    /// Mentions to links or bold names, callout markers to bold labels, and
    /// backslash hard breaks to plain newlines (`MarkdownText` keeps newlines).
    static func prepare(_ line: String) -> String {
        var line = line.replacing(/@\[((?:\\.|[^\]\\])*)\]\(([a-z]+):([^)\s]+)\)/) { match in
            let label = match.1.isEmpty ? String(match.3) : String(match.1)
            switch match.2 {
            case "page": return "[\(label)](bbstudio://page/\(match.3))"
            case "thread": return "[\(label)](bbstudio://thread/\(match.3))"
            default: return "**\(label)**"
            }
        }
        if let callout = line.wholeMatch(of: /(\s*>\s*)\[!(\w+)\]\s*(.*)/) {
            let label = callout.2.lowercased().capitalized
            line = callout.3.isEmpty ? "\(callout.1)**\(label)**" : "\(callout.1)**\(label):** \(callout.3)"
        }
        let slashes = line.reversed().prefix { $0 == "\\" }.count
        if slashes % 2 == 1 { line.removeLast() }
        return line
    }
}

// MARK: Data blocks

/// Cells in chart rows and stat values: strings or numbers.
enum PageCell: Decodable {
    case text(String)
    case number(Double)
    case none

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Double.self) {
            self = .number(number)
        } else if let text = try? container.decode(String.self) {
            self = .text(text)
        } else {
            self = .none
        }
    }

    var number: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    var text: String {
        switch self {
        case .text(let value): value
        case .number(let value): value.formatted()
        case .none: ""
        }
    }
}

struct StatItem: Decodable {
    var label: String
    var value: PageCell
    var delta: String?
    var trend: String?
    var caption: String?
}

struct ChartSpec: Decodable {
    var type: String?
    var title: String?
    var x: String?
    var series: [String]?
    var stacked: Bool?
    var unit: String?
    var data: [[String: PageCell]]

    struct Point: Identifiable {
        var id: Int
        var x: String
        var series: String
        var value: Double
    }

    /// Fills in `x` and `series` from the data the way the web editor does.
    var resolved: (x: String, series: [String]) {
        var keys: [String] = []
        for row in data { for key in row.keys.sorted() where !keys.contains(key) { keys.append(key) } }
        let x = x ?? keys.first { key in data.contains { if case .text = $0[key] { true } else { false } } } ?? keys.first ?? "x"
        let series = series ?? Array(keys.filter { key in key != x && data.contains { $0[key]?.number != nil } }.prefix(8))
        return (x, series)
    }

    var points: [Point] {
        let (x, series) = resolved
        var points: [Point] = []
        for row in data {
            for name in series {
                guard let value = row[name]?.number else { continue }
                points.append(Point(id: points.count, x: row[x]?.text ?? "", series: name, value: value))
            }
        }
        return points
    }
}

struct Embed: Decodable {
    var kind: String?
    var target: String?
    var url: String?
    var id: String?
    var title: String?
    var description: String?
}

// MARK: Views

struct StatsGrid: View {
    let items: [StatItem]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.label).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    Text(item.value.text).font(.title2.weight(.semibold)).monospacedDigit().lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if let delta = item.delta {
                        Label(delta, systemImage: trendSymbol(item.trend))
                            .font(.caption.weight(.medium))
                            .foregroundStyle(item.trend == "up" ? .green : item.trend == "down" ? .red : .secondary)
                    }
                    if let caption = item.caption {
                        Text(caption).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(.fill.tertiary, in: .rect(cornerRadius: 12))
            }
        }
    }

    private func trendSymbol(_ trend: String?) -> String {
        switch trend {
        case "up": "arrow.up.right"
        case "down": "arrow.down.right"
        default: "arrow.right"
        }
    }
}

struct PageChart: View {
    let chart: ChartSpec

    var body: some View {
        let points = chart.points
        let multi = Set(points.map(\.series)).count > 1
        VStack(alignment: .leading, spacing: 8) {
            if let title = chart.title { Text(title).font(.subheadline.weight(.semibold)) }
            Chart(points) { point in
                switch chart.type ?? "bar" {
                case "line":
                    LineMark(x: .value("X", point.x), y: .value(point.series, point.value))
                        .foregroundStyle(by: .value("Series", point.series))
                        .lineStyle(StrokeStyle(lineWidth: 2))
                case "area":
                    AreaMark(x: .value("X", point.x), y: .value(point.series, point.value))
                        .foregroundStyle(by: .value("Series", point.series))
                        .opacity(0.8)
                case "pie":
                    SectorMark(angle: .value(point.series, point.value), innerRadius: .ratio(0.5), angularInset: 1)
                        .foregroundStyle(by: .value("X", point.x))
                default:
                    if chart.stacked == true {
                        BarMark(x: .value("X", point.x), y: .value(point.series, point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                    } else {
                        BarMark(x: .value("X", point.x), y: .value(point.series, point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                            .position(by: .value("Series", point.series))
                            .clipShape(.rect(topLeadingRadius: 4, topTrailingRadius: 4))
                    }
                }
            }
            .chartLegend(multi || chart.type == "pie" ? .visible : .hidden)
            .chartYAxisLabel(chart.unit ?? "")
            .frame(height: 220)
        }
        .padding(12)
        .background(.fill.quaternary, in: .rect(cornerRadius: 12))
    }
}

struct EmbedCard: View {
    let embed: Embed
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var studio = StudioStore.shared

    /// Embeds of other add-ons' items, by the add-on that makes them.
    private static let studioPlugins = ["drawing": "excalidraw", "artifact": "artifacts", "recording": "talk", "task": "studio-tasks"]

    var body: some View {
        let target = embed.target ?? embed.url ?? embed.id ?? ""
        let kind = embed.kind ?? "bookmark"
        if let ref = Self.studioRef(kind, target) {
            studioCard(kind, ref)
        } else {
            linkCard(kind, target)
        }
    }

    @ViewBuilder
    private func linkCard(_ kind: String, _ target: String) -> some View {
        let content = HStack(spacing: 10) {
            Image(systemName: symbol(kind)).foregroundStyle(.secondary).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title(kind, target)).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(embed.description.flatMap { $0.isEmpty ? nil : $0 } ?? subtitle(kind, target))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(.fill.tertiary, in: .rect(cornerRadius: 12))

        if let url = link(kind, target) {
            Link(destination: url) { content }.buttonStyle(.plain)
        } else {
            content
        }
    }

    /// A drawing, artifact, recording, task or any Studio item: its row from Studio, opening natively.
    private func studioCard(_ kind: String, _ ref: (pluginId: String, id: String)) -> some View {
        let item = studio.items.first { $0.pluginId == ref.pluginId && $0.itemId == ref.id }
        let label = kind == "item" ? (item.map { StudioKind.of($0.kind).label } ?? "Studio item") : StudioKind.of(kind).label
        return Button { open(item, ref) } label: {
            Group {
                if let item {
                    StudioRow(item: item, project: nil)
                } else {
                    HStack(spacing: 10) {
                        Image(systemName: kind == "task" ? "checkmark.circle" : StudioKind.of(kind).symbol)
                            .foregroundStyle(.secondary).frame(width: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(embed.title.flatMap { $0.isEmpty ? nil : $0 } ?? label).font(.subheadline.weight(.semibold))
                            Text(studio.loaded ? "\(label) not found" : "Loading…").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.fill.tertiary, in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("studioEmbed")
        .task {
            guard item == nil, studio.items.isEmpty else { return }
            studio.restore()
            if studio.items.isEmpty { await studio.load(app.client) }
        }
    }

    private func open(_ item: StudioItem?, _ ref: (pluginId: String, id: String)) {
        let href = item?.href
        if let route = href.flatMap(Route.init(href:)) ?? Self.route(ref) {
            app.push(route)
        } else if let href, let url = URL(string: href, relativeTo: app.client.baseURL) {
            // Add-ons the app doesn't draw natively, like Studio Tasks, open in BB web.
            UIApplication.shared.open(url)
        }
    }

    private static func route(_ ref: (pluginId: String, id: String)) -> Route? {
        switch ref.pluginId {
        case "excalidraw": .drawing(id: ref.id)
        case "artifacts": .artifact(id: ref.id)
        case "talk": .recording(id: ref.id)
        case "pages": .page(id: ref.id)
        default: nil
        }
    }

    /// The add-on item an embed points at: an id for a known kind, `pluginId:id` for "item".
    static func studioRef(_ kind: String, _ target: String) -> (pluginId: String, id: String)? {
        guard !target.isEmpty else { return nil }
        if let pluginId = studioPlugins[kind] { return (pluginId, target) }
        guard kind == "item", let split = target.firstIndex(of: ":"), split != target.startIndex,
            target.index(after: split) != target.endIndex
        else { return nil }
        return (String(target[..<split]), String(target[target.index(after: split)...]))
    }

    private func link(_ kind: String, _ target: String) -> URL? {
        switch kind {
        case "page": URL(string: "bbstudio://page/\(target)")
        case "thread": URL(string: "bbstudio://thread/\(target)")
        default: URL(string: target).flatMap { $0.scheme?.hasPrefix("http") == true ? $0 : nil }
        }
    }

    private func title(_ kind: String, _ target: String) -> String {
        if let title = embed.title, !title.isEmpty { return title }
        if kind == "page" { return PagesStore.shared.page(target)?.displayTitle ?? "Page" }
        if kind == "bookmark" { return URL(string: target)?.host() ?? target }
        return target.isEmpty ? "Embed" : target
    }

    private func subtitle(_ kind: String, _ target: String) -> String {
        switch kind {
        case "bookmark": target
        case "page": "Page"
        case "thread": "Thread"
        default: "Embed"
        }
    }

    private func symbol(_ kind: String) -> String {
        switch kind {
        case "page": "doc.text"
        case "thread": "bubble.left.and.bubble.right"
        case "bookmark": "link"
        default: "square.dashed"
        }
    }
}
