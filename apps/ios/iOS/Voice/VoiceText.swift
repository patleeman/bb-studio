import Foundation

// Ports of Studio's voice text rules, so the phone speaks and highlights
// exactly what the desktop does:
// - `Speakable` is `speakable` in packages/bb-studio/src/voice/instructions.ts.
// - `SpeechChunks` is `speechChunks` in packages/bb-studio/src/speech/chunks.ts.
// - `ReadAlong` is the letter matching of `findPiece` in src/voice/ui/read-along.ts.
// Lengths are counted in UTF-16 units, as JavaScript counts them.

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

/// Long text is spoken in pieces, cut at sentence ends, so the first piece
/// plays while the rest are still being made. The first piece is short to
/// start sooner; later ones are longer, which sounds more even.
enum SpeechChunks {
    static let firstMax = 200
    static let restMax = 600

    // swiftlint:disable force_try
    private static let sentence = try! NSRegularExpression(pattern: #"[^.!?…\n]+(?:[.!?…]+["')\]]*|\n+|$)"#)
    private static let lineBreaks = try! NSRegularExpression(pattern: #"\s*\n\s*"#)
    // swiftlint:enable force_try

    /// Sentences, keeping their end punctuation; a sentence with no break stays whole.
    static func sentences(_ text: String) -> [String] {
        let ns = text as NSString
        return sentence.matches(in: text, range: NSRange(location: 0, length: ns.length))
            .map { trim(ns.substring(with: $0.range)) }
            .filter { !$0.isEmpty }
    }

    /// Cut an over-long sentence at commas or spaces.
    static func cut(_ sentence: String, max: Int) -> [String] {
        var pieces: [String] = []
        var rest = sentence as NSString
        let third = Double(max) / 3
        while rest.length > max {
            let window = rest.substring(to: max) as NSString
            let at = [", ", "; ", ": "].map { last(window, $0) }.max() ?? -1
            let space = last(window, " ")
            let end = Double(at) > third ? at + 1 : Double(space) > third ? space : max
            pieces.append(trim(rest.substring(to: end)))
            rest = trim(rest.substring(from: end)) as NSString
        }
        if rest.length > 0 { pieces.append(rest as String) }
        return pieces
    }

    static func split(_ text: String) -> [String] {
        var chunks: [String] = []
        var current = ""
        func max() -> Int { chunks.isEmpty ? firstMax : restMax }
        let joined = lineBreaks.stringByReplacingMatches(
            in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: "\n")
        for sentence in sentences(joined) {
            for piece in cut(sentence, max: max()) {
                let length = (current as NSString).length
                if !current.isEmpty, length + 1 + (piece as NSString).length > max() {
                    chunks.append(current)
                    current = piece
                } else {
                    current = current.isEmpty ? piece : "\(current) \(piece)"
                }
            }
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    private static func last(_ string: NSString, _ needle: String) -> Int {
        let found = string.range(of: needle, options: .backwards)
        return found.location == NSNotFound ? -1 : found.location
    }

    /// JavaScript's `trim`: whitespace and line breaks at both ends.
    private static func trim(_ string: String) -> String {
        string.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// What voice mode puts in the composer and sends.
enum VoiceText {
    /// Sent, unseen by the user, with each message voice mode sends: instructions
    /// only reach a running session at its next start. `VOICE_TURN_NOTE` in instructions.ts.
    static let turnNote = "Voice mode is on: the user spoke this and will hear your reply. Answer conversationally, in a few short spoken sentences, with no markdown, lists or code."

    /// What was typed, then what was said, with one space between (desktop `joinText`).
    static func join(typed: String, heard: String) -> String {
        if heard.isEmpty { return typed }
        if typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return heard }
        return typed.last?.isWhitespace == true ? typed + heard : typed + " " + heard
    }

    /// The pill's speed button steps through these, back to 1 after the fastest.
    static let speeds: [Double] = [1, 1.25, 1.5, 1.75, 2]

    static func nextSpeed(after speed: Double) -> Double {
        speeds.first { $0 > speed + 0.001 } ?? speeds[0]
    }

    /// "1.25×", "2×".
    static func speedLabel(_ speed: Double) -> String {
        let formatted = speed.formatted(.number.precision(.fractionLength(0...2)))
        return "\(formatted)×"
    }
}

/// Read-along: finds the piece being spoken inside a message's text, by its
/// letters and digits only, lowercased, since what's spoken had its markdown taken out.
enum ReadAlong {
    /// How many letters at each end of a piece anchor the match.
    static let anchor = 24

    static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
            .decimalNumber, .letterNumber, .otherNumber:
            true
        default:
            false
        }
    }

    static func fold(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
        String(scalar).lowercased().unicodeScalars.first ?? scalar
    }

    /// One folded scalar per letter or digit in `text`.
    static func letters(_ text: String) -> [Unicode.Scalar] {
        text.unicodeScalars.filter(isLetter).map(fold)
    }

    /// Where `piece` is inside `letters` (from `letters(_:)`), as letter positions; nil when it isn't there.
    /// Like the desktop: the last place its opening letters appear, through its closing letters.
    static func span(of piece: String, in letters: [Unicode.Scalar]) -> Range<Int>? {
        let needle = Self.letters(piece)
        guard !needle.isEmpty, !letters.isEmpty else { return nil }
        let head = Array(needle.prefix(anchor))
        guard let start = lastIndex(of: head, in: letters) else { return nil }
        let tail = Array(needle.suffix(anchor))
        let end: Int
        if let tailAt = firstIndex(of: tail, in: letters, from: start), tailAt - start < needle.count + 200 {
            end = tailAt + tail.count
        } else {
            end = min(letters.count, start + needle.count)
        }
        return start..<end
    }

    private static func lastIndex(of needle: [Unicode.Scalar], in haystack: [Unicode.Scalar]) -> Int? {
        guard needle.count <= haystack.count else { return nil }
        for start in stride(from: haystack.count - needle.count, through: 0, by: -1)
        where haystack[start..<(start + needle.count)].elementsEqual(needle) {
            return start
        }
        return nil
    }

    private static func firstIndex(of needle: [Unicode.Scalar], in haystack: [Unicode.Scalar], from: Int) -> Int? {
        guard needle.count <= haystack.count, from <= haystack.count - needle.count else { return nil }
        for start in from...(haystack.count - needle.count)
        where haystack[start..<(start + needle.count)].elementsEqual(needle) {
            return start
        }
        return nil
    }

    /// Whether `text` holds `piece` (its opening letters).
    static func contains(_ text: String, piece: String) -> Bool {
        span(of: piece, in: letters(text)) != nil
    }

    /// The characters of `text` that hold the letters in `range`, as character
    /// offsets, when `text`'s first letter is letter number `base`. Nil when none do.
    static func characterRange(in text: String, letters range: Range<Int>, base: Int = 0) -> Range<Int>? {
        var letter = base
        var first: Int?
        var last: Int?
        for (offset, character) in text.enumerated() {
            let count = character.unicodeScalars.filter(isLetter).count
            guard count > 0 else { continue }
            if (letter..<(letter + count)).overlaps(range) {
                if first == nil { first = offset }
                last = offset
            }
            letter += count
        }
        guard let first, let last else { return nil }
        return first..<(last + 1)
    }

    /// The piece's place among several texts shown one after another (a
    /// message's paragraphs, headings and list items), and each text's part of it.
    struct Match: Equatable {
        /// Character offsets to light up, by the text's position in the list.
        var ranges: [Int: Range<Int>]

        init?(piece: String, texts: [String]) {
            var all: [Unicode.Scalar] = []
            var bases: [Int] = []
            for text in texts {
                bases.append(all.count)
                all += ReadAlong.letters(text)
            }
            guard let span = ReadAlong.span(of: piece, in: all) else { return nil }
            var ranges: [Int: Range<Int>] = [:]
            for (index, text) in texts.enumerated() {
                if let range = ReadAlong.characterRange(in: text, letters: span, base: bases[index]) { ranges[index] = range }
            }
            self.ranges = ranges
        }
    }
}

/// Studio's "studio-voice" realtime signal: a voice thread's reply is ready to play.
/// `VoiceSpoken` in packages/bb-studio/src/voice/shared.ts.
struct VoiceSpoken: Equatable {
    static let channel = "studio-voice"

    var threadId: String
    var text: String
    /// Audio URLs for the reply's pieces, in order, relative to the server.
    var urls: [String]
    /// The text of each piece, to light it up as it plays.
    var pieces: [String]
    /// Why it can't be spoken, when it can't.
    var problem: String?

    init?(_ payload: JSONValue) {
        guard let threadId = payload["threadId"]?.stringValue else { return nil }
        self.threadId = threadId
        text = payload["text"]?.stringValue ?? ""
        urls = payload["urls"]?.arrayValue?.compactMap(\.stringValue) ?? []
        pieces = payload["pieces"]?.arrayValue?.compactMap(\.stringValue) ?? []
        problem = payload["problem"]?.stringValue
    }

    init(threadId: String, text: String = "", urls: [String], pieces: [String] = [], problem: String? = nil) {
        self.threadId = threadId
        self.text = text
        self.urls = urls
        self.pieces = pieces
        self.problem = problem
    }
}

enum SpeechURL {
    /// Studio hands out audio URLs relative to the server (`/api/v1/plugins/studio/http/speech/audio?key=…`).
    static func resolve(_ url: String, against base: URL) -> URL? {
        if let absolute = URL(string: url), absolute.scheme != nil { return absolute }
        return URL(string: url, relativeTo: base)?.absoluteURL
    }
}
