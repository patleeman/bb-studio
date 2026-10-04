import SwiftUI

/// Type something now, decide where it goes after. The draft survives closing
/// the sheet, so a half-written thought is still there next time.
struct QuickWriteView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @AppStorage(ServerScope.key("quickWriteDraft")) private var text = ""
    @AppStorage(ServerScope.key("runningPlugins")) private var runningPlugins = ""
    @FocusState private var focused: Bool
    @State private var dictating = false
    @State private var startingThread = false
    @State private var saving = false
    @State private var error: String?

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private func running(_ id: String) -> Bool { runningPlugins.split(separator: ",").contains(Substring(id)) }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text("Write something…")
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $text)
                    .focused($focused)
                    .scrollContentBackground(.hidden)
                    .accessibilityIdentifier("quickWriteText")
            }
            .padding(.horizontal)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                    HStack {
                        Button { dictating = true } label: {
                            Label("Dictate", systemImage: "mic.fill").labelStyle(.iconOnly)
                        }
                        .accessibilityIdentifier("quickWriteDictate")
                        Spacer()
                        if !trimmed.isEmpty {
                            Text("\(trimmed.split(whereSeparator: \.isWhitespace).count) words")
                                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                    .font(.title3)
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .navigationTitle("Write")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { operation.complete(on: app) { dismiss() } } }
                ToolbarItem(placement: .confirmationAction) { saveMenu }
            }
            .sheet(isPresented: $dictating) {
                DictationView(threadId: nil, autoStart: true, insertLabel: ("Insert", "text.insert")) { spoken in
                    text = text.isEmpty ? spoken : text + (text.hasSuffix("\n") ? "" : "\n\n") + spoken
                    focused = true
                }
            }
            .sheet(isPresented: $startingThread) { NewThreadView(text: trimmed) }
            .onAppear { focused = true }
        }
    }

    /// Save makes a page; the menu offers the other homes for it.
    private var saveMenu: some View {
        Menu {
            if running("pages") {
                Button("Save as Page", systemImage: "doc.richtext") { Task { await savePage() } }
            }
            Button("Start a Thread", systemImage: "bubble.left.and.text.bubble.right") { startingThread = true }
            Button("Copy", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = trimmed
                text = ""
                operation.complete(on: app) { dismiss() }
            }
        } label: {
            if saving { ProgressView() } else { Text("Save").fontWeight(.semibold) }
        } primaryAction: {
            if running("pages") { Task { await savePage() } } else { startingThread = true }
        }
        .disabled(trimmed.isEmpty || saving)
        .accessibilityIdentifier("quickWriteSave")
    }

    private func savePage() async {
        await attempt {
            let page = try await client.createPage(title: PageTitle.from(trimmed), markdown: trimmed)
            operation.complete(on: app) { app.openPage(page.id) }
        }
    }

    private func attempt(_ work: () async throws -> Void) async {
        saving = true
        defer { saving = false }
        do {
            try await work()
            guard client.baseURL == app.serverURL else { return }
            text = ""
            operation.complete(on: app) { dismiss() }
            Task { await StudioStore.shared.load(client) }
        } catch {
            self.error = (error as? BBError)?.message ?? BBClient.describe(error, server: client.baseURL)
        }
    }
}
