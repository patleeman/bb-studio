import SwiftUI
import WebKit

extension EnvironmentValues {
    /// The thread whose messages are on screen, for directives that load the thread's files.
    @Entry var threadId: String?
}

/// `::inline-vis{file="…" source="…" height="…"}` in a reply, from BB's
/// built-in inline-vis plugin: an HTML or Markdown file from the thread's
/// workspace or thread storage, shown in the message.
struct InlineVis: Hashable {
    static let defaultHeight = 224

    var file: String
    var source: String?
    var height: Int
    /// Set when the directive itself is wrong, as the web app reports it.
    var problem: String?

    init(_ directive: Directive) {
        file = directive.attributes["file"]?.trimmingCharacters(in: .whitespaces) ?? ""
        source = directive.attributes["source"]?.trimmingCharacters(in: .whitespaces)
        let raw = directive.attributes["height"]?.trimmingCharacters(in: .whitespaces) ?? ""
        let parsed = raw.isEmpty ? Self.defaultHeight : raw.wholeMatch(of: /\d+/).flatMap { Int($0.output) }
        height = parsed.map { min(max($0, 120), 1200) } ?? Self.defaultHeight
        if file.isEmpty {
            problem = "inline-vis requires a file attribute, e.g. ::inline-vis{file=\"demo.html\"}"
        } else if parsed.map({ !(120...1200).contains($0) }) ?? true {
            problem = "inline-vis height must be a whole number from 120 to 1200 pixels."
        }
    }
}

/// What the plugin's `preparePreview` resolves a directive to.
private struct InlineVisPreview: Decodable {
    var kind: String
    var file: String
    var source: String
    var content: String?
}

struct InlineVisCard: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.threadId) private var threadId
    let vis: InlineVis
    /// One setting for every card, as in BB web.
    @AppStorage("inlineVisCollapsed") private var collapsed = false
    @State private var preview: InlineVisPreview?
    @State private var error: String?
    @State private var expanded = false

    var body: some View {
        if threadId == nil {
            // Outside a thread's replies, such as in a prompt that asks for one.
            Label(vis.file.isEmpty ? "inline-vis" : "inline-vis: \(vis.file)", systemImage: "chart.bar.doc.horizontal")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else if let problem = vis.problem {
            notice(problem, failed: false)
        } else if let error {
            notice("Failed to load \(vis.file): \(error)", failed: true)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                header
                if !collapsed {
                    Divider()
                    if preview?.kind == "markdown" {
                        content.frame(maxHeight: CGFloat(vis.height))
                    } else {
                        content.frame(height: CGFloat(vis.height))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator))
            .clipShape(.rect(cornerRadius: 10))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("inlineVis")
            .task(id: vis) { await load() }
            .sheet(isPresented: $expanded) {
                if let preview, let threadId { InlineVisSheet(threadId: threadId, preview: preview) }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Button {
                withAnimation(.snappy) { collapsed.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(collapsed ? 0 : 90))
                    Text("inline-vis").font(.caption.weight(.medium))
                    Text(vis.file).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                        .truncationMode(.middle)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(collapsed ? "Show \(vis.file)" : "Hide \(vis.file)")
            Button { expanded = true } label: {
                Image(systemName: "arrow.up.left.and.arrow.down.right").font(.caption)
            }
            .buttonStyle(.borderless)
            .disabled(preview == nil)
            .accessibilityLabel("Open \(vis.file) full screen")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(.fill.quaternary)
    }

    @ViewBuilder
    private var content: some View {
        if let preview, let threadId {
            if preview.kind == "markdown" {
                // As tall as the file up to the directive's height, then scrolling.
                let markdown = MarkdownText(WorkspaceFileView.unwrap(preview.content ?? ""))
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ViewThatFits(in: .vertical) {
                    markdown
                    ScrollView { markdown }
                }
            } else if let url = app.client.inlineVisURL(threadId: threadId, file: preview.file, source: preview.source) {
                SandboxedWebView(url: url)
            }
        } else {
            ProgressView("Loading visualization…").font(.caption).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func notice(_ text: String, failed: Bool) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(failed ? Color.red : .secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(failed ? Color.red.opacity(0.1) : Color.secondary.opacity(0.1), in: .rect(cornerRadius: 8))
            .accessibilityIdentifier("inlineVisError")
    }

    private func load() async {
        guard let threadId else { return }
        var input: [String: JSONValue] = ["threadId": .string(threadId), "file": .string(vis.file)]
        if let source = vis.source { input["source"] = .string(source) }
        do {
            preview = try await app.client.rpc("inline-vis", "preparePreview", .object(input))
            error = nil
        } catch where !BBClient.isCancellation(error) {
            self.error = (error as? BBError)?.message ?? BBClient.describe(error, server: app.client.baseURL)
        } catch {}
    }
}

/// The visualization on its own screen, at full height.
private struct InlineVisSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let threadId: String
    let preview: InlineVisPreview

    var body: some View {
        NavigationStack {
            Group {
                if preview.kind == "markdown" {
                    ScrollView {
                        MarkdownText(WorkspaceFileView.unwrap(preview.content ?? "")).textSelection(.enabled).padding()
                            .frame(maxWidth: 760, alignment: .leading)
                            .frame(maxWidth: .infinity)
                    }
                } else if let url = app.client.inlineVisURL(threadId: threadId, file: preview.file, source: preview.source) {
                    SandboxedWebView(url: url).ignoresSafeArea(edges: .bottom)
                }
            }
            .navigationTitle(URL(fileURLWithPath: preview.file).lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

/// An agent-written page. BB serves it with a `sandbox allow-scripts` CSP, so
/// its scripts run in an opaque origin; the web view also keeps its own,
/// throwaway data store, apart from the app's BB web session.
struct SandboxedWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
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

extension BBClient {
    /// Where BB serves a thread's file raw: its workspace or its thread storage.
    func inlineVisURL(threadId: String, file: String, source: String) -> URL? {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.!~*'()"))
        let encode = { (part: String) in part.addingPercentEncoding(withAllowedCharacters: allowed) ?? part }
        let root = source == "thread-storage" ? "thread-storage/files" : "worktree/files"
        let path = file.split(separator: "/", omittingEmptySubsequences: false).map { encode(String($0)) }.joined(separator: "/")
        return URL(string: "/api/v1/threads/\(encode(threadId))/\(root)/\(path)", relativeTo: baseURL)?.absoluteURL
    }
}
