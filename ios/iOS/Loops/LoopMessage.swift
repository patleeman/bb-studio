import SwiftUI

/// An old Bot reply with loop cards. Its text stays in bubbles and each
/// `::loop{id}` or `::work{id}` line becomes a read-only card between them. A
/// reply with compact rows (`row="1"`) is the morning card, drawn as one card.
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
                    case .card(let id): TaskCard(id: id)
                    }
                }
            }
        }
    }
}

/// An old morning card: the date, Calendar, On today's list (compact rows,
/// read-only) and Good to know, as one card.
struct MorningCard: View {
    let text: String

    struct Section: Equatable {
        var title: String
        var lines: [Line]
    }

    enum Line: Equatable {
        /// A calendar line: its time and what.
        case event(time: String?, text: String)
        case loop(String)
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
                MorningSection(section: section)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morning-card")
    }
}

private struct MorningSection: View {
    let section: MorningCard.Section

    private var lines: [MorningCard.Line] { section.lines }

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
                case .text(let text):
                    Text(MarkdownText.inline(text))
                }
            }
        }
        .padding(16)
    }
}

/// An old morning card's compact row: icon, title and when. A tap opens its
/// read-only card.
struct LoopRowLine: View {
    let id: String

    var body: some View {
        TaskRowLine(id: id)
    }

    static func trailing(_ task: TaskItem) -> String? {
        if task.isClosed { return "Done" }
        switch task.kind {
        case .decide: return "\(task.options.count) options"
        case .read: return "Read"
        default: return task.due.map { LoopFormat.day($0) }
        }
    }

    static func symbol(_ task: TaskItem) -> String {
        switch task.kind {
        case .do: "checkmark.circle"
        case .decide: "arrow.triangle.branch"
        case .read: "book"
        case .waitingOutside: "hourglass"
        }
    }
}

private struct TaskRowLine: View {
    let id: String
    @State private var model = TasksModel.shared
    @State private var open = false
    @State private var retrying = false

    var body: some View {
        let task = model.task(id)
        Group {
            if task == nil, !retrying, let failure = model.failures[id] {
                MorningRowFailure(message: failure) { retry() }
            } else {
                Button { open = true } label: {
                    MorningRowLabel(symbol: task.map(LoopRowLine.symbol), title: task?.title, closed: task?.isClosed == true,
                                    trailing: task.flatMap(LoopRowLine.trailing))
                }
                .buttonStyle(.plain)
                .disabled(task == nil)
                .accessibilityLabel(task.map { [$0.title, LoopRowLine.trailing($0)].compactMap { $0 }.joined(separator: ", ") } ?? "Loading a todo")
                .accessibilityIdentifier("loop-row")
                .sheet(isPresented: $open) {
                    ScrollView { TaskCard(id: id).padding() }
                        .presentationDetents([.medium, .large])
                }
            }
        }
        .task { if model.task(id) == nil { await model.load(id) } }
    }

    private func retry() {
        retrying = true
        Task {
            await model.load(id)
            retrying = false
        }
    }
}

private struct MorningRowLabel: View {
    let symbol: String?
    let title: String?
    let closed: Bool
    let trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol ?? "circle.dotted")
                .foregroundStyle(.secondary)
            Text(title ?? "…")
                .strikethrough(closed)
                .foregroundStyle(closed ? .secondary : .primary)
                .lineLimit(2)
                .layoutPriority(1)
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing).foregroundStyle(trailing == "Today" ? Color.accentColor : .secondary)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .contentShape(.rect)
    }
}

private struct MorningRowFailure: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text("Couldn't load this todo")
                Text(message).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }
            .layoutPriority(1)
            Spacer(minLength: 8)
            Button("Retry", action: retry)
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
                .accessibilityIdentifier("loop-row-retry")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("loop-row-failed")
    }
}
