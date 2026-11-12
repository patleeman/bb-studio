import SwiftUI

/// A unified diff, red for removed lines and green for added ones.
struct DiffView: View {
    let diff: String
    /// Long diffs stop here, with a count of what's left.
    var maxLines = 400

    var body: some View {
        let lines = Self.lines(diff)
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.prefix(maxLines).enumerated()), id: \.offset) { _, line in
                    Text(line.isEmpty ? " " : line)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Self.foreground(line))
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Self.background(line))
                }
                if lines.count > maxLines {
                    Text("… \(lines.count - maxLines) more lines")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(8)
                }
            }
            .padding(.vertical, 6)
            .textSelection(.enabled)
        }
        .background(.fill.quaternary, in: .rect(cornerRadius: 8))
    }

    /// Without the `---`/`+++` file headers; the row already names the file.
    private static func lines(_ diff: String) -> [String] {
        var lines = diff.components(separatedBy: "\n")
            .filter { !$0.hasPrefix("--- ") && !$0.hasPrefix("+++ ") && $0 != "\\ No newline at end of file" }
        while lines.last?.isEmpty == true { lines.removeLast() }
        return lines
    }

    private static func foreground(_ line: String) -> Color {
        line.hasPrefix("@@") ? .secondary : .primary
    }

    private static func background(_ line: String) -> Color {
        if line.hasPrefix("+") { return .green.opacity(0.16) }
        if line.hasPrefix("-") { return .red.opacity(0.16) }
        if line.hasPrefix("@@") { return .blue.opacity(0.08) }
        return .clear
    }
}

/// `+12 −3`, in the diff colours.
struct DiffStats: View {
    let stats: TimelineRow.FileChange.Stats

    var body: some View {
        HStack(spacing: 4) {
            if stats.added > 0 { Text("+\(stats.added)").foregroundStyle(.green) }
            if stats.removed > 0 { Text("−\(stats.removed)").foregroundStyle(.red) }
        }
        .font(.caption2.monospacedDigit())
    }
}
