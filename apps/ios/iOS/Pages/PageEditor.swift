import SwiftUI

struct EditablePageBlock: Identifiable {
    let id: String
    let markdown: String

    static func parse(_ source: String) -> [Self] {
        let lines = source.components(separatedBy: "\n")
        var blocks: [Self] = []
        var currentId: String?
        var content: [String] = []
        func finish() {
            if let currentId {
                blocks.append(Self(id: currentId, markdown: content.joined(separator: "\n").trimmingCharacters(in: .newlines)))
            }
        }
        for line in lines {
            if line.hasPrefix("<!-- ^"), line.hasSuffix(" -->") {
                finish()
                currentId = String(line.dropFirst(6).dropLast(4))
                content = []
            } else if currentId != nil {
                content.append(line)
            }
        }
        finish()
        return blocks
    }
}

/// Edits one server Yjs block at a time. The server rejects a stale document,
/// leaving the draft on screen so a concurrent edit cannot be overwritten.
struct PageEditor: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let pageId: String
    var onSaved: () async -> Void

    @State private var original = ""
    @State private var blocks: [EditablePageBlock] = []
    @State private var selected: String?
    @State private var draft = ""
    @State private var saving = false
    @State private var error: String?
    @State private var dictating = false

    var body: some View {
        NavigationStack {
            Group {
                if let error, original.isEmpty && blocks.isEmpty && selected == nil {
                    ContentUnavailableView("Couldn't load the page", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if original.isEmpty && blocks.isEmpty && selected == nil {
                    ProgressView()
                } else if selected != nil {
                    editor
                } else {
                    List {
                        ForEach(blocks) { block in
                            Button {
                                selected = block.id
                                draft = block.markdown
                            } label: {
                                Text(block.markdown.isEmpty ? "Empty paragraph" : block.markdown)
                                    .lineLimit(3)
                                    .foregroundStyle(.primary)
                            }
                            .accessibilityIdentifier("pageBlock-\(block.id)")
                        }
                        Button { selected = ""; draft = "" } label: {
                            Label("Add block", systemImage: "plus")
                        }
                    }
                }
            }
            .navigationTitle(selected == nil ? "Edit page" : "Edit block")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(selected == nil ? "Done" : "Back") {
                        if selected == nil { dismiss() } else { selected = nil; error = nil }
                    }
                }
                if selected != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { Task { await save() } }
                            .disabled(saving || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .task { await load() }
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true, insertLabel: ("Insert in page", "text.insert")) { text in
                    draft += (draft.isEmpty ? "" : "\n") + text
                }
            }
        }
    }

    private var editor: some View {
        VStack(spacing: 12) {
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
                Button("Reload page") { Task { await load(); selected = nil; self.error = nil } }
            }
            TextEditor(text: $draft)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(.fill.tertiary, in: .rect(cornerRadius: 12))
                .accessibilityIdentifier("pageBlockEditor")
            HStack {
                Menu {
                    Button("Paragraph") { setPrefix("") }
                    Button("Heading 1") { setPrefix("# ") }
                    Button("Heading 2") { setPrefix("## ") }
                    Button("Heading 3") { setPrefix("### ") }
                    Button("Bulleted list") { setPrefix("- ") }
                    Button("Numbered list") { setPrefix("1. ") }
                    Button("Checklist") { setPrefix("- [ ] ") }
                } label: { Label("Format", systemImage: "textformat") }
                Spacer()
                Button { draft += "[link text](https://)" } label: { Image(systemName: "link") }
                    .accessibilityLabel("Insert link")
                Button { dictating = true } label: { Image(systemName: "mic") }
                    .accessibilityLabel("Dictate into page")
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }

    private func setPrefix(_ prefix: String) {
        var text = draft
        for old in ["- [ ] ", "### ", "## ", "# ", "- ", "1. "] where text.hasPrefix(old) {
            text.removeFirst(old.count)
            break
        }
        draft = prefix + text
    }

    private func load() async {
        if pageId == "qa-demo", ProcessInfo.processInfo.arguments.contains("-qaPageDemo") {
            original = "<!-- ^11111111-1111-1111-1111-111111111111 -->\n# Launch plan\n\n<!-- ^22222222-2222-2222-2222-222222222222 -->\nShip it"
            blocks = EditablePageBlock.parse(original)
            return
        }
        do {
            original = try await app.client.editablePageMarkdown(pageId)
            blocks = EditablePageBlock.parse(original)
            if original.isEmpty { selected = ""; draft = "" }
            else if blocks.count == 1 && blocks[0].markdown.isEmpty {
                selected = blocks[0].id
                draft = ""
            }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func save() async {
        guard let selected else { return }
        saving = true
        defer { saving = false }
        do {
            original = try await app.client.editPageBlock(
                pageId, expected: original, block: selected.isEmpty ? nil : selected, markdown: draft)
            blocks = EditablePageBlock.parse(original)
            self.selected = nil
            error = nil
            await onSaved()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
