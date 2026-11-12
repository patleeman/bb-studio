import Foundation

/// A `::loop{id="…"}` line in a reply, or a morning card's compact
/// `::loop{id="…" row="1"}`; `::loops{more="N"}` is "N more in Todos".
enum LoopDirective: Equatable {
    case card(id: String)
    case row(id: String)
    case more(Int)

    init?(_ directive: Directive) {
        switch directive.name {
        case "loop":
            guard let id = directive.attributes["id"]?.trimmingCharacters(in: .whitespaces),
                  id.wholeMatch(of: /[A-Za-z0-9_-]{1,80}/) != nil else { return nil }
            self = ["1", "true"].contains(directive.attributes["row"] ?? "") ? .row(id: id) : .card(id: id)
        case "loops":
            guard let more = directive.attributes["more"].flatMap({ Int($0.trimmingCharacters(in: .whitespaces)) }), more > 0 else { return nil }
            self = .more(more)
        default:
            return nil
        }
    }

    /// The loop directives in a reply, outside code blocks, in order.
    static func all(in text: String) -> [LoopDirective] {
        guard text.contains("::loop") else { return [] }
        var inCode = false
        var found: [LoopDirective] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { inCode.toggle(); continue }
            if !inCode, trimmed.hasPrefix("::loop"), let directive = Directive(line: trimmed).flatMap(LoopDirective.init) {
                found.append(directive)
            }
        }
        return found
    }

    /// A morning card: compact rows or "+N more" make the whole reply one card.
    static func isMorning(_ directives: [LoopDirective]) -> Bool {
        directives.contains { if case .card = $0 { false } else { true } }
    }
}

/// How loops say when: "Today", "Fri", "Fri 3:00 PM", "When you get home".
enum LoopFormat {
    static func day(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: tomorrow) { return "Tomorrow" }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        if days > 0 && days < 7 { return date.formatted(.dateTime.weekday(.abbreviated)) }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    static func dayAndTime(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        return "\(day(date, now: now, calendar: calendar)) \(time)"
    }

    /// What it waits for, for Coming up: "Fri 3:00 PM", "When Sam replies".
    static func trigger(_ trigger: LoopItem.Trigger, now: Date = .now) -> String {
        switch trigger {
        case .none: return "At the next good moment"
        case .time(let date): return dayAndTime(date, now: now)
        case .event(let event): return Self.event(event)
        case .place(let place, let arrive):
            let name = place.lowercased()
            if name == "home" { return arrive ? "When you get home" : "When you leave home" }
            let shown = ["office", "gym"].contains(name) ? "the \(name)" : place.capitalized
            return arrive ? "When you arrive at \(shown)" : "When you leave \(shown)"
        }
    }

    /// `reply:sam` → "When Sam replies"; other events by name.
    static func event(_ event: String) -> String {
        let parts = event.split(separator: ":", maxSplits: 1).map(String.init)
        if parts.count == 2, parts[0] == "reply" { return "When \(parts[1].capitalized) replies" }
        if parts.count == 2, parts[0] == "done" { return "When \(parts[1]) is done" }
        return "When \(event.replacingOccurrences(of: ":", with: " "))"
    }

    /// The SF Symbol for what releases it.
    static func triggerSymbol(_ trigger: LoopItem.Trigger) -> String {
        switch trigger {
        case .none: "calendar"
        case .time: "clock"
        case .event: "bolt"
        case .place(let place, _): place.lowercased() == "home" ? "house" : "mappin.and.ellipse"
        }
    }

    static func kindSymbol(_ kind: LoopItem.Kind) -> String {
        switch kind {
        case .do: "checkmark.circle"
        case .decide: "arrow.triangle.branch"
        case .read: "book"
        case .waiting: "hourglass"
        }
    }

    static func kindLabel(_ kind: LoopItem.Kind) -> String {
        switch kind {
        case .do: "Do"
        case .decide: "Decide"
        case .read: "Read"
        case .waiting: "Waiting"
        }
    }

    /// The card's top line: "Do · Email", "Decide · 2 options", "Waiting · Since Tue".
    static func header(_ loop: LoopItem) -> String {
        var parts = [kindLabel(loop.kind)]
        if loop.kind == .decide, loop.options.count > 1 { parts.append("\(loop.options.count) options") }
        else if let source = loop.source?.kind, !source.isEmpty { parts.append(source.prefix(1).uppercased() + source.dropFirst()) }
        else if let area = loop.area { parts.append(area) }
        return parts.joined(separator: " · ")
    }

    /// The card's corner: when it's due, or how long you've waited.
    static func corner(_ loop: LoopItem, now: Date = .now) -> String? {
        if loop.kind == .waiting { return "Since \(day(loop.createdAt, now: now))" }
        guard let due = loop.due else { return nil }
        let label = day(due, now: now)
        return label == "Today" ? label : "Due \(label)"
    }

    /// "12 min", "3 h", "2 d".
    static func since(_ date: Date, now: Date = .now) -> String {
        let minutes = max(1, Int(now.timeIntervalSince(date) / 60))
        if minutes < 60 { return "\(minutes) min" }
        if minutes < 24 * 60 { return "\(minutes / 60) h" }
        return "\(minutes / (24 * 60)) d"
    }

    /// Discuss: the loop's card line and title, drafted in the Bot chat for
    /// your question. The Bot reads the line as "this loop is the topic" and
    /// looks it up with loops_get; the same text a desktop row drags in.
    static func discussDraft(_ loop: LoopItem) -> String {
        let title = loop.title.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return "::loop{id=\"\(loop.id)\"}\nAbout: \(title)\n"
    }

    /// The nudge drafted for the Chief of Staff, for you to send.
    static func nudgeDraft(_ loop: LoopItem) -> String {
        "Draft a nudge about “\(loop.title)” for me to approve. Don't send it yet."
    }
}
