import SwiftUI

/// Block-level markdown on top of `AttributedString`'s inline parser: headings,
/// paragraphs, ordered, nested and task lists, quotes, tables, rules and fenced
/// code. `::artifact{id="…"}` lines become artifact cards and `::inline-vis{…}`
/// lines show the file they name, and `::task{id="…"}` lines task cards; other directives,
/// such as `::reactions{…}`, are left out; see `Directive`.
struct MarkdownText: View {
    let source: String

    init(_ source: String) {
        self.source = source
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownBlock.parse(source).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(Self.inline(text))
                .font(level == 1 ? .title3.bold() : level == 2 ? .headline : .subheadline.bold())
                .padding(.top, 4)
        case .paragraph(let text):
            Text(Self.inline(text))
        case .list(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        marker(item)
                        Text(Self.inline(item.text))
                    }
                    .padding(.leading, CGFloat(item.level) * 18)
                }
            }
        case .quote(let text):
            HStack(spacing: 10) {
                Capsule().fill(.tertiary).frame(width: 3)
                AnyView(MarkdownText(text)).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .table(let header, let rows):
            MarkdownTable(header: header, rows: rows)
        case .code(let language, let code):
            CodeBlock(language: language, code: code)
        case .rule:
            Divider().padding(.vertical, 2)
        case .artifact(let id):
            ArtifactCard(id: id)
        case .inlineVis(let vis):
            InlineVisCard(vis: vis)
        case .task(let id):
            TaskCard(id: id)
        }
    }

    @ViewBuilder
    private func marker(_ item: MarkdownBlock.ListItem) -> some View {
        switch item.marker {
        case .task(let done):
            Image(systemName: done ? "checkmark.square.fill" : "square")
                .foregroundStyle(done ? Color.accentColor : .secondary)
                .font(.subheadline)
        case .number(let number):
            Text(number).monospacedDigit().foregroundStyle(.secondary)
        case .bullet:
            Text(["•", "◦", "▪"][item.level % 3]).foregroundStyle(.secondary)
        }
    }

    /// Inline markdown with BB's conventions: `@thread:thr_…` mentions open the
    /// thread in the app, and workspace files, as links or as paths in inline
    /// code, open in the thread's file viewer.
    static func inline(_ text: String) -> AttributedString {
        let linked = text.replacing(/@thread:(thr_[A-Za-z0-9]+)/) { match in
            let id = String(match.1)
            let title = ThreadTitles.titles[id].map { $0.replacingOccurrences(of: "]", with: "") } ?? id
            return "[@\(title)](bbstudio://thread/\(id))"
        }
        guard
            var attributed = try? AttributedString(
                markdown: linked, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
        else { return AttributedString(text) }
        for run in attributed.runs {
            guard let url = run.link else { continue }
            if url.scheme == "thread" {
                attributed[run.range].link = URL(string: "bbstudio://thread/\(url.absoluteString.dropFirst("thread:".count))")
            } else if url.scheme == nil || url.scheme == "file" {
                let path = url.scheme == "file" ? url.path : url.relativeString.removingPercentEncoding ?? url.relativeString
                attributed[run.range].link = FilePathLink.url(FilePathLink.stripLine(path))
            }
        }
        for run in attributed.runs where run.link == nil && run.inlinePresentationIntent?.contains(.code) == true {
            if let path = FilePathLink.path(inCode: String(attributed[run.range].characters)) {
                attributed[run.range].link = FilePathLink.url(path)
            }
        }
        return attributed
    }
}

/// Thread titles the app has seen, so mentions read as names instead of ids.
/// Observable, so text already on screen updates when a title arrives.
@MainActor
enum ThreadTitles {
    @Observable final class Store {
        var titles: [String: String] = [:]
    }

    static let store = Store()
    static var titles: [String: String] { store.titles }

    /// Writes only changes, so an unchanged refresh doesn't redraw every mention.
    static func set(_ id: String, _ title: String) {
        if store.titles[id] != title { store.titles[id] = title }
    }

    /// Looks up titles for mentioned threads not seen yet (archived ones, say).
    static func fetchUnknown(in texts: [String], client: BBClient) async {
        for id in unknownMentions(in: texts).prefix(10) {
            if let thread = try? await client.thread(id) { set(id, thread.displayTitle) }
        }
    }

    /// `@thread:thr_x` becomes `@Title` when the title is known.
    static func resolve(_ text: String) -> String {
        text.replacing(/@thread:(thr_[A-Za-z0-9]+)/) { match in
            titles[String(match.1)].map { "@" + $0 } ?? String(match.0)
        }
    }

    /// Mentioned threads whose titles haven't been seen yet.
    static func unknownMentions(in texts: [String]) -> Set<String> {
        Set(texts.flatMap { $0.matches(of: /@thread:(thr_[A-Za-z0-9]+)/).map { String($0.1) } })
            .filter { titles[$0] == nil }
    }
}

enum MarkdownBlock {
    struct ListItem {
        enum Marker { case bullet, number(String), task(Bool) }
        var level: Int
        var marker: Marker
        var text: String
    }

    case heading(Int, String)
    case paragraph(String)
    case list([ListItem])
    case quote(String)
    case table(header: [String], rows: [[String]])
    case code(language: String?, String)
    case rule
    /// A Studio artifact an agent put in its reply.
    case artifact(String)
    /// A workspace or thread-storage file shown in the reply.
    case inlineVis(InlineVis)
    /// A Studio Tasks task, from an agent's `tasks_create`.
    case task(String)

    private final class Box {
        let blocks: [MarkdownBlock]
        init(_ blocks: [MarkdownBlock]) { self.blocks = blocks }
    }

    /// Messages re-render on every timeline refresh; parse each text once.
    nonisolated(unsafe) private static let cache = NSCache<NSString, Box>()

    static func parse(_ source: String) -> [MarkdownBlock] {
        if let hit = cache.object(forKey: source as NSString) { return hit.blocks }
        let blocks = parseUncached(source)
        cache.setObject(Box(blocks), forKey: source as NSString)
        return blocks
    }

    private static func parseUncached(_ source: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var items: [ListItem] = []
        var indents: [Int] = []
        var quote: [String] = []
        let lines = source.components(separatedBy: "\n")

        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))) }
            if !items.isEmpty { blocks.append(.list(items)) }
            if !quote.isEmpty { blocks.append(.quote(quote.joined(separator: "\n"))) }
            paragraph = []
            items = []
            indents = []
            quote = []
        }

        var index = 0
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            index += 1

            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flush()
                let fence = String(trimmed.prefix(3))
                let language = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
                    code.append(lines[index])
                    index += 1
                }
                index += 1
                blocks.append(.code(language: language.isEmpty ? nil : language, code.joined(separator: "\n")))
            } else if trimmed.isEmpty {
                flush()
            } else if let directive = Directive(line: trimmed) {
                if directive.name == "artifact", let id = directive.attributes["id"], Artifact.isId(id) {
                    flush()
                    blocks.append(.artifact(id))
                } else if directive.name == "task", let id = directive.attributes["id"], StudioTask.isId(id) {
                    flush()
                    blocks.append(.task(id))
                } else if directive.name == "inline-vis" {
                    flush()
                    blocks.append(.inlineVis(InlineVis(directive)))
                }
            } else if let heading = trimmed.firstMatch(of: /^(#{1,6})\s+(.*)$/) {
                flush()
                blocks.append(.heading(heading.1.count, String(heading.2)))
            } else if trimmed.wholeMatch(of: /^([-*_])(\s*\1){2,}$/) != nil {
                flush()
                blocks.append(.rule)
            } else if trimmed.hasPrefix(">") {
                if !paragraph.isEmpty || !items.isEmpty { flush() }
                quote.append(String(trimmed.dropFirst().drop(while: { $0 == " " })))
            } else if trimmed.hasPrefix("|"), index < lines.count, isTableDivider(lines[index]) {
                flush()
                let header = cells(trimmed)
                var rows: [[String]] = []
                index += 1
                while index < lines.count, lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    rows.append(cells(lines[index]))
                    index += 1
                }
                blocks.append(.table(header: header, rows: rows))
            } else if let item = line.firstMatch(of: /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/) {
                if !paragraph.isEmpty || !quote.isEmpty { flush() }
                let indent = item.1.reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }
                if let last = indents.last, indent > last {
                    indents.append(indent)
                } else {
                    while let last = indents.last, last > indent { indents.removeLast() }
                    if indents.isEmpty { indents.append(indent) }
                }
                var text = String(item.3)
                var marker = ListItem.Marker.bullet
                if item.2.first?.isNumber == true {
                    marker = .number(String(item.2.dropLast()) + ".")
                } else if let task = text.firstMatch(of: /^\[([ xX])\]\s+(.*)$/) {
                    marker = .task(task.1 != " ")
                    text = String(task.2)
                }
                items.append(ListItem(level: indents.count - 1, marker: marker, text: text))
            } else if !items.isEmpty, line.first?.isWhitespace == true {
                // A wrapped continuation of the previous list item.
                items[items.count - 1].text += " " + trimmed
            } else if !quote.isEmpty {
                quote.append(trimmed)
            } else {
                if !items.isEmpty { flush() }
                paragraph.append(line)
            }
        }
        flush()
        return blocks
    }

    private static func isTableDivider(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces).wholeMatch(of: /\|?(\s*:?-+:?\s*\|)+\s*(:?-+:?\s*)?/) != nil
    }

    private static func cells(_ line: String) -> [String] {
        var row = line.trimmingCharacters(in: .whitespaces)
        if row.hasPrefix("|") { row.removeFirst() }
        if row.hasSuffix("|") { row.removeLast() }
        return row.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
    }
}

/// A `::name{key="value" …}` line. BB plugins use these to attach UI to a message;
/// the app renders the ones it knows and hides the rest.
struct Directive {
    let name: String
    let attributes: [String: String]

    init?(line: String) {
        guard let match = line.wholeMatch(of: /::([A-Za-z][\w-]*)\{(.*)\}/) else { return nil }
        name = String(match.1)
        var attributes: [String: String] = [:]
        for pair in match.2.matches(of: /([\w-]+)="([^"]*)"/) {
            attributes[String(pair.1)] = String(pair.2)
        }
        self.attributes = attributes
    }

    /// Suggested replies from the emoji-react plugin's smart reactions: at most five
    /// "emoji label" items of up to 60 characters, split on `|`.
    static func reactions(in text: String) -> [String] {
        var inCode = false
        for line in text.components(separatedBy: "\n").reversed() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") { inCode.toggle() }
            guard !inCode, let directive = Directive(line: trimmed), directive.name == "reactions",
                let raw = directive.attributes["items"]
            else { continue }
            var seen = Set<String>()
            return raw.split(separator: "|")
                .map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
                .filter { item in
                    item.count <= 60 && item.contains(" ") && seen.insert(item).inserted
                }
                .prefix(5)
                .map { $0 }
        }
        return []
    }
}

struct MarkdownTable: View {
    let header: [String]
    let rows: [[String]]
    @State private var available: CGFloat = 360

    /// Widest a column gets before wrapping: a share of the screen, so a
    /// couple of columns fit and wider tables scroll.
    private var cellMax: CGFloat {
        min(360, max(140, available / CGFloat(max(header.count, 1)) - 20))
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow { cells(header, bold: true) }
                    .background(.fill.tertiary)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Divider()
                    GridRow { cells(row, bold: false) }
                }
            }
            .font(.subheadline)
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
            .clipShape(.rect(cornerRadius: 8))
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { available = $0 }
    }

    @ViewBuilder
    private func cells(_ values: [String], bold: Bool) -> some View {
        ForEach(0..<header.count, id: \.self) { column in
            CappedWidth(max: cellMax) {
                Text(MarkdownText.inline(column < values.count ? values[column] : ""))
                    .fontWeight(bold ? .semibold : .regular)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
    }
}

/// Its content's natural width up to `max`, wrapping past that, or the width
/// of its column if wider. A horizontal scroll view offers no width, and
/// without this the grid measures a cell at one width and draws it at another.
private struct CappedWidth: Layout {
    let max: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let content = subviews.first else { return .zero }
        var width = min(content.sizeThatFits(.unspecified).width.rounded(.up), max)
        if let offered = proposal.width, offered.isFinite, offered > width { width = min(offered, max) }
        return CGSize(width: width, height: content.sizeThatFits(ProposedViewSize(width: width, height: nil)).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: nil))
    }
}

struct CodeBlock: View {
    let language: String?
    let code: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "code").font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        copied = false
                    }
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.caption2)
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.borderless)
                .sensoryFeedback(.success, trigger: copied) { _, new in new }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
            }
        }
        .background(.fill.tertiary, in: .rect(cornerRadius: 10))
    }
}
