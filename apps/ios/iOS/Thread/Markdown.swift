import SwiftUI

/// Block-level markdown on top of `AttributedString`'s inline parser: headings,
/// paragraphs, ordered, nested and task lists, quotes, tables, rules and fenced
/// code, and images. `::artifact{id="…"}` lines become artifact cards, `::page{…}`, `::drawing{…}`,
/// `::design{…}`, `::recording{…}` and `::mini{…}` lines cards that preview and open the item,
/// and `::inline-vis{…}` lines show the file they name; other directives, such as `::reactions{…}`,
/// are left out; see `Directive`.
struct MarkdownText: View {
    let source: String

    init(_ source: String) {
        self.source = source
    }

    /// The piece of this message being spoken, set only on that message (voice mode's read-along).
    @Environment(\.readAlongPiece) private var readAlongPiece

    var body: some View {
        let blocks = MarkdownBlock.parse(source)
        // Only the message being read aloud does this work; the cached text stays as it is.
        let readAlong = readAlongPiece.flatMap { ReadAlongBlocks(piece: $0, blocks: blocks) }
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                view(for: block, at: index, readAlong: readAlong)
            }
        }
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock, at index: Int, readAlong: ReadAlongBlocks?) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(ReadAlongBlocks.text(text, block: index, in: readAlong))
                .font(level == 1 ? .title3.bold() : level == 2 ? .headline : .subheadline.bold())
                .padding(.top, 4)
        case .paragraph(let text):
            Text(ReadAlongBlocks.text(text, block: index, in: readAlong))
        case .list(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { itemIndex, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        marker(item)
                        Text(ReadAlongBlocks.text(item.text, block: index, item: itemIndex, in: readAlong))
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
        case .item(let item):
            ReplyItemCard(item: item)
        case .inlineVis(let vis):
            InlineVisCard(vis: vis)
        case .image(let alt, let src):
            MarkdownImage(alt: alt, src: src)
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
        // Parsing is the costly part of drawing a message, and a chat redraws
        // its rows often. Text with thread mentions is parsed each time: its
        // titles can arrive later, and reading them keeps it observing them.
        if text.contains("@thread:") { return parseInline(text) }
        let key = text as NSString
        if let cached = inlineCache.object(forKey: key) { return cached.value }
        let parsed = parseInline(text)
        inlineCache.setObject(InlineBox(parsed), forKey: key)
        return parsed
    }

    private final class InlineBox {
        let value: AttributedString
        init(_ value: AttributedString) { self.value = value }
    }

    nonisolated(unsafe) private static let inlineCache: NSCache<NSString, InlineBox> = {
        let cache = NSCache<NSString, InlineBox>()
        cache.countLimit = 2_000
        return cache
    }()

    private static func parseInline(_ text: String) -> AttributedString {
        let linked = text.replacing(MarkdownRegex.threadMention) { match in
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

extension EnvironmentValues {
    /// The text being spoken now, for the message it comes from.
    @Entry var readAlongPiece: String?
}

/// Read-along across a message's blocks: the piece being spoken, lit up in
/// the paragraphs, headings and list items that hold it.
@MainActor
struct ReadAlongBlocks {
    private struct Key: Hashable { var block: Int, item: Int }
    private var ranges: [Key: Range<Int>] = [:]

    init?(piece: String, blocks: [MarkdownBlock]) {
        var keys: [Key] = []
        var texts: [String] = []
        for (index, block) in blocks.enumerated() {
            switch block {
            case .heading(_, let text), .paragraph(let text):
                keys.append(Key(block: index, item: 0))
                texts.append(String(MarkdownText.inline(text).characters))
            case .list(let items):
                for (item, entry) in items.enumerated() {
                    keys.append(Key(block: index, item: item))
                    texts.append(String(MarkdownText.inline(entry.text).characters))
                }
            default:
                continue
            }
        }
        guard let match = ReadAlong.Match(piece: piece, texts: texts) else { return nil }
        for (position, range) in match.ranges { ranges[keys[position]] = range }
    }

    /// The block's text, with the part being spoken lit up.
    static func text(_ source: String, block: Int, item: Int = 0, in readAlong: ReadAlongBlocks?) -> AttributedString {
        let text = MarkdownText.inline(source)
        guard let range = readAlong?.ranges[Key(block: block, item: item)] else { return text }
        var lit = text
        let characters = lit.characters
        guard range.upperBound <= characters.count else { return text }
        let start = characters.index(characters.startIndex, offsetBy: range.lowerBound)
        let end = characters.index(start, offsetBy: range.count)
        lit[start..<end].backgroundColor = Color.accentColor.opacity(0.22)
        return lit
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
            if let thread = try? await client.thread(id), client.baseURL == ServerScope.selectedURL { set(id, thread.displayTitle) }
        }
    }

    /// `@thread:thr_x` becomes `@Title` when the title is known.
    static func resolve(_ text: String) -> String {
        text.replacing(MarkdownRegex.threadMention) { match in
            titles[String(match.1)].map { "@" + $0 } ?? String(match.0)
        }
    }

    /// Mentioned threads whose titles haven't been seen yet.
    static func unknownMentions(in texts: [String]) -> Set<String> {
        Set(texts.flatMap { $0.matches(of: MarkdownRegex.threadMention).map { String($0.1) } })
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
    /// A page, drawing, table or design an agent put in its reply.
    case item(ReplyItem)
    /// A workspace or thread-storage file shown in the reply.
    case inlineVis(InlineVis)
    /// `![alt](src)`, shown below the text of its paragraph.
    case image(alt: String, src: String)

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
            if !paragraph.isEmpty { blocks.append(contentsOf: withImages(paragraph.joined(separator: "\n"))) }
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
                } else if let item = ReplyItem(directive) {
                    flush()
                    blocks.append(.item(item))
                } else if directive.name == "inline-vis" {
                    flush()
                    blocks.append(.inlineVis(InlineVis(directive)))
                }
            } else if let heading = trimmed.firstMatch(of: MarkdownRegex.heading) {
                flush()
                blocks.append(.heading(heading.1.count, String(heading.2)))
            } else if trimmed.wholeMatch(of: MarkdownRegex.rule) != nil {
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
            } else if let item = line.firstMatch(of: MarkdownRegex.listItem) {
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
                } else if let task = text.firstMatch(of: MarkdownRegex.task) {
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

    /// `![alt](src "title")`, with `<…>` around a src that has spaces.
    private static let imagePattern = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/

    /// A paragraph's text without its images, then the images.
    private static func withImages(_ text: String) -> [MarkdownBlock] {
        let images = text.matches(of: imagePattern).map {
            MarkdownBlock.image(alt: String($0.1), src: String($0.2 ?? $0.3 ?? ""))
        }
        guard !images.isEmpty else { return [.paragraph(text)] }
        let rest = text.replacing(imagePattern, with: "").replacing(MarkdownRegex.spaces, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        return (rest.isEmpty ? [] : [.paragraph(rest)]) + images
    }

    private static func isTableDivider(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces).wholeMatch(of: MarkdownRegex.tableDivider) != nil
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

    // A regex literal is parsed again every time it runs. Rows call this for
    // every line of every message on each render, so build them once and skip
    // lines that can't be directives: a long Bot chat hung the main thread
    // until the watchdog killed the app (0x8BADF00D in Regex.init).
    nonisolated(unsafe) private static let lineRegex = /::([A-Za-z][\w-]*)\{(.*)\}/
    nonisolated(unsafe) private static let pairRegex = /([\w-]+)="([^"]*)"/

    init?(line: String) {
        guard line.hasPrefix("::"), line.hasSuffix("}"), let match = line.wholeMatch(of: Self.lineRegex) else { return nil }
        name = String(match.1)
        var attributes: [String: String] = [:]
        for pair in match.2.matches(of: Self.pairRegex) {
            attributes[String(pair.1)] = String(pair.2)
        }
        self.attributes = attributes
    }

    /// The directive on the reply's last non-empty line, outside code blocks.
    static func last(in text: String) -> Directive? {
        var inCode = false
        var last: String?
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("```") { inCode.toggle() }
            if !trimmed.isEmpty { last = inCode ? nil : trimmed }
        }
        return last.flatMap(Directive.init(line:))
    }

    /// The last line can offer up to five short "emoji label" replies.
    static func reactions(in text: String) -> [String] {
        guard let directive = last(in: text), directive.name == "reactions",
            let raw = directive.attributes["items"] else { return [] }
        return parseReactions(raw)
    }

    /// Pages' Next row, `::next{reply="👍 Ship it" btw="🐛 I noticed …" do="📄 Write up the plan as a page"}`:
    /// quick replies, requests, and notes on what the agent noticed. Replies and
    /// requests draft as "emoji label". Notes (`btw`, or the older
    /// `explore="🐛 Label — why"`) show as written. Parsed as Pages' next.ts does.
    struct Next: Equatable {
        var reply: [String]
        var ask: [String]
        var notes: [Note] = []
        var isEmpty: Bool { reply.isEmpty && ask.isEmpty && notes.isEmpty }
    }

    /// A note back to the user: one or two sentences, with their emoji.
    struct Note: Equatable, Hashable {
        var emoji: String
        var text: String
        /// 🐛 notes look broken or risky, so they offer Fix this.
        var isBug: Bool { emoji == "🐛" }
    }

    static func next(in text: String) -> Next {
        guard let directive = last(in: text), directive.name == "next" else { return Next(reply: [], ask: []) }
        let notes = parseNotes(directive.attributes["btw"], max: 3)
        return Next(reply: parseNextItems(directive.attributes["reply"], max: 5),
            ask: parseNextItems(directive.attributes["do"], max: 3),
            notes: notes.isEmpty ? parseNotes(directive.attributes["explore"], max: 4) : notes)
    }

    /// `|`-separated notes: an optional emoji (🔎 without one) and up to 280
    /// characters of text, cut at a word. Repeats drop.
    static func parseNotes(_ raw: String?, max: Int) -> [Note] {
        guard let raw else { return [] }
        var seen = Set<String>()
        var notes: [Note] = []
        for part in String(raw.prefix(4_000)).components(separatedBy: "|") {
            guard let (emoji, rest) = splitEmoji(clean(part)) else { continue }
            let text = cutLabel(rest, max: 280)
            guard !text.isEmpty, seen.insert(text.lowercased()).inserted else { continue }
            notes.append(Note(emoji: emoji, text: text))
            if notes.count >= max { break }
        }
        return notes
    }

    /// Control characters, quotes and braces become spaces; runs of space collapse.
    private static func clean(_ part: String) -> String {
        let cleaned = String(String.UnicodeScalarView(part.unicodeScalars.map {
            $0.value < 0x20 || "\"{}".unicodeScalars.contains($0) ? " " : $0
        }))
        return cleaned.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// The leading emoji (🔎 when there's none) and the rest, or nil for an empty item.
    private static func splitEmoji(_ text: String) -> (String, String)? {
        guard let first = text.first else { return nil }
        guard isEmoji(first) else { return ("🔎", text) }
        return (String(first), text.dropFirst().trimmingCharacters(in: .whitespaces))
    }

    /// `|`-separated "emoji label" items, cleaned, capped and deduped by label.
    /// An item without an emoji gets 🔎; one without a label is dropped.
    static func parseNextItems(_ raw: String?, max: Int) -> [String] {
        guard let raw else { return [] }
        var seen = Set<String>()
        var items: [String] = []
        for part in String(raw.prefix(4_000)).components(separatedBy: "|") {
            guard let (emoji, rest) = splitEmoji(clean(part)) else { continue }
            let label = cutLabel(rest)
            guard !label.isEmpty, seen.insert(label.lowercased()).inserted else { continue }
            items.append("\(emoji) \(label)")
            if items.count >= max { break }
        }
        return items
    }

    /// Pictographs, flags and keycaps, but not a plain leading digit or `#`.
    private static func isEmoji(_ character: Character) -> Bool {
        guard let scalar = character.unicodeScalars.first, scalar.properties.isEmoji else { return false }
        if scalar.isASCII { return character.unicodeScalars.contains("\u{20E3}") }
        return true
    }

    /// A label is a line: longer ones are cut at a word, with an ellipsis.
    private static func cutLabel(_ label: String, max: Int = 80) -> String {
        guard label.utf16.count > max else { return label }
        var room = ""
        for character in label {
            if room.utf16.count + character.utf16.count > max - 1 { break }
            room.append(character)
        }
        if let space = room.lastIndex(of: " "), room.distance(from: room.startIndex, to: space) > max / 2 {
            room = String(room[..<space])
        }
        return room.trimmingCharacters(in: .whitespaces) + "…"
    }

    static func parseReactions(_ raw: String) -> [String] {
        var seen = Set<String>()
        return raw.components(separatedBy: "|")
            .map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
            .filter { item in
                guard !item.isEmpty, item.utf16.count <= 60 else { return false }
                let words = item.split(separator: " ", maxSplits: 1)
                return words.count == 2 && !words[1].isEmpty && seen.insert(item).inserted
            }
            .prefix(5).map { $0 }
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
        // The width sets the columns' cap, which can change the width: only
        // whole points, and only a real change, so it can't trade back and forth.
        .onGeometryChange(for: CGFloat.self) { $0.size.width.rounded() } action: { width in
            if abs(width - available) >= 1 { available = width }
        }
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

/// Regexes built once: a regex literal is parsed again each time it runs,
/// and these run for every line of every message on each render.
enum MarkdownRegex {
    nonisolated(unsafe) static let threadMention = /@thread:(thr_[A-Za-z0-9]+)/
    nonisolated(unsafe) static let heading = /^(#{1,6})\s+(.*)$/
    nonisolated(unsafe) static let rule = /^([-*_])(\s*\1){2,}$/
    nonisolated(unsafe) static let listItem = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
    nonisolated(unsafe) static let task = /^\[([ xX])\]\s+(.*)$/
    nonisolated(unsafe) static let spaces = /[ \t]{2,}/
    nonisolated(unsafe) static let tableDivider = /\|?(\s*:?-+:?\s*\|)+\s*(:?-+:?\s*)?/
}
