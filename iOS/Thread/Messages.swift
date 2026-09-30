import SwiftUI

/// The emoji-react plugin's default reactions, offered on every message's menu.
private let defaultReactions = ["👍 Agree", "👎 Disagree", "✅ Do it", "❓ Clarify"]

struct MessageBubble: View {
    let row: TimelineRow
    var projectId: String?
    var react: (String) -> Void = { _ in }
    var quote: (String) -> Void = { _ in }
    var select: (String) -> Void = { _ in }
    /// Nil where side chats aren't available.
    var sideChat: ((String) -> Void)?
    /// Only on the newest message the user sent.
    var edit: ((String) -> Void)?
    /// Saves the files this reply produced to Studio; nil without the artifacts plugin.
    var saveFiles: ((Int?) -> Void)?
    @EnvironmentObject private var app: AppModel

    private var text: String { row.text ?? "" }

    var body: some View {
        if row.isUser {
            VStack(alignment: .trailing, spacing: 6) {
                attachments
                if !text.isEmpty {
                    ClampedText(text: text)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.accentColor.opacity(0.18), in: .rect(cornerRadius: 18))
                        .contentShape(.contextMenuPreview, .rect(cornerRadius: 18))
                        .contextMenu { menu }
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 40)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                MarkdownText(text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.contextMenuPreview, .rect(cornerRadius: 8))
                    .contextMenu { menu }
                let reactions = Directive.reactions(in: text)
                if !reactions.isEmpty {
                    ReactionChips(items: reactions, react: react)
                }
            }
        }
    }

    /// The text without directive lines, for copying and quoting.
    private var plainText: String {
        text.components(separatedBy: "\n")
            .filter { Directive(line: $0.trimmingCharacters(in: .whitespaces)) == nil }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @ViewBuilder
    private var menu: some View {
        if let createdAt = row.createdAt {
            Section {
                Text(Self.sentLabel(createdAt))
            }
        }
        Button { UIPasteboard.general.string = plainText } label: { Label("Copy", systemImage: "doc.on.doc") }
        Button { select(plainText) } label: { Label("Select Text", systemImage: "selection.pin.in.out") }
        Button { quote(plainText) } label: { Label("Quote", systemImage: "text.quote") }
        if let edit {
            Button { edit(plainText) } label: { Label("Edit", systemImage: "pencil") }
        }
        if let sideChat {
            Button { sideChat(plainText) } label: { Label("Side Chat", systemImage: "bubble.left.and.text.bubble.right") }
        }
        ShareLink(item: plainText) { Label("Share", systemImage: "square.and.arrow.up") }
        if !row.isUser, let saveFiles {
            Button { saveFiles(row.sourceSeqEnd.map { Int($0) }) } label: {
                Label("Save Files to Studio…", systemImage: "square.and.arrow.down.on.square")
            }
        }
        if !row.isUser {
            Section("React") {
                ForEach(defaultReactions, id: \.self) { item in
                    Button(item) { react(item) }
                }
            }
        }
    }

    /// "Sent Today at 2:46 PM", or the date for older messages.
    static func sentLabel(_ createdAt: Double) -> String {
        let date = Date(timeIntervalSince1970: createdAt / 1000)
        let time = date.formatted(date: .omitted, time: .shortened)
        if Calendar.current.isDateInToday(date) { return "Sent Today at \(time)" }
        if Calendar.current.isDateInYesterday(date) { return "Sent Yesterday at \(time)" }
        return "Sent \(date.formatted(date: .abbreviated, time: .shortened))"
    }

    @ViewBuilder
    private var attachments: some View {
        let images = (row.attachments?.imageUrls ?? []) + (row.attachments?.localImagePaths ?? [])
        let files = row.attachments?.localFilePaths ?? []
        if !images.isEmpty, let projectId {
            // Three to a row, so a batch of screenshots wraps instead of running off screen.
            let side: CGFloat = images.count == 1 ? 200 : 96
            Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                ForEach(Array(stride(from: 0, to: images.count, by: 3)), id: \.self) { start in
                    GridRow {
                        ForEach(images[start..<min(start + 3, images.count)], id: \.self) { path in
                            if let url = app.client.attachmentURL(projectId: projectId, path: path) {
                                AttachmentImage(url: url, side: side)
                            }
                        }
                    }
                }
            }
        }
        ForEach(files, id: \.self) { path in
            Label(URL(fileURLWithPath: path).lastPathComponent, systemImage: "doc")
                .font(.footnote)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.fill.tertiary, in: .capsule)
        }
    }
}

/// A sent message, cut to about 15 lines with Show more when longer, as in BB web.
struct ClampedText: View {
    let text: String
    @State private var expanded = false
    @State private var fullHeight: CGFloat = 0
    @ScaledMetric(relativeTo: .body) private var lineHeight: CGFloat = 22

    private var limit: CGFloat { lineHeight * 15 }
    private var clamped: Bool { !expanded && fullHeight > limit + 1 }

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            MarkdownText(text)
                .environment(\.threadId, nil)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullHeight = $0 }
                .frame(maxHeight: expanded ? nil : limit, alignment: .top)
                .clipped()
                .mask {
                    VStack(spacing: 0) {
                        Rectangle()
                        LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                            .frame(height: clamped ? lineHeight * 1.5 : 0)
                    }
                }
            if fullHeight > limit + 1 {
                Button(expanded ? "Show less" : "Show more") {
                    withAnimation(.snappy) { expanded.toggle() }
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .buttonStyle(.plain)
            }
        }
    }
}

/// A sent photo. Tap to see it full screen.
struct AttachmentImage: View {
    let url: URL
    let side: CGFloat
    @State private var viewing = false

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            case .failure:
                Image(systemName: "photo").foregroundStyle(.secondary)
            default:
                ProgressView()
            }
        }
        .frame(width: side, height: side)
        .background(.fill.tertiary)
        .clipShape(.rect(cornerRadius: 14))
        .onTapGesture { viewing = true }
        .fullScreenCover(isPresented: $viewing) {
            ImageViewer(url: url)
        }
        .accessibilityLabel("Attached image")
        .accessibilityAddTraits(.isButton)
    }
}

struct ImageViewer: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1

    var body: some View {
        NavigationStack {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFit()
                    .scaleEffect(scale)
                    .gesture(MagnifyGesture().onChanged { scale = max(1, $0.magnification) }.onEnded { _ in
                        withAnimation { scale = 1 }
                    })
            } placeholder: {
                ProgressView()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.black)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { ShareLink(item: url) }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
    }
}

/// Suggested replies under an assistant message. A tap drafts the reply.
struct ReactionChips: View {
    let items: [String]
    let react: (String) -> Void
    @State private var taps = 0

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Button {
                    taps += 1
                    react(item)
                } label: {
                    Text(item)
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(.fill.secondary, in: .capsule)
                        .overlay(Capsule().strokeBorder(.separator))
                }
                .buttonStyle(.plain)
                .accessibilityHint("Drafts this reply")
                .accessibilityIdentifier("reaction")
            }
        }
        .sensoryFeedback(.selection, trigger: taps)
    }
}

/// Lays children out left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(bounds.width, subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ maxWidth: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let extra = rows[rows.count - 1].indices.isEmpty ? size.width : size.width + spacing
            if rows[rows.count - 1].width + extra > maxWidth, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            let last = rows.count - 1
            rows[last].width += rows[last].indices.isEmpty ? size.width : size.width + spacing
            rows[last].height = max(rows[last].height, size.height)
            rows[last].indices.append(index)
        }
        return rows.filter { !$0.indices.isEmpty }
    }
}

/// A run of tool calls and reasoning, collapsed to one line. Expanded, each step
/// shows what it did, and a tap on a step shows its output.
struct ActivityGroup: View {
    let rows: [TimelineRow]
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(rows) { row in ActivityStep(row: row) }
            }
            .padding(.top, 6)
        } label: {
            HStack(spacing: 6) {
                if running {
                    ProgressView().controlSize(.mini)
                } else if failed {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
                Text(summary).lineLimit(1)
                if !running, let stats = diffStats { DiffStats(stats: stats) }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .tint(.secondary)
    }

    private var work: [TimelineRow] { rows.filter { $0.kind == "work" } }

    private var diffStats: TimelineRow.FileChange.Stats? {
        let all = rows.compactMap { $0.change?.diffStats }
        guard !all.isEmpty else { return nil }
        return .init(added: all.map(\.added).reduce(0, +), removed: all.map(\.removed).reduce(0, +))
    }
    private var running: Bool { rows.contains { $0.status == "inProgress" || $0.status == "running" || $0.status == "pending" } }
    private var failed: Bool { rows.contains { $0.status == "failed" || $0.status == "error" } }

    private var summary: String {
        if work.isEmpty { return rows.last?.title ?? "Thinking" }
        if running, let current = rows.last(where: { $0.kind == "work" }) {
            return ActivityStep.label(for: current)
        }
        var counts: [String] = []
        let commands = work.filter { $0.workKind == "command" }.count
        let reads = work.filter { $0.workKind == "file-read" }.count
        let edits = Set(work.filter { $0.workKind == "file-change" }.compactMap { $0.change?.path ?? $0.path }).count
        let tools = work.filter { $0.workKind == "tool" }.count
        if commands > 0 { counts.append("\(commands) command\(commands == 1 ? "" : "s")") }
        if reads > 0 { counts.append("read \(reads) file\(reads == 1 ? "" : "s")") }
        if edits > 0 { counts.append("edited \(edits) file\(edits == 1 ? "" : "s")") }
        if tools > 0 { counts.append("\(tools) tool call\(tools == 1 ? "" : "s")") }
        return counts.isEmpty ? "\(work.count) step\(work.count == 1 ? "" : "s")" : counts.joined(separator: ", ").capitalizedFirst
    }
}

struct ActivityStep: View {
    let row: TimelineRow
    @Environment(\.openURL) private var openURL
    @State private var showingOutput = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                if hasDetail { withAnimation(.snappy) { showingOutput.toggle() } }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: icon).frame(width: 16).foregroundStyle(tint)
                    Text(Self.label(for: row))
                        .font(row.workKind == "command" ? .caption.monospaced() : .caption)
                        .lineLimit(showingOutput ? nil : 2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    if let stats = row.change?.diffStats { DiffStats(stats: stats) }
                    if hasDetail {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .rotationEffect(.degrees(showingOutput ? 90 : 0))
                    }
                }
                .foregroundStyle(.secondary)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .contextMenu {
                if let path = filePath {
                    if row.change?.kind != "delete", let url = FilePathLink.url(path) {
                        Button { openURL(url) } label: { Label("Open File", systemImage: "doc.text") }
                    }
                    Button { UIPasteboard.general.string = path } label: { Label("Copy Path", systemImage: "doc.on.doc") }
                }
                if let command = row.command {
                    Button { UIPasteboard.general.string = command } label: { Label("Copy Command", systemImage: "doc.on.doc") }
                }
            }
            if showingOutput, let diff = row.change?.diff {
                DiffView(diff: diff)
                    .frame(maxHeight: 360)
                    .padding(.leading, 24)
            } else if showingOutput, let detail {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(detail)
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                        .padding(8)
                }
                .frame(maxHeight: 240)
                .background(.fill.tertiary, in: .rect(cornerRadius: 8))
                .padding(.leading, 24)
            }
        }
    }

    private var detail: String? {
        let text = row.output ?? row.detail
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let lines = text.components(separatedBy: "\n")
        return lines.count > 60 ? lines.prefix(60).joined(separator: "\n") + "\n… \(lines.count - 60) more lines" : text
    }

    /// The file an edit or read touched.
    private var filePath: String? {
        row.change?.path ?? (["file-change", "file-read"].contains(row.workKind ?? "") ? row.path : nil)
    }

    private var hasDetail: Bool { detail != nil || row.change?.diff?.isEmpty == false }

    private var icon: String {
        if row.status == "failed" || row.status == "error" { return "xmark.circle" }
        switch row.workKind {
        case "command": return "terminal"
        case "file-read": return "doc.text"
        case "file-change": return "pencil"
        case "tool": return "wrench.and.screwdriver"
        case "workflow": return "square.stack.3d.up"
        default: return row.systemKind == "operation" ? "sparkle" : "circle.dotted"
        }
    }

    private var tint: Color {
        row.status == "failed" || row.status == "error" ? .red : .secondary
    }

    static func label(for row: TimelineRow) -> String {
        if let command = row.command { return "$ \(command)" }
        let done = !(row.status == "inProgress" || row.status == "running" || row.status == "pending")
        if let path = row.change?.path {
            let verb = switch row.change?.kind {
            case "add": done ? "Created" : "Creating"
            case "delete": done ? "Deleted" : "Deleting"
            default: done ? "Edited" : "Editing"
            }
            return "\(verb) \(URL(fileURLWithPath: path).lastPathComponent)"
        }
        let verb = done ? row.presentation?.label?.completed : row.presentation?.label?.pending
        let subject = row.presentation?.title ?? row.path.map { URL(fileURLWithPath: $0).lastPathComponent }
        if let verb, let subject { return "\(verb) \(subject)" }
        if let tool = row.toolName {
            return (verb ?? "Ran") + " " + (tool.split(separator: ":").last.map(String.init) ?? tool)
        }
        return verb ?? subject ?? row.title ?? row.workKind ?? row.systemKind ?? row.kind
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
