import SwiftUI
import WebKit

/// The Studio item a reply card opens: `::page{id="pg_…"}`, `::drawing{…}`,
/// `::design{…}`, `::recording{…}` or `::mini{…}` on its own line.
/// Artifacts have `ArtifactCard`.
enum ReplyItem: Hashable {
    case page(String)
    case drawing(String)
    case design(String)
    case recording(String)
    case mini(String)

    init?(_ directive: Directive) {
        guard let id = directive.attributes["id"]?.trimmingCharacters(in: .whitespaces), !id.isEmpty,
              id.wholeMatch(of: /[A-Za-z0-9_-]{1,80}/) != nil else { return nil }
        switch directive.name {
        case "page": self = .page(id)
        case "drawing": self = .drawing(id)
        case "design" where BBClient.isDesignId(id): self = .design(id)
        case "recording" where id.wholeMatch(of: /rec_[a-z0-9]{8,32}/) != nil: self = .recording(id)
        case "mini" where MiniApp.isId(id): self = .mini(id)
        default: return nil
        }
    }

    var id: String {
        switch self {
        case .page(let id), .drawing(let id), .design(let id), .recording(let id), .mini(let id): id
        }
    }

    var route: Route {
        switch self {
        case .page(let id): .page(id: id)
        case .drawing(let id): .drawing(id: id)
        case .design(let id): .design(id: id)
        case .recording(let id): .recording(id: id)
        case .mini(let id): .mini(id: id)
        }
    }

    var kind: StudioKind {
        switch self {
        case .page: StudioKind.of("page")
        case .drawing: StudioKind.of("drawing")
        case .design: StudioKind.of("design")
        case .recording: StudioKind.of("recording")
        case .mini: StudioKind.of("mini")
        }
    }
}

/// What a reply card shows of its item, read-only, under its name.
enum ReplyPreview {
    case markdown(String)
    case drawing(DrawingScene)
    case design(id: String, screens: [DesignScreen])
    case recording(RecordingPreview)
    /// The item has nothing to show yet, such as an empty page.
    case note(String)

    /// The tallest a preview gets before it scrolls, as on the web.
    static let maxHeight: CGFloat = 320
}

/// A recording's summary and the start of its transcript.
struct RecordingPreview {
    static let lineLimit = 6

    struct Line: Identifiable {
        var id: String
        var at: Double
        var text: String
    }

    var summary: String?
    var lines: [Line]
    var total: Int
    var transcribing: Bool

    /// Cleaned text where a cleanup was saved, as Talk's own card shows it.
    init(_ output: Studio.RecordingsRecordingGetOutput) {
        let all = (output.segments ?? []).enumerated().compactMap { index, segment -> Line? in
            let text = (segment.cleanedText ?? segment.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : Line(id: segment.id ?? "\(index)", at: segment.offsetMs ?? 0, text: text)
        }
        let notes = output.recording?.meetingNotes?.summary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        summary = notes.isEmpty ? nil : notes
        lines = Array(all.prefix(Self.lineLimit))
        total = all.count
        transcribing = output.recording?.status != .done || (output.recording?.pendingCount ?? 0) > 0
    }

    /// `65_000` → `1:05`, as Talk's clock.
    static func clock(_ ms: Double) -> String {
        let total = max(0, Int(ms / 1000))
        let (hours, minutes, seconds) = (total / 3600, total % 3600 / 60, total % 60)
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, seconds) : String(format: "%d:%02d", minutes, seconds)
    }
}

/// A Studio reply card: the item's icon, name and size, opening it, and under
/// them a read-only preview that one chevron hides or shows for every card.
/// The web opens the item beside the chat; the phone pushes it.
struct StudioCardChrome<Icon: View, Preview: View>: View {
    let route: Route
    let title: String
    let detail: String?
    let missing: Bool
    let hasPreview: Bool
    let identifier: String
    /// Says what the header does, such as "Open", in place of its chevron.
    var action: String? = nil
    @ViewBuilder let icon: () -> Icon
    @ViewBuilder let preview: () -> Preview
    /// One setting for every Studio card, as on the web.
    @AppStorage("studioPreviewCollapsed") private var collapsed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                NavigationLink(value: route) {
                    HStack(spacing: 12) {
                        icon()
                        VStack(alignment: .leading, spacing: 2) {
                            Text(title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(missing ? .secondary : .primary)
                                .lineLimit(2)
                            if let detail {
                                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                        if let action {
                            Text(action)
                                .font(.footnote.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(.fill.tertiary, in: .capsule)
                        } else {
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(missing)
                .accessibilityIdentifier(identifier)
                if hasPreview {
                    Button {
                        withAnimation(.snappy) { collapsed.toggle() }
                    } label: {
                        Image(systemName: collapsed ? "eye" : "eye.slash")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(width: 36, height: 36)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(collapsed ? "Show preview" : "Hide preview")
                    .accessibilityIdentifier("studioPreviewToggle")
                }
            }
            .padding(10)
            if hasPreview, !collapsed {
                Divider()
                preview()
            }
        }
        .frame(maxWidth: hasPreview ? 560 : 420, alignment: .leading)
        .background(.fill.quaternary, in: .rect(cornerRadius: 14))
        .clipShape(.rect(cornerRadius: 14))
    }
}

/// A reply card for a page, drawing, table, design, recording or mini app.
struct ReplyItemCard: View {
    let item: ReplyItem

    var body: some View {
        if case .mini(let id) = item {
            MiniReplyCard(id: id)
        } else {
            ReplyItemSummaryCard(item: item)
        }
    }
}

/// A reply card that shows a read-only preview of its item.
private struct ReplyItemSummaryCard: View {
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let item: ReplyItem
    @State private var summary: Summary?
    @State private var missing = false

    struct Summary {
        var title: String
        var detail: String?
        var emoji: String?
        var preview: ReplyPreview?
    }

    /// Replies re-render often; a card starts from what the last one showed,
    /// then checks for changes.
    @MainActor private static var cache: [String: Summary] = [:]

    var body: some View {
        StudioCardChrome(
            route: item.route,
            title: summary?.title ?? (missing ? "Deleted \(item.kind.label.lowercased())" : item.kind.label),
            detail: [item.kind.label, summary?.detail].compactMap { $0 }.joined(separator: " · "),
            missing: missing,
            hasPreview: summary?.preview != nil && !missing,
            identifier: "replyItemCard"
        ) {
            Group {
                if let emoji = summary?.emoji, !emoji.isEmpty {
                    Text(emoji).font(.title3)
                } else {
                    Image(systemName: item.kind.symbol).font(.body.weight(.medium)).foregroundStyle(item.kind.tint)
                }
            }
            .frame(width: 44, height: 44)
            .background(item.kind.tint.opacity(0.12), in: .rect(cornerRadius: 10))
        } preview: {
            if let preview = summary?.preview { ReplyPreviewView(preview: preview, route: item.route) }
        }
        .task(id: item) {
            let key = ServerScope.key("\(item.kind.id):\(item.id)", serverURL: client.baseURL)
            if let cached = Self.cache[key] { summary = cached }
            do {
                if let found = try await load() {
                    Self.cache[key] = found
                    summary = found
                } else {
                    Self.cache[key] = nil
                    missing = true
                }
            } catch {
                // Offline or the add-on is off: the card still opens the item.
            }
        }
    }

    private func load() async throws -> Summary? {
        switch item {
        case .page(let id):
            guard let page = try await client.page(id) else { return nil }
            let markdown = (try? await client.pageMarkdown(id)) ?? ""
            let empty = markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return Summary(title: page.displayTitle, emoji: page.icon, preview: empty ? .note("This page is empty.") : .markdown(markdown))
        case .drawing(let id):
            return try await client.drawing(id).map { drawing in
                let count = drawing.scene.elements.filter { !$0.isDeleted }.count
                return Summary(title: drawing.name.isEmpty ? "Untitled drawing" : drawing.name,
                    detail: count == 1 ? "1 element" : "\(count) elements",
                    preview: count == 0 ? .note("This drawing is empty.") : .drawing(drawing.scene))
            }
        case .design(let id):
            return try await client.design(id).map { design in
                let count = design.screens.count
                // The newest round first, as the web's card shows it.
                let screens = Array((design.rounds?.first?.screens ?? []).prefix(3))
                return Summary(title: design.displayName, detail: count == 1 ? "1 screen" : "\(count) screens",
                    preview: screens.isEmpty ? .note("This design has no screens yet.") : .design(id: id, screens: screens))
            }
        case .recording(let id):
            let output: Studio.RecordingsRecordingGetOutput
            do {
                output = try await client.recordingOutput(id)
            } catch let error as BBError where error.message.hasPrefix("No recording") {
                // Talk's answer for a deleted recording.
                return nil
            }
            guard let recording = output.recording else { return nil }
            let title = (recording.title ?? "").trimmingCharacters(in: .whitespaces)
            let words = Int(recording.wordCount ?? 0)
            let length = Duration.milliseconds(recording.durationMs ?? 0)
                .formatted(.units(allowed: [.hours, .minutes, .seconds], width: .abbreviated, maximumUnitCount: 2))
            return Summary(title: title.isEmpty ? "Untitled recording" : title,
                detail: "\(length) · \(words) word\(words == 1 ? "" : "s")",
                preview: .recording(RecordingPreview(output)))
        case .mini:
            // `MiniReplyCard` runs the app itself.
            return nil
        }
    }
}

/// A reply card's preview. Text scrolls past `ReplyPreview.maxHeight`;
/// pictures and screens open the item when tapped.
struct ReplyPreviewView: View {
    private let operation = ServerOperation()
    let preview: ReplyPreview
    let route: Route

    var body: some View {
        switch preview {
        case .markdown(let markdown):
            scrolling(PageMarkdown(source: markdown).textSelection(.enabled))
        case .note(let text):
            Text(text).font(.footnote).foregroundStyle(.secondary).padding(12)
        case .drawing(let scene):
            NavigationLink(value: route) {
                ExcalidrawCanvas(scene: scene)
                    .frame(maxWidth: .infinity)
                    .frame(height: 240)
                    .background(.white)
                    .environment(\.colorScheme, .light)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open drawing")
        case .design(let id, let screens):
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(screens.enumerated()), id: \.offset) { _, screen in
                        NavigationLink(value: route) {
                            DesignScreenThumb(url: operation.client.designScreenURL(id, screen), screen: screen)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(12)
            }
        case .recording(let recording):
            scrolling(recordingBody(recording))
        }
    }

    /// As tall as its content up to the limit, then scrolling, as `InlineVisCard`'s Markdown.
    private func scrolling(_ content: some View) -> some View {
        let padded = content.padding(12).frame(maxWidth: .infinity, alignment: .leading)
        return ViewThatFits(in: .vertical) {
            padded
            ScrollView { padded }
        }
        .frame(maxHeight: ReplyPreview.maxHeight)
    }


    private func recordingBody(_ recording: RecordingPreview) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let summary = recording.summary { Text(summary).font(.subheadline) }
            if recording.lines.isEmpty {
                Text(recording.transcribing ? "Transcribing…" : "Nothing was transcribed.").font(.caption).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(recording.lines) { line in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(RecordingPreview.clock(line.at)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                .frame(width: 40, alignment: .leading)
                            Text(line.text).font(.caption).lineLimit(2)
                        }
                    }
                }
            }
            if recording.total > recording.lines.count {
                Text("\(recording.total - recording.lines.count) more parts").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

/// A design screen at its own size, scaled down to the preview's height.
private struct DesignScreenThumb: View {
    static let height: CGFloat = 200

    let url: URL
    let screen: DesignScreen

    var body: some View {
        let size = screen.size
        let scale = Self.height / size.height
        VStack(alignment: .leading, spacing: 4) {
            StaticWebView(url: url)
                .frame(width: size.width, height: size.height)
                .scaleEffect(scale, anchor: .topLeading)
                .frame(width: size.width * scale, height: Self.height, alignment: .topLeading)
                .clipShape(.rect(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
            Text(screen.caption ?? screen.title ?? screen.id ?? "Screen")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(width: size.width * scale, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Screen \(screen.caption ?? screen.title ?? screen.id ?? "")")
    }
}

/// A page shown without touches, so the card around it takes them.
private struct StaticWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        view.isUserInteractionEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.load(URLRequest(url: url))
        context.coordinator.loaded = url
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != url else { return }
        context.coordinator.loaded = url
        view.load(URLRequest(url: url))
    }

    func makeCoordinator() -> WebView.Coordinator { WebView.Coordinator() }
}
