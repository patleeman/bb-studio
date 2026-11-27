import Foundation

/// An agent with nothing to say replies exactly `[PASS]` (providers won't end a
/// turn with no text). Such a reply is silent: no preview, a faint "Passed" in a
/// thread, hidden in a Bot's chat. Mirrors Studio's isPassOutput helper;
/// see docs/silent-output.md.
public enum SilentOutput {
    public static func isPass(_ text: String?) -> Bool {
        guard let text, !text.isEmpty else { return false }
        let scalars = text.unicodeScalars
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
        let slice = scalars[start..<end]
        guard slice.count == 6 else { return false }
        return Substring(slice).lowercased() == "[pass]"
    }
}

extension TimelineRow {
    /// The assistant's `[PASS]`: it had nothing to say.
    public var isPassReply: Bool { isConversation && !isUser && !hasAttachments && SilentOutput.isPass(text) }
}

extension TimelineRow {
    public var isQuietThought: Bool {
        guard systemKind == "operation", operationKind == "reasoning", status != "pending" else { return false }
        if (detail ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
        if let startedAt, let createdAt, createdAt - startedAt < 1000 { return true }
        return false
    }
}
