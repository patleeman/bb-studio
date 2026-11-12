import SwiftUI

/// A Bot reply with loop cards. Its text stays in bubbles and each
/// `::loop{id}` line becomes a card of its own between them. A reply with
/// compact rows (`row="1"`) or `::loops{more}` is the morning card, drawn
/// as one card.
struct LoopMessage: View {
    let text: String
    /// Draws a text part in the reply's bubble.
    let bubble: (String) -> AnyView

    enum Part: Equatable {
        case text(String)
        case card(String)
    }

    /// Splits a reply into its text and its cards, in order.
    static func parts(_ text: String) -> [Part] {
        var parts: [Part] = []
        var lines: [String] = []
        var inCode = false
        func flush() {
            let joined = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !joined.isEmpty { parts.append(.text(joined)) }
            lines = []
        }
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { inCode.toggle() }
            if !inCode, case .card(let id)? = Directive(line: trimmed).flatMap(LoopDirective.init) {
                flush()
                parts.append(.card(id))
            } else {
                lines.append(line)
            }
        }
        flush()
        return parts
    }

    var body: some View {
        if LoopDirective.isMorning(LoopDirective.all(in: text)) {
            MorningCard(text: text)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(Self.parts(text).enumerated()), id: \.offset) { _, part in
                    switch part {
                    case .text(let text): bubble(text)
                    case .card(let id): LoopCard(id: id)
                    }
                }
            }
        }
    }
}

/// The morning card: the date, Calendar, On today's list (compact loop rows
/// and "N more in Todos") and Good to know, as one card.
struct MorningCard: View {
    let text: String
    @State private var model = LoopsModel.shared

    struct Section: Equatable {
        var title: String
        var lines: [Line]
    }

    enum Line: Equatable {
        /// A calendar line: its time and what.
        case event(time: String?, text: String)
        case loop(String)
        case more(Int)
        case text(String)
    }

    /// The heading and its sections, from the message's shape (backend.md, Morning card).
    static func parse(_ text: String) -> (title: String?, sections: [Section]) {
        var title: String?
        var sections: [Section] = []
        for raw in text.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if title == nil, sections.isEmpty, line.hasPrefix("#") {
                title = line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
                continue
            }
            if line.hasPrefix("**"), line.hasSuffix("**"), line.count > 4 {
                sections.append(Section(title: String(line.dropFirst(2).dropLast(2)), lines: []))
                continue
            }
            if sections.isEmpty { sections.append(Section(title: "", lines: [])) }
            if let directive = Directive(line: line).flatMap(LoopDirective.init) {
                switch directive {
                case .row(let id), .card(let id): sections[sections.count - 1].lines.append(.loop(id))
                case .more(let count): sections[sections.count - 1].lines.append(.more(count))
                }
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                let item = String(line.dropFirst(2))
                let pieces = item.components(separatedBy: " · ")
                if sections[sections.count - 1].title.lowercased() == "calendar", pieces.count > 1 {
                    sections[sections.count - 1].lines.append(.event(time: pieces[0], text: pieces.dropFirst().joined(separator: " · ")))
                } else {
                    sections[sections.count - 1].lines.append(.text(item))
                }
            } else if !line.hasPrefix("::") {
                sections[sections.count - 1].lines.append(.text(line))
            }
        }
        return (title, sections.filter { !$0.lines.isEmpty })
    }

    var body: some View {
        let parsed = Self.parse(text)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "sun.max")
                Text(parsed.title ?? "This morning").font(.title3.weight(.semibold))
                Spacer()
            }
            .padding(16)
            ForEach(Array(parsed.sections.enumerated()), id: \.offset) { _, section in
                Divider()
                MorningSection(section: section, off: model.enabled == false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morning-card")
        .task {
            await model.checkEnabled()
            if model.enabled == true { await model.refreshList() }
        }
    }
}

private struct MorningSection: View {
    let section: MorningCard.Section
    /// The Attention Router is off: its loops give way to one quiet line.
    let off: Bool
    @EnvironmentObject private var app: AppModel

    private var lines: [MorningCard.Line] {
        guard off else { return section.lines }
        let kept = section.lines.filter { if case .loop = $0 { false } else if case .more = $0 { false } else { true } }
        return kept.count == section.lines.count ? kept : kept + [.text("")]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !section.title.isEmpty {
                Text(section.title.uppercased()).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                    .accessibilityAddTraits(.isHeader)
            }
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                switch line {
                case .event(let time, let text):
                    HStack(alignment: .firstTextBaseline, spacing: 16) {
                        Text(time ?? "").foregroundStyle(.secondary).frame(minWidth: 72, alignment: .leading)
                        Text(MarkdownText.inline(text))
                    }
                case .loop(let id):
                    LoopRowLine(id: id)
                case .more(let count):
                    LoopsMoreLink(count: count)
                case .text(let text):
                    if text.isEmpty { LoopOffPlaceholder() } else { Text(MarkdownText.inline(text)) }
                }
            }
        }
        .padding(16)
    }
}

/// A morning card's compact loop: icon, title and when. A tap opens its card.
struct LoopRowLine: View {
    let id: String
    @State private var model = LoopsModel.shared
    @State private var open = false

    var body: some View {
        let loop = model.detail(id)?.loop
        Button { open = true } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: loop.map { LoopFormat.kindSymbol($0.kind) } ?? "circle.dotted")
                    .foregroundStyle(.secondary)
                Text(loop?.title ?? "…")
                    .strikethrough(loop?.isClosed == true)
                    .foregroundStyle(loop?.isClosed == true ? .secondary : .primary)
                    .lineLimit(2)
                    .layoutPriority(1)
                Spacer(minLength: 8)
                if let loop, let trailing = Self.trailing(loop) {
                    Text(trailing).foregroundStyle(trailing == "Today" ? Color.accentColor : .secondary)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(model.enabled != true)
        .sheet(isPresented: $open) {
            ScrollView { LoopCard(id: id).padding() }
                .presentationDetents([.medium, .large])
        }
        .task(id: model.enabled) {
            if model.enabled == true, model.detail(id) == nil { await model.load(id) }
        }
    }

    static func trailing(_ loop: LoopItem) -> String? {
        if loop.isClosed { return "Done" }
        switch loop.kind {
        case .decide: return "\(loop.options.count) options"
        case .read: return "Read"
        default: return loop.due.map { LoopFormat.day($0) }
        }
    }
}

/// "3 more in Todos ›": opens the Todos screen.
struct LoopsMoreLink: View {
    let count: Int
    @EnvironmentObject private var app: AppModel

    var body: some View {
        Button { app.openLoops() } label: {
            HStack(spacing: 12) {
                Image(systemName: "list.bullet.indent")
                Text("\(count) more in Todos")
                Spacer()
                Image(systemName: "chevron.right")
            }
            .foregroundStyle(Color.accentColor)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("morning-more")
    }
}
