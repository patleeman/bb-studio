import Foundation

/// A page as its top-level blocks, from Studio's editable Markdown, where a
/// `<!-- ^1a2b3c4d -->` line names each block before it. Comments anchor to
/// blocks, so the page draws block by block: a block's comment marks sit
/// beside it, and a comment's thread scrolls to it.
struct PageBlock: Identifiable, Equatable {
    /// The block's short id (8 hex), or `#<n>` for text before the first id.
    let id: String
    /// Ids of the blocks inside it (a list item's children, a toggle's body): their comments show here.
    var nested: [String]
    var markdown: String
    /// A list item: the next one sits tight under it, as in one list.
    var isListItem: Bool

    func contains(_ blockId: String?) -> Bool {
        guard let blockId else { return false }
        let short = PageDocument.shortId(blockId)
        return id == short || nested.contains(short)
    }
}

enum PageDocument {
    private final class Box {
        let blocks: [PageBlock]
        init(_ blocks: [PageBlock]) { self.blocks = blocks }
    }

    nonisolated(unsafe) private static let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 50
        return cache
    }()
    nonisolated(unsafe) private static let listRegex = /\s{0,3}(?:[-*+]|\d+[.)])\s.*/

    /// Studio's short block id (markdown.ts `shortId`): the id without dashes, its first 8 characters.
    static func shortId(_ id: String) -> String {
        String(id.replacingOccurrences(of: "-", with: "").prefix(8))
    }

    static func parse(_ source: String) -> [PageBlock] {
        if let hit = cache.object(forKey: source as NSString) { return hit.blocks }
        let blocks = parseUncached(source)
        cache.setObject(Box(blocks), forKey: source as NSString)
        return blocks
    }

    /// Splits at id lines outside code fences and toggles, at no indent; ids
    /// indented or inside a toggle belong to the block around them.
    private static func parseUncached(_ source: String) -> [PageBlock] {
        var blocks: [PageBlock] = []
        var current: (id: String, nested: [String], lines: [String])?
        var fence: String?
        var toggles = 0

        func flush() {
            guard let block = current else { return }
            current = nil
            let markdown = block.lines.joined(separator: "\n").trimmingCharacters(in: .newlines)
            guard !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            let first = markdown.split(separator: "\n").first.map(String.init) ?? ""
            blocks.append(PageBlock(id: block.id, nested: block.nested, markdown: markdown,
                                    isListItem: first.wholeMatch(of: listRegex) != nil))
        }

        for line in source.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let open = fence {
                if trimmed.hasPrefix(open) { fence = nil }
                current?.lines.append(line)
                continue
            }
            if let match = line.wholeMatch(of: PageSegment.blockIdRegex) {
                let id = String(match.1)
                if toggles == 0, line.first == "<" {
                    flush()
                    current = (id, [], [])
                } else {
                    current?.nested.append(id)
                }
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { fence = String(trimmed.prefix(3)) }
            let lower = trimmed.lowercased()
            toggles = max(0, toggles + lower.components(separatedBy: "<details").count - lower.components(separatedBy: "</details").count)
            if current == nil { current = ("#\(blocks.count)", [], []) }
            current?.lines.append(line)
        }
        flush()
        return blocks
    }

    /// The page's image sources in reading order, for the lightbox to step through.
    static func images(_ source: String) -> [String] {
        source.matches(of: /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/).map { String($0.1 ?? $0.2 ?? "") }
    }
}
