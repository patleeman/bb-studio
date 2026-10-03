import SwiftUI

/// Edits the whole page as one Markdown text and saves a moment after typing
/// stops. The server compares the document it was loaded from, so an edit made
/// elsewhere in the meantime is never overwritten; the text stays on screen.
struct PageEditor: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    let pageId: String
    var onSaved: () async -> Void

    /// The page with block ids, as the server last confirmed it.
    @State private var expected: String?
    @State private var text = ""
    @State private var saved = ""
    @State private var saving = false
    @State private var error: String?
    @State private var dictating = false
    @State private var confirmingDiscard = false
    @State private var controller = PageTextController()

    private static let autosaveDelay: Duration = .milliseconds(1200)

    var body: some View {
        NavigationStack {
            Group {
                if expected == nil, let error {
                    ContentUnavailableView("Couldn't load the page", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if expected == nil {
                    ProgressView()
                } else {
                    VStack(spacing: 0) {
                        if let error {
                            HStack {
                                Text(error).font(.footnote).foregroundStyle(.red)
                                Spacer()
                                Button("Reload") { Task { await load() } }.font(.footnote)
                            }
                            .padding(.horizontal).padding(.vertical, 8)
                        }
                        PageTextView(text: $text, controller: controller)
                    }
                    // Rides above the keyboard, and stays when a hardware keyboard hides it.
                    .safeAreaInset(edge: .bottom) { formatBar }
                }
            }
            .navigationTitle("Edit page")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { Task { await finish() } }
                }
            }
            .task { await load() }
            .task(id: text) {
                guard text != saved, expected != nil else { return }
                // Typing again cancels the wait, but never a save in flight.
                guard (try? await Task.sleep(for: Self.autosaveDelay)) != nil else { return }
                Task { await save() }
            }
            .confirmationDialog("Your latest changes aren't saved.", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { operation.complete(on: app) { dismiss() } }
                Button("Keep editing", role: .cancel) {}
            }
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true, insertLabel: ("Insert in page", "text.insert")) { spoken in
                    controller.insert(spoken)
                }
            }
        }
        .interactiveDismissDisabled(text != saved)
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
        if saving { return "Saving…" }
        if error != nil { return "Not saved" }
        return text == saved ? "Saved" : "Edited"
    }

    private func load() async {
        if pageId == "qa-demo", ProcessInfo.processInfo.arguments.contains("-qaPageDemo") {
            expected = "<!-- ^11111111-1111-1111-1111-111111111111 -->\n# Launch plan\n\n<!-- ^22222222-2222-2222-2222-222222222222 -->\nShip it"
            text = Self.plain(expected!)
            saved = text
            return
        }
        do {
            let markdown = try await client.editablePageMarkdown(pageId)
            expected = markdown
            text = Self.plain(markdown)
            saved = text
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    /// Saves the current text. Saves run one at a time; a later one picks up
    /// whatever was typed while an earlier one was in flight.
    private func save() async {
        guard !saving, let current = expected, text != saved else { return }
        if pageId == "qa-demo", ProcessInfo.processInfo.arguments.contains("-qaPageDemo") {
            saved = text
            return
        }
        let sending = text
        saving = true
        defer { saving = false }
        do {
            expected = try await client.editPageDocument(pageId, expected: current, markdown: sending)
            saved = sending
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return
        }
        saving = false
        if text != saved { await save() }
    }

    private func finish() async {
        while saving { try? await Task.sleep(for: .milliseconds(100)) }
        if error == nil { await save() }
        guard text == saved else { confirmingDiscard = true; return }
        guard client.baseURL == app.serverURL else { return }
        await onSaved()
        operation.complete(on: app) { dismiss() }
    }

    /// The editable Markdown without its `<!-- ^id -->` block markers.
    static func plain(_ markdown: String) -> String {
        markdown
            .split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("<!-- ^") }
            .joined(separator: "\n")
            .replacing(/\n{3,}/, with: "\n\n")
            .trimmingCharacters(in: .newlines)
    }
}
