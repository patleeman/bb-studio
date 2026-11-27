import PhotosUI
import SwiftUI

// PageEditor's parts, each a view or modifier of its own: a struct's body is a
// new, shallow type, where computed properties on one struct nest into one
// deep type (the launch-crash lesson, a 1 MB main stack).

/// Why the text isn't saved, and what can be done: retry, copy, the server's text, discard, export.
struct PageEditorProblems: View {
    @ObservedObject var model: PageEditorModel
    @Binding var noteError: String?
    @Binding var copied: Bool
    @Binding var showingServer: Bool
    @Binding var confirmingDiscard: Bool

    var body: some View {
        if let noteError {
            Text(noteError).font(.footnote).foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal).padding(.top, 8)
                .onTapGesture { self.noteError = nil }
        }
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
    }
}

/// The bar over the keyboard: format, checklist, link, mention, Insert, dictate, and the save status.
struct PageFormatBar: View {
    let controller: PageTextController
    @ObservedObject var dictation: DictationGate
    let status: String
    @Binding var mentioning: Bool
    @Binding var photo: PhotosPickerItem?
    @Binding var dictating: Bool

    var body: some View {
        HStack(spacing: 14) {
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
            Button { mentioning = true } label: { Image(systemName: "at") }
                .accessibilityLabel("Mention")
            PageInsertMenu(controller: controller, mentioning: $mentioning, photo: $photo)
            Button { dictating = true } label: { Image(systemName: "mic") }
                .accessibilityLabel("Dictate into page")
            Spacer()
            if dictation.state.label != nil {
                DictationSendStatus(gate: dictation)
            } else {
                Text(status).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

/// Loads the page, saves a moment after typing stops, and at once when the app leaves the screen.
struct PageAutosave: ViewModifier {
    @ObservedObject var model: PageEditorModel
    /// Sent, kept or discarded: nothing more to save.
    let finished: Bool
    let delay: Duration
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .task { await model.load() }
            .task(id: model.text + "\(model.saving)") {
                guard !finished, model.dirty, model.expected != nil, model.error == nil, !model.saving else { return }
                guard (try? await Task.sleep(for: delay)) != nil else { return }
                Task { await model.save() }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active, !finished { Task { await model.save() } }
            }
    }
}

/// A temp note's Keep as page and Discard.
struct PageNoteDialogs: ViewModifier {
    @Binding var keeping: Bool
    @Binding var keptTitle: String
    @Binding var confirmingDiscard: Bool
    let keep: () async -> Void
    let discard: () async -> Void

    func body(content: Content) -> some View {
        content
            .alert("Keep as page", isPresented: $keeping) {
                TextField("Title", text: $keptTitle)
                Button("Cancel", role: .cancel) {}
                Button("Keep page") { Task { await keep() } }
                    .disabled(keptTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("It stays in Notes as an ordinary page, no longer a temp note on this thread.")
            }
            .confirmationDialog("Discard these notes?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { Task { await discard() } }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("The page is deleted, with everything typed in it. This can't be undone.")
            }
    }
}

/// This phone's draft: discard it, or read the server's text.
struct PageDraftDialogs: ViewModifier {
    @ObservedObject var model: PageEditorModel
    @Binding var confirmingDiscard: Bool
    @Binding var showingServer: Bool
    let copied: Bool

    func body(content: Content) -> some View {
        content
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
    }
}

/// What goes in at the cursor from outside the keyboard: a mention, a photo, dictation.
struct PageEditorInputs: ViewModifier {
    let controller: PageTextController
    @ObservedObject var dictation: DictationGate
    @Binding var mentioning: Bool
    @Binding var dictating: Bool
    @Binding var photo: PhotosPickerItem?
    let upload: (PhotosPickerItem) async -> Void

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $mentioning) { PageMentionPicker { controller.insert($0) } }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                photo = nil
                Task { await upload(item) }
            }
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true, insertLabel: ("Insert in page", "text.insert"), gate: dictation) { spoken in
                    controller.insert(spoken)
                }
            }
    }
}
