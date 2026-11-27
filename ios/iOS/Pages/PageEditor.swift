import PhotosUI
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
    @State private var mentioning = false
    @State private var photo: PhotosPickerItem?
    @State private var uploading = false

    init(pageId: String, note: NoteDoneActions? = nil, onSaved: @escaping () async -> Void) {
        self.pageId = pageId
        self.note = note
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: PageEditorModel(pageId: pageId))
    }

    private static let autosaveDelay: Duration = .milliseconds(1200)

    var body: some View {
        NavigationStack {
            withDialogs
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

    // `body` in parts, so each type-checks quickly (whole, it took 2 s).

    /// The problems, the text and its format bar.
    private var content: some View {
        VStack(spacing: 0) {
            PageEditorProblems(model: model, noteError: $noteError, copied: $copied, showingServer: $showingServer,
                               confirmingDiscard: $confirmingDiscard)
            if model.expected != nil {
                PageTextView(text: Binding(get: { model.text }, set: { model.updateText($0) }), controller: controller, dictation: dictation)
                    .safeAreaInset(edge: .bottom) {
                        PageFormatBar(controller: controller, dictation: dictation, status: status,
                                      mentioning: $mentioning, photo: $photo, dictating: $dictating)
                    }
            } else if model.error == nil && model.localError == nil {
                ProgressView()
            } else {
                Spacer()
            }
        }
    }

    /// Title, toolbar, loading and autosave.
    private var editor: some View {
        content
        .navigationTitle(note == nil ? "Edit page" : "Notes")
        .navigationSubtitle(note?.note.shortTitle ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(closeTitle) { Task { await finish() } }
                    .disabled(!model.canClose || noteBusy)
            }
            if note != nil { noteToolbar }
        }
        .modifier(PageAutosave(model: model, finished: finished, delay: Self.autosaveDelay))
    }

    /// Keep, discard, the server text, mentions, photos and dictation: each group its own
    /// modifier, so the editor's view type stays shallow (the 1 MB stack).
    private var withDialogs: some View {
        editor
            .modifier(PageNoteDialogs(keeping: $keeping, keptTitle: $keptTitle, confirmingDiscard: $confirmingNoteDiscard,
                                      keep: { await keepNote() }, discard: { await discardNote() }))
            .modifier(PageDraftDialogs(model: model, confirmingDiscard: $confirmingDiscard, showingServer: $showingServer, copied: copied))
            .modifier(PageEditorInputs(controller: controller, dictation: dictation, mentioning: $mentioning, dictating: $dictating,
                                       photo: $photo, upload: { await upload($0) }))
    }

    private var closeTitle: String {
        if model.dirty && model.error != nil { return "Keep draft and close" }
        return note == nil ? "Done" : "Close"
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

    private var status: String {
        if uploading { return "Uploading photo…" }
        if model.saving { return "Saving…" }
        if model.localError != nil { return "Not saved locally" }
        return model.dirty ? "Draft on this phone" : "Saved"
    }

    /// A photo from the library, uploaded to the page and put at the cursor as an image.
    private func upload(_ item: PhotosPickerItem) async {
        uploading = true
        defer { uploading = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // Studio keeps files up to 15 MB; a JPEG of the photo keeps it well under.
            let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) ?? data
            let url = try await model.client.uploadPageFile(pageId, name: "photo.jpg", mime: "image/jpeg", data: jpeg)
            controller.insertBlock("![Photo](\(url))")
        } catch {
            noteError = BBClient.describe(error, server: model.client.baseURL)
        }
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
}
