import Foundation

/// An agent with nothing to say replies exactly `[PASS]` (providers won't end a
/// turn with no text). Such a reply is silent: no preview, a faint "Passed" in a
/// thread, hidden in a Bot's chat. Mirrors Studio's isPassOutput helper;
/// see docs/silent-output.md.
public enum SilentOutput {
    public static func isPass(_ text: String?) -> Bool {
        guard let text else { return false }
        return text.range(of: #"^[\s`*_~]*\[pass\][\s`*_~]*$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

extension TimelineRow {
    /// The assistant's `[PASS]`: it had nothing to say.
    public var isPassReply: Bool { isConversation && !isUser && !hasAttachments && SilentOutput.isPass(text) }
}
