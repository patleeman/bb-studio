import SwiftUI

/// Edits the whole page as one Markdown text and saves a moment after typing
/// stops. The server compares the document it was loaded from, so an edit made
/// elsewhere in the meantime is never overwritten; the text stays on screen.
struct PageEditor: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let pageId: String
    var onSaved: () async -> Void
    @StateObject private var model: PageEditorModel
    @State private var dictating = false
    @State private var confirmingDiscard = false
    @State private var showingServer = false
    @State private var copied = false
    @State private var controller = PageTextController()

    init(pageId: String, onSaved: @escaping () async -> Void) {
        self.pageId = pageId
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: PageEditorModel(pageId: pageId))
    }

    private static let autosaveDelay: Duration = .milliseconds(1200)

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let message = model.localError ?? model.error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message).font(.footnote).foregroundStyle(.red)
                        HStack {
                            Button("Retry") { Task { await model.retry() } }
                            Button("Copy local text") { UIPasteboard.general.string = model.text; copied = true }
                            if model.serverMarkdown != nil {
                                Button("View server") { Task { await model.load(); showingServer = true } }
                            }
                        }.font(.footnote)
                        Button("Discard local draft…", role: .destructive) { confirmingDiscard = true }
                            .font(.footnote).disabled(model.saving)
                        if model.localError != nil, FileManager.default.fileExists(atPath: model.draftFile.path) {
                            ShareLink("Export stored draft", item: model.draftFile).font(.footnote)
                        }
                    }.padding()
                }
                if model.expected != nil {
                    PageTextView(text: Binding(get: { model.text }, set: { model.updateText($0) }), controller: controller)
                        .safeAreaInset(edge: .bottom) { formatBar }
                } else if model.error == nil && model.localError == nil {
                    ProgressView()
                } else {
                    Spacer()
                }
            }
            .navigationTitle("Edit page")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.dirty && model.error != nil ? "Keep draft and close" : "Done") { Task { await finish() } }
                        .disabled(!model.canClose)
                }
            }
            .task { await model.load() }
            .task(id: model.text + "\(model.saving)") {
                guard model.dirty, model.expected != nil, model.error == nil, !model.saving else { return }
                guard (try? await Task.sleep(for: Self.autosaveDelay)) != nil else { return }
                Task { await model.save() }
            }
            .confirmationDialog("Discard this phone's draft?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard and load server text", role: .destructive) { Task { await model.discardAndReload() } }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("This removes your local changes. Copy or export them first if you want to keep them. The server page is unchanged.")
            }
            .sheet(isPresented: $showingServer) {
                NavigationStack {
                    ScrollView { Text(PageEditorModel.plain(model.serverMarkdown ?? "")).textSelection(.enabled).padding() }
                        .navigationTitle("Server text")
                        .toolbar { Button("Done") { showingServer = false } }
                }
            }
            .sensoryFeedback(.success, trigger: copied)
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true, insertLabel: ("Insert in page", "text.insert")) { spoken in
                    controller.insert(spoken)
                }
            }
        }
        .interactiveDismissDisabled(!model.canClose)
    }

    private var formatBar: some View {
        HStack(spacing: 18) {
            Menu {
                Button("Paragraph") { controller.setLinePrefix("") }
                Button("Heading 1") { controller.setLinePrefix("# ") }
                Button("Heading 2") { controller.setLinePrefix("## ") }
                Button("Heading 3") { controller.setLinePrefix("### ") }
                Button("Bulleted list") { controller.setLinePrefix("- ") }
                Button("Numbered list") { controller.setLinePrefix("1. ") }
                Button("Checklist") { controller.setLinePrefix("- [ ] ") }
            } label: { Image(systemName: "textformat") }
                .accessibilityLabel("Format")
            Button { controller.setLinePrefix("- [ ] ") } label: { Image(systemName: "checklist") }
                .accessibilityLabel("Checklist")
            Button { controller.insert("[link text](https://)") } label: { Image(systemName: "link") }
                .accessibilityLabel("Insert link")
            Button { dictating = true } label: { Image(systemName: "mic") }
                .accessibilityLabel("Dictate into page")
            Spacer()
            Text(status).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private var status: String {
        if model.saving { return "Saving…" }
        if model.localError != nil { return "Not saved locally" }
        return model.dirty ? "Draft on this phone" : "Saved"
    }

    private func finish() async {
        if model.error == nil { await model.save() }
        guard model.canClose, model.client.baseURL == app.serverURL else { return }
        if !model.dirty { await onSaved() }
        ServerOperation(client: model.client).complete(on: app) { dismiss() }
    }

    static func plain(_ markdown: String) -> String { PageEditorModel.plain(markdown) }
}
