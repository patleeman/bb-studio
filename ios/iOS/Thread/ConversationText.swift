import Foundation

/// A Bot conversation's text as the phone shows it: status tokens (`[done]`)
/// dropped, BB's own messages as child cards, and plain previews.
enum ConversationText {
    static func clean(_ items: [TimelineItem]) -> [TimelineItem] {
        items.compactMap { item in
            guard case .message(var row) = item, row.kind == "conversation", !row.isPassReply, let text = row.text, text.contains("["),
                  text.components(separatedBy: "\n").contains(where: isStatusToken) else { return item }
            let kept = text.components(separatedBy: "\n").filter { !isStatusToken($0) }
            let joined = kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !joined.isEmpty || row.hasAttachments else { return nil }
            row.text = joined
            return .message(row)
        }
    }

    static func rows(_ rows: [ThreadTranscriptRow]) -> [ThreadTranscriptRow] {
        rows.compactMap { row in
            guard case .item(.message(let message), let state) = row else { return row }
            if let event = BotChatRows.childEvent(message) { return .child(event, id: message.id) }
            if state.relayed != nil { return row }
            return BotChatRows.shows(message) ? row : nil
        }
    }

    private static let statusTokens: Set<String> = ["pass", "fail", "failed", "done", "ok", "skip", "skipped", "noop"]

    static func isStatusToken(_ line: String) -> Bool {
        guard !line.isEmpty else { return false }
        let scalars = line.unicodeScalars
        var start = scalars.startIndex
        var end = scalars.endIndex
        func isTrim(_ s: Unicode.Scalar) -> Bool {
            s.properties.isWhitespace || s == "`" || s == "*" || s == "_" || s == "~"
        }
        while start < end, isTrim(scalars[start]) { scalars.formIndex(after: &start) }
        while end > start {
            let prev = scalars.index(before: end)
            guard isTrim(scalars[prev]) else { break }
            end = prev
        }
        guard start < end, scalars[start] == "[" else { return false }
        let last = scalars.index(before: end)
        guard last > start, scalars[last] == "]" else { return false }
        let inner = scalars[scalars.index(after: start)..<last]
        guard inner.count <= 8 else { return false }
        return statusTokens.contains(Substring(inner).lowercased())
    }

    static func plain(_ text: String) -> String {
        let kept = text.components(separatedBy: "\n").compactMap { raw -> String? in
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("::") || line.hasPrefix("```") || isStatusToken(line) { return nil }
            while line.hasPrefix("#") { line.removeFirst() }
            if line.hasPrefix("- ") || line.hasPrefix("* ") { line.removeFirst(2) }
            line = line.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "__", with: "").replacingOccurrences(of: "`", with: "")
            return line.trimmingCharacters(in: .whitespaces)
        }
        return kept.filter { !$0.isEmpty }.joined(separator: " ")
    }
}
