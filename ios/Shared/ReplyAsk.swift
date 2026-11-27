import Foundation

/// A reply that needs the user, marked in place in its newest message
/// (`strands.tags` replies; desktop's `ask-mark.ts`): its asking sentence gets
/// a faint amber highlight, or its last paragraph when Jev named no sentence.
/// Jump to reply (the strands box) flashes it.
public struct ReplyAskMark: Equatable, Sendable {
    /// The asking sentence; nil marks the reply's last paragraph.
    public var ask: String?
    /// The reply's message.
    public var seq: Double
    /// Jump to reply: flashing now.
    public var flash: Bool

    public init(ask: String?, seq: Double, flash: Bool = false) {
        self.ask = ask
        self.seq = seq
        self.flash = flash
    }
}

public enum ReplyAsk {
    /// Where `ask` is in a message's shown text, given as its text blocks in
    /// order (markdown already rendered away): whitespace folded, a sentence
    /// cut with "…" matched by its start, and the last match, so a quote of
    /// the sentence earlier in the reply isn't it. Each block it covers, with
    /// the character range in that block. Nil when it isn't there: no mark is
    /// better than a wrong one.
    public static func find(_ ask: String, in blocks: [String]) -> [Int: Range<Int>]? {
        var want = ask.trimmingCharacters(in: .whitespacesAndNewlines)
        if want.hasSuffix("…") { want.removeLast() }
        let wanted = fold(want)
        guard !wanted.isEmpty else { return nil }
        // The blocks' text flattened as it shows, each kept character mapped back to its block and offset.
        var flat: [Character] = []
        var map: [(block: Int, offset: Int)] = []
        var space = true
        for (block, text) in blocks.enumerated() {
            if !space {
                flat.append(" ")
                map.append((block, text.count))
                space = true
            }
            for (offset, character) in text.enumerated() {
                if character.isWhitespace {
                    if space { continue }
                    flat.append(" ")
                    space = true
                } else {
                    flat.append(character)
                    space = false
                }
                map.append((block, offset))
            }
        }
        let needle = Array(wanted)
        guard needle.count <= flat.count else { return nil }
        var at = flat.count - needle.count
        while at >= 0 {
            if flat[at] == needle[0], Array(flat[at..<(at + needle.count)]) == needle { break }
            at -= 1
        }
        guard at >= 0 else { return nil }
        var ranges: [Int: Range<Int>] = [:]
        for index in at..<(at + needle.count) {
            let (block, offset) = map[index]
            guard offset < blocks[block].count else { continue }
            if let range = ranges[block] {
                ranges[block] = min(range.lowerBound, offset)..<max(range.upperBound, offset + 1)
            } else {
                ranges[block] = offset..<(offset + 1)
            }
        }
        return ranges.isEmpty ? nil : ranges
    }

    /// Runs of whitespace as one space, ends trimmed.
    static func fold(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
