import Foundation

/// A `::loop{id="…"}` or `::work{id="…"}` line in an old reply, or an old
/// morning card's compact `::loop{id="…" row="1"}`. Personal to-dos are gone:
/// these render read-only, and `::loops{…}` ("N more in Todos", "open the
/// list") renders nothing.
enum LoopDirective: Equatable {
    case card(id: String)
    case row(id: String)

    init?(_ directive: Directive) {
        switch directive.name {
        case "loop", "work":
            guard let id = directive.attributes["id"]?.trimmingCharacters(in: .whitespaces),
                  (1...120).contains(id.utf8.count),
                  id.utf8.allSatisfy({
                      ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x41 && $0 <= 0x5A)
                          || ($0 >= 0x61 && $0 <= 0x7A) || $0 == 0x5F || $0 == 0x2D
                  }) else { return nil }
            let row = Int(directive.attributes["row"]?.trimmingCharacters(in: .whitespaces) ?? "").map { $0 >= 1 } ?? (directive.attributes["row"] == "true")
            self = directive.name == "loop" && row ? .row(id: id) : .card(id: id)
        default:
            return nil
        }
    }

    /// The loop directives in a reply, outside code blocks, in order.
    static func all(in text: String) -> [LoopDirective] {
        guard text.contains("::loop") || text.contains("::work") else { return [] }
        var inCode = false
        var found: [LoopDirective] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { inCode.toggle(); continue }
            if !inCode, trimmed.hasPrefix("::loop") || trimmed.hasPrefix("::work"), let directive = Directive(line: trimmed).flatMap(LoopDirective.init) {
                found.append(directive)
            }
        }
        return found
    }

    /// A morning card: compact rows make the whole reply one card.
    static func isMorning(_ directives: [LoopDirective]) -> Bool {
        directives.contains { if case .card = $0 { false } else { true } }
    }
}

/// How tasks say when: "Today", "Fri", "When Sam replies", "12 min".
enum LoopFormat {
    static func day(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: tomorrow) { return "Tomorrow" }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        if days > 0 && days < 7 { return date.formatted(.dateTime.weekday(.abbreviated)) }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    /// `reply:sam` → "When Sam replies"; other events by name.
    static func event(_ event: String) -> String {
        let parts = event.split(separator: ":", maxSplits: 1).map(String.init)
        if parts.count == 2, parts[0] == "reply" { return "When \(parts[1].capitalized) replies" }
        if parts.count == 2, parts[0] == "done" { return "When \(parts[1]) is done" }
        return "When \(event.replacingOccurrences(of: ":", with: " "))"
    }

    /// "12 min", "3 h", "2 d".
    static func since(_ date: Date, now: Date = .now) -> String {
        let minutes = max(1, Int(now.timeIntervalSince(date) / 60))
        if minutes < 60 { return "\(minutes) min" }
        if minutes < 24 * 60 { return "\(minutes / 60) h" }
        return "\(minutes / (24 * 60)) d"
    }
}
