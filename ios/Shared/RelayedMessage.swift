import Foundation

public struct RelayedMessage: Hashable, Sendable {
    public enum Kind: String, Sendable { case agent, runner, automation, system, studio }

    public static let fallbackSender = "another conversation"
    public static let studioSender = "BB Studio"
    public static let summaryLimit = 100

    public var kind: Kind
    public var sender: String?
    public var senderThreadId: String?
    public var urgent = false
    public var body: String
    public var summary: String

    nonisolated(unsafe) private static let agentHeader = try! Regex(#"^\[bb message from thread:([^;\]\s]+)(?:;[^\]]*)?\]\s*"#)
    nonisolated(unsafe) private static let systemHeader = try! Regex(#"^\[bb system\]\s*"#)
    nonisolated(unsafe) private static let automationHeader = try! Regex(#"^\[bb automation due:([^\]\s]+)\]\s*"#)
    nonisolated(unsafe) private static let runnerLine = try! Regex(#"^(⚠️ )?From runner ([^:\n]+): "#)
    nonisolated(unsafe) private static let namedAutomation = try! Regex(#"^(?:Check-in|Reminder) "([^"\n]+)"(?: \([^)\n]*\))?: "#)
    nonisolated(unsafe) private static let leadTag = try! Regex(#"^[A-Z]{2,}(?:[ \t]+[a-z0-9][A-Za-z0-9_.-]*)?:[ \t]+"#)
    nonisolated(unsafe) private static let summaryMarkers = try! Regex(#"^\s*(?:>\s*|#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)+"#)
    nonisolated(unsafe) private static let summaryLinks = try! Regex(#"!?\[([^\]\n]*)\]\([^)\s]*\)"#)
    nonisolated(unsafe) private static let sentenceEnd = try! Regex(#"[.!?](?=\s)"#)

    private struct StudioLine {
        var pattern: Regex<AnyRegexOutput>
        var sender: (Regex<AnyRegexOutput>.Match) -> String
        var urgent = false
        var keepPrefix = false
    }

    nonisolated(unsafe) private static let studioLines: [StudioLine] = [
        StudioLine(pattern: try! Regex(#"^Watcher ([^:\n]+): "#), sender: { "watcher " + capture($0, 1) }),
        StudioLine(pattern: try! Regex(#"^🗓 [a-z][a-z ]* from \[([^\]\n]+)\]\(/threads/[^)\s]+\): "#), sender: { capture($0, 1) }),
        StudioLine(pattern: try! Regex(#"^📥 Handed to you: "#), sender: { _ in studioSender }, keepPrefix: true),
        StudioLine(pattern: try! Regex(#"^↻ Resumed after a restart$"#), sender: { _ in studioSender }, keepPrefix: true),
        StudioLine(pattern: try! Regex(#"^⚠️ "[^"\n]+" stopped again \("#), sender: { _ in studioSender }, urgent: true, keepPrefix: true),
        StudioLine(pattern: try! Regex(#"^⚠️ [^\n]+ is off: BB turned it off again \("#), sender: { _ in studioSender }, urgent: true, keepPrefix: true),
        StudioLine(pattern: try! Regex(#"^Maintenance: \d+ threads? needs? your call "#), sender: { _ in studioSender }, keepPrefix: true),
        StudioLine(pattern: try! Regex(#"^The reviewer checked (?:round \d+|the screens) of "[^"\n]+" and found problems:"#), sender: { _ in "design review" }, keepPrefix: true),
    ]

    private static func capture(_ match: Regex<AnyRegexOutput>.Match, _ index: Int) -> String {
        match.output.count > index ? match.output[index].substring.map(String.init) ?? "" : ""
    }

    private static func skipSpace(_ text: Substring) -> Substring {
        text.drop { $0.isWhitespace }
    }

    public static func summary(_ text: Substring) -> String {
        let line = text.split(omittingEmptySubsequences: false) { $0 == "\n" || $0 == "\r\n" }
            .first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map(String.init) ?? ""
        var plain = line.replacing(summaryMarkers, maxReplacements: 1) { _ in "" }
        plain = plain.replacing(summaryLinks) { capture($0, 1) }
        plain = plain.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "__", with: "").replacingOccurrences(of: "`", with: "")
        plain = plain.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        let sentence = plain.firstMatch(of: sentenceEnd).map { String(plain[..<$0.range.upperBound]) } ?? plain
        guard sentence.count > summaryLimit else { return sentence }
        let cut = String(sentence.prefix(summaryLimit - 1))
        var kept = cut
        if let space = cut.lastIndex(of: " "), cut.distance(from: cut.startIndex, to: space) > summaryLimit / 2 { kept = String(cut[..<space]) }
        return kept.replacingOccurrences(of: #"[\s,;:.]+$"#, with: "", options: .regularExpression) + "…"
    }

    private init(kind: Kind, sender: String?, senderThreadId: String? = nil, urgent: Bool = false, body: Substring, summaryFrom: Substring) {
        self.kind = kind
        self.sender = sender
        self.senderThreadId = senderThreadId
        self.urgent = urgent
        self.body = String(body).trimmingCharacters(in: .whitespacesAndNewlines)
        summary = Self.summary(Self.skipSpace(summaryFrom))
    }

    private static func studioLine(_ text: Substring) -> RelayedMessage? {
        if let runner = text.prefixMatch(of: runnerLine) {
            return RelayedMessage(kind: .runner, sender: "runner " + capture(runner, 2).trimmingCharacters(in: .whitespaces),
                                  urgent: runner.output[1].substring != nil, body: text, summaryFrom: text[runner.range.upperBound...])
        }
        for line in studioLines {
            guard let match = text.prefixMatch(of: line.pattern) else { continue }
            return RelayedMessage(kind: .studio, sender: line.sender(match), urgent: line.urgent, body: text,
                                  summaryFrom: line.keepPrefix ? text : text[match.range.upperBound...])
        }
        return nil
    }

    private static func body(_ body: Substring) -> RelayedMessage {
        if let line = studioLine(body) { return line }
        let start = body.prefixMatch(of: leadTag)?.range.upperBound ?? body.startIndex
        return RelayedMessage(kind: .agent, sender: nil, body: body, summaryFrom: body[start...])
    }

    public static func parse(_ text: String, initiator: String?) -> RelayedMessage? {
        guard !text.isEmpty else { return nil }
        let all = text[...]
        if let automation = all.prefixMatch(of: automationHeader) {
            let rest = all[automation.range.upperBound...]
            let named = rest.prefixMatch(of: namedAutomation)
            return RelayedMessage(kind: .automation, sender: named.map { capture($0, 1) } ?? "Automation", body: rest,
                                  summaryFrom: named.map { rest[$0.range.upperBound...] } ?? rest)
        }
        if initiator != "user" {
            if let agent = all.prefixMatch(of: agentHeader) {
                var message = body(all[agent.range.upperBound...])
                message.senderThreadId = capture(agent, 1)
                return message
            }
            if let system = all.prefixMatch(of: systemHeader) {
                let rest = all[system.range.upperBound...]
                return RelayedMessage(kind: .system, sender: studioSender, body: rest, summaryFrom: rest)
            }
        }
        if initiator == "agent" || initiator == "system" { return nil }
        return studioLine(all)
    }

    public static func of(_ row: TimelineRow) -> RelayedMessage? {
        guard row.isConversation, row.isUser, let text = row.text else { return nil }
        return parse(text, initiator: row.initiator)
    }

    public static func folds(_ message: RelayedMessage?, reply: String?) -> Bool {
        message != nil && SilentOutput.isPass(reply)
    }

    public func sender(title: String?) -> String {
        if let sender { return sender }
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? Self.fallbackSender : trimmed
    }

    public func line(title: String?) -> String {
        let sender = sender(title: title)
        return summary.isEmpty ? "From \(sender)" : "From \(sender) · \(summary)"
    }
}
