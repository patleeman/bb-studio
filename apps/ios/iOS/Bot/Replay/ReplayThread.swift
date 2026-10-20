#if DEBUG
import Foundation

/// `-qaReplayThread <name>` (with `-qaBotDemo chat -qaDemoLatency <ms>`):
/// the served demo Bot's chat becomes a recorded real thread's shape, from
/// `<name>.qa.json` beside this file, and a send streams a long turn shaped
/// like the real ones. Debug builds only; the fixtures stay out of release.
///
/// A fixture is structure only, never content: the real rows' kinds and
/// order (messages, BB's system messages, reasoning, commands, file reads,
/// tools, `::next` and `::page` lines), their lengths, line counts and
/// Markdown, with every word replaced by lorem ipsum of the same length,
/// links pointed at example.com, ids and paths made up, and times kept
/// relative to the newest row. `chief-of-staff` is the Chief of Staff Bot's
/// last 497 rows (15 of BB's pages of 8 turns). `-qaReplayRepeat <n>` lays
/// it end to end n times, for a longer chat.
enum ReplayThread {
    static var name: String? { argument("-qaReplayThread") }

    /// The fixture's rows, newest last, timed back from now.
    static func rows(_ name: String) -> [TimelineRow] {
        guard let url = Bundle.main.url(forResource: name + ".qa", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let recorded = try? JSONDecoder().decode([TimelineRow].self, from: data)
        else { fatalError("No replay fixture \(name).qa.json in the app") }
        let repeats = max(1, argument("-qaReplayRepeat").flatMap(Int.init) ?? 1)
        let span = -(recorded.compactMap(\.createdAt).min() ?? 0) + 60_000
        let now = Date().timeIntervalSince1970 * 1000
        return (0..<repeats).flatMap { copy in
            recorded.map { row in
                var row = row
                let back = Double(repeats - 1 - copy) * span
                if copy < repeats - 1 { row.id += "-\(copy)" }
                row.createdAt = row.createdAt.map { now + $0 - back }
                row.startedAt = row.startedAt.map { now + $0 - back }
                return row
            }
        }
    }

    /// A turn as the real Bot streams one: reasoning, a command with a
    /// screenful of output, and a reply growing a chunk at a time (lists,
    /// bold, links, a fenced block of shell output), then another command
    /// between paragraphs and the next part of the reply, four times over,
    /// before the turn ends. `emit` applies a change to the server's rows
    /// and tells the chat; each call waits a chunk's time first.
    static func turn(_ sent: Int, at: Double, emit: (_ change: (inout [TimelineRow]) -> Void) async -> Void) async {
        var lorem = Lorem()
        let chunk = argument("-qaReplayChunk").flatMap(Int.init) ?? 48
        for part in 0..<4 {
            let base = "replay\(sent)p\(part)"
            await emit { rows in
                rows.append(row(#"{"id":"\#(base)r","kind":"system","systemKind":"operation","operationKind":"reasoning","status":"completed","title":"Thought","detail":"\#(lorem.text(260))"}"#, at: at))
            }
            await emit { rows in rows.append(command(base + "c", lorem: &lorem, lines: 0, running: true, at: at)) }
            await emit { rows in rows[rows.count - 1] = command(base + "c", lorem: &lorem, lines: 40 + part * 4, running: false, at: at) }
            let reply = Self.reply(part, lorem: &lorem)
            var shown = 0
            while shown < reply.count {
                shown = min(reply.count, shown + chunk)
                let text = String(reply.prefix(shown))
                await emit { rows in
                    let next = message(base + "a", text: text, at: at)
                    if rows.last?.id == next.id { rows[rows.count - 1] = next } else { rows.append(next) }
                }
            }
        }
    }

    /// One part of the streamed reply, in the shapes the real replies use.
    private static func reply(_ part: Int, lorem: inout Lorem) -> String {
        var blocks = [lorem.sentence(220), "**\(lorem.text(18))** \(lorem.sentence(160))"]
        blocks.append((1...6).map { "- **\(lorem.text(12))**: \(lorem.sentence(70 + $0 * 9)) [\(lorem.text(10))](https://example.com/\(lorem.word()))" }.joined(separator: "\n"))
        blocks.append("```bash\n" + (0..<(14 + part * 3)).map { "$ \(lorem.mono(30 + ($0 * 7) % 50))" }.joined(separator: "\n") + "\n```")
        blocks.append((1...5).map { "\($0). \(lorem.sentence(60 + $0 * 11))" }.joined(separator: "\n"))
        blocks.append(lorem.sentence(300))
        if part == 3 { blocks.append(#"::next{reply="\#(lorem.text(14))|\#(lorem.text(18))|\#(lorem.text(11))"}"#) }
        return blocks.joined(separator: "\n\n")
    }

    private static func command(_ id: String, lorem: inout Lorem, lines: Int, running: Bool, at: Double) -> TimelineRow {
        let output = (0..<lines).map { _ in lorem.mono(20 + lorem.next(70)) }.joined(separator: "\n")
        return row(#"{"id":"\#(id)","kind":"work","workKind":"command","status":"\#(running ? "running" : "completed")","command":"\#(lorem.mono(180))","output":"\#(escape(output))","presentation":{"label":{"pending":"Running command","completed":"Ran command"},"icon":{"glyph":"Terminal"},"title":"\#(lorem.mono(120))"}}"#, at: at)
    }

    private static func message(_ id: String, text: String, at: Double) -> TimelineRow {
        row(#"{"id":"\#(id)","kind":"conversation","role":"assistant","text":"\#(escape(text))"}"#, at: at)
    }

    private static func row(_ json: String, at: Double) -> TimelineRow {
        var row = try! JSONDecoder().decode(TimelineRow.self, from: Data(json.utf8))
        row.createdAt = at
        return row
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n")
    }

    private static func argument(_ name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.firstIndex(of: name).flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
    }

    /// Deterministic lorem ipsum, cut to length.
    struct Lorem {
        private static let words = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore "
            + "magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute "
            + "irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident").split(separator: " ")
        private var index = 0

        mutating func word() -> String {
            defer { index += 1 }
            return String(Self.words[index % Self.words.count])
        }

        mutating func next(_ bound: Int) -> Int {
            index += 1
            return (index * 7_919) % bound
        }

        mutating func text(_ length: Int) -> String {
            var out = ""
            while out.count < length { out += (out.isEmpty ? "" : " ") + word() }
            return String(out.prefix(length)).trimmingCharacters(in: .whitespaces)
        }

        mutating func sentence(_ length: Int) -> String {
            let body = text(length)
            return body.prefix(1).uppercased() + body.dropFirst() + "."
        }

        /// A line of shell output: words joined by the punctuation output has.
        mutating func mono(_ length: Int) -> String {
            var out = ""
            let joins = [" ", "/", "-", "  ", "=", ":", "."]
            while out.count < length { out += (out.isEmpty ? "" : joins[next(joins.count)]) + word() }
            return String(out.prefix(length))
        }
    }
}
#endif
