import SwiftUI

/// Edits the whole page as one Markdown text and saves a moment after typing
/// stops. The server compares the document it was loaded from, so an edit made
/// elsewhere in the meantime is never overwritten; the text stays on screen.
///
/// Every change is written to this phone first (`PageDraftStore`), so closing
/// the app loses nothing; leaving the app saves to the server at once.
///
/// With `note`, the page is a thread's temp note ("Expand to page"), and the
/// toolbar has its done actions: Send to thread, Keep as page, Discard.
struct PageEditor: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let pageId: String
    var note: NoteDoneActions?
    var onSaved: () async -> Void
    @StateObject private var model: PageEditorModel
    /// Send and Keep wait while dictation (the mic or the keyboard's) has words on the way.
    @StateObject private var dictation = DictationGate()
    @State private var dictating = false
    @State private var noteBusy = false
    @State private var noteError: String?
    @State private var keeping = false
    @State private var keptTitle = ""
    @State private var confirmingNoteDiscard = false
    /// Set once the note is sent, kept or discarded: nothing more to save here.
    @State private var finished = false
    @State private var confirmingDiscard = false
    @State private var showingServer = false
    @State private var copied = false
    @State private var controller = PageTextController()

    init(pageId: String, note: NoteDoneActions? = nil, onSaved: @escaping () async -> Void) {
        self.pageId = pageId
        self.note = note
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: PageEditorModel(pageId: pageId))
    }

    private static let autosaveDelay: Duration = .milliseconds(1200)

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
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
                if model.expected != nil {
                    PageTextView(text: Binding(get: { model.text }, set: { model.updateText($0) }), controller: controller, dictation: dictation)
                        .safeAreaInset(edge: .bottom) { formatBar }
                } else if model.error == nil && model.localError == nil {
                    ProgressView()
                } else {
                    Spacer()
                }
            }
            .navigationTitle(note == nil ? "Edit page" : "Notes")
            .navigationSubtitle(note?.note.shortTitle ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.dirty && model.error != nil ? "Keep draft and close" : note == nil ? "Done" : "Close") { Task { await finish() } }
                        .disabled(!model.canClose || noteBusy)
                }
                if note != nil { noteToolbar }
            }
            .task { await model.load() }
            .task(id: model.text + "\(model.saving)") {
                guard !finished, model.dirty, model.expected != nil, model.error == nil, !model.saving else { return }
                guard (try? await Task.sleep(for: Self.autosaveDelay)) != nil else { return }
                Task { await model.save() }
            }
            // Leaving the app: save now rather than after the pause.
            .onChange(of: scenePhase) { _, phase in
                if phase != .active, !finished { Task { await model.save() } }
            }
            .alert("Keep as page", isPresented: $keeping) {
                TextField("Title", text: $keptTitle)
                Button("Cancel", role: .cancel) {}
                Button("Keep page") { Task { await keepNote() } }
                    .disabled(keptTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("It stays in Notes as an ordinary page, no longer a temp note on this thread.")
            }
            .confirmationDialog("Discard these notes?", isPresented: $confirmingNoteDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { Task { await discardNote() } }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("The page is deleted, with everything typed in it. This can't be undone.")
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
                DictationView(threadId: nil, autoStart: true, insertLabel: ("Insert in page", "text.insert"), gate: dictation) { spoken in
                    controller.insert(spoken)
                }
            }
            #if DEBUG
            .task {
                switch NotesDemo.variant {
                case .keep?: keptTitle = note?.note.title ?? ""; keeping = note != nil
                case .discard?: confirmingNoteDiscard = note != nil
                default: break
                }
            }
            #endif
        }
        .interactiveDismissDisabled(!model.canClose || note != nil)
    }

    @ToolbarContentBuilder
    private var noteToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button(role: .destructive) { confirmingNoteDiscard = true } label: { Label("Discard", systemImage: "trash") }
                .disabled(noteBusy)
                .accessibilityIdentifier("noteDiscard")
            Button { keptTitle = note?.note.title ?? ""; keeping = true } label: { Label("Keep as page", systemImage: "checkmark") }
                .disabled(noteBusy || dictation.blocksSend)
                .accessibilityIdentifier("noteKeep")
        }
        ToolbarSpacer(.fixed, placement: .primaryAction)
        ToolbarItem(placement: .primaryAction) {
            Button { Task { await sendNote() } } label: {
                if noteBusy { ProgressView() } else { Label("Send to thread", systemImage: "arrow.up") }
            }
            .buttonStyle(.borderedProminent)
            .disabled(noteBusy || dictation.blocksSend)
            .keyboardShortcut(.return, modifiers: .command)
            .accessibilityIdentifier("noteSend")
        }
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

    private var status: String {
        if model.saving { return "Saving…" }
        if model.localError != nil { return "Not saved locally" }
        return model.dirty ? "Draft on this phone" : "Saved"
    }

    /// Saves the latest typing first, so the thread gets everything on screen.
    private func savedForNote() async -> Bool {
        await model.save()
        guard !model.dirty, model.error == nil, model.localError == nil, model.expected != nil else {
            noteError = "Couldn't save the latest typing to BB, so the notes stay open here. Try again."
            return false
        }
        return true
    }

    private func sendNote() async {
        guard let note, !noteBusy, !dictation.blocksSend else { return }
        noteBusy = true
        defer { noteBusy = false }
        guard await savedForNote() else { return }
        do {
            let message = try await note.send()
            close(flash: message)
        } catch {
            noteError = BBClient.describe(error, server: model.client.baseURL)
        }
    }

    private func keepNote() async {
        let title = keptTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let note, !title.isEmpty, !noteBusy, !dictation.blocksSend else { return }
        noteBusy = true
        defer { noteBusy = false }
        guard await savedForNote() else { return }
        do {
            try await note.keep(title)
            close(flash: "Kept as a page in Notes.")
        } catch {
            noteError = BBClient.describe(error, server: model.client.baseURL)
        }
    }

    private func discardNote() async {
        guard let note, !noteBusy else { return }
        noteBusy = true
        defer { noteBusy = false }
        do {
            try await note.discard()
            // The page is gone; so is this phone's copy of it.
            model.forgetDraft()
            close(flash: "Discarded the notes.")
        } catch {
            noteError = BBClient.describe(error, server: model.client.baseURL)
        }
    }

    private func close(flash message: String) {
        finished = true
        ServerOperation(client: model.client).complete(on: app) {
            app.flash(message)
            dismiss()
        }
    }

    private func finish() async {
        if model.error == nil { await model.save() }
        guard model.canClose, model.client.baseURL == app.serverURL else { return }
        if !model.dirty { await onSaved() }
        ServerOperation(client: model.client).complete(on: app) { dismiss() }
    }

    static func plain(_ markdown: String) -> String { PageEditorModel.plain(markdown) }
}
