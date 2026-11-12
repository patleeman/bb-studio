import Foundation

// A port of `speakable` in packages/bb-studio/src/voice/live/speakable.ts, so
// Siri's "Ask BB" and "Tell Bot" (Intents.swift) speak a reply the way Studio's
// hands-free voice does. It came from the old voice mode, removed on Nov 1.

/// Text as it should be heard: markdown marks, code and links reduced to words.
enum Speakable {
    private static let patterns: [(String, String, NSRegularExpression.Options)] = [
        // BB draws directives (::next{…}, ::page{…}) as cards and buttons; they aren't words.
        (#"^[ \t]*::[A-Za-z0-9_-]+\{[^\n]*\}[ \t]*$"#, "", [.anchorsMatchLines]),
        (#"::[A-Za-z0-9_-]+\{[^}\n]*\}"#, "", []),
        (#"<!--[\s\S]*?-->"#, "", []),
        (#"```[\s\S]*?```"#, " (code left out) ", []),
        (#"`([^`]+)`"#, "$1", []),
        (#"!\[[^\]]*\]\([^)]*\)"#, "", []),
        (#"\[([^\]]+)\]\([^)]*\)"#, "$1", []),
        (#"^\s{0,3}#{1,6}\s+"#, "", [.anchorsMatchLines]),
        (#"^\s*[-*+]\s+"#, "", [.anchorsMatchLines]),
        (#"^\s*\d+[.)]\s+"#, "", [.anchorsMatchLines]),
        (#"(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1"#, "$2", []),
        (#"^\s*>\s?"#, "", [.anchorsMatchLines]),
        (#"\|"#, " ", []),
        (#"[ \t]+"#, " ", []),
        (#"\n{2,}"#, "\n", []),
    ]

    private static let rules: [(NSRegularExpression, String)] = patterns.map { pattern, template, options in
        // swiftlint:disable:next force_try
        (try! NSRegularExpression(pattern: pattern, options: options), template)
    }

    static func text(_ markdown: String) -> String {
        var text = markdown
        for (regex, template) in rules {
            text = regex.stringByReplacingMatches(
                in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
