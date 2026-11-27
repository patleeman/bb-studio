import SwiftUI

/// Everything a page shows over itself: one sheet at a time and its dialogs.
struct PagePresentations: ViewModifier {
    @ObservedObject var model: PageModel
    @Binding var sheet: PageSheet?
    @Binding var dialog: PageDialog?
    @Binding var newTitle: String
    @Binding var notice: String?
    let chats: [PageChat]
    let title: String
    let act: (@escaping @MainActor (BBClient) async throws -> Void) -> Void
    /// Scrolls the page to a block, from a comment.
    let showBlock: (String) -> Void
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.inWorkbench) private var inWorkbench

    func body(content: Content) -> some View {
        content
            .sheet(item: $sheet) { sheet in PageSheetView(sheet: sheet, model: model, chats: chats, act: act, showBlock: showBlock) }
            .alert("Rename page", isPresented: isShowing(.rename)) {
                TextField("Title", text: $newTitle)
                Button("Cancel", role: .cancel) {}
                Button("Rename") {
                    let title = newTitle, expected = self.title
                    act { try await $0.updatePage(model.pageId, title: title, expectedTitle: expected) }
                }
            }
            .confirmationDialog("Archive this page?", isPresented: isShowing(.archive), titleVisibility: .visible) {
                Button("Archive") { act { try await $0.updatePage(model.pageId, archived: true) } }
            } message: {
                Text("It leaves the page list. Restore it from its ⋯ menu or the Library.")
            }
            .confirmationDialog("Delete this page?", isPresented: isShowing(.delete), titleVisibility: .visible) {
                Button("Delete", role: .destructive) { delete() }
            } message: {
                Text("The page and every page inside it are deleted. This can't be undone.")
            }
            .onChange(of: dialog) { _, dialog in
                if dialog == .rename { newTitle = title }
            }
    }

    private func isShowing(_ which: PageDialog) -> Binding<Bool> {
        Binding(get: { dialog == which }, set: { if !$0, dialog == which { dialog = nil } })
    }

    private func delete() {
        let pageId = model.pageId
        act { client in
            _ = try await client.removePage(pageId)
            model.missing = true
            // Pushed, the page leaves; in a tab it says it's gone.
            if !inWorkbench { dismiss() }
        }
    }
}

/// The sheet for one `PageSheet`.
private struct PageSheetView: View {
    let sheet: PageSheet
    @ObservedObject var model: PageModel
    let chats: [PageChat]
    let act: (@escaping @MainActor (BBClient) async throws -> Void) -> Void
    let showBlock: (String) -> Void
    @EnvironmentObject private var app: AppModel

    var body: some View {
        switch sheet {
        case .editor: PageEditor(pageId: model.pageId) { await model.load(app.client) }
        case .comments(let focus): PageCommentsSheet(model: model, focus: focus, showBlock: showBlock)
        case .newComment(let block): NewPageCommentSheet(model: model, block: block)
        case .history: PageHistorySheet(pageId: model.pageId)
        case .activity: PageActivity(pageId: model.pageId)
        case .related: RelatedView(pluginId: "pages", itemId: model.pageId)
        case .chats: PageChatsSheet(chats: chats)
        case .icon: PageIconPicker(current: model.meta?.emoji) { icon in act { try await $0.updatePage(model.pageId, icon: icon) } }
        case .web: PageWebSheet(url: app.client.webURL(forPage: model.pageId))
        case .export(let url): ActivitySheet(items: [url]).ignoresSafeArea()
        }
    }
}

/// The desktop's twenty page icons, and Remove.
struct PageIconPicker: View {
    static let icons = ["📄", "📝", "📋", "✅", "📊", "📈", "🗺️", "🧭", "💡", "🚀", "🧪", "🛠️", "📚", "🗓️", "🎯", "🔥", "⭐", "🧠", "🤖", "📣"]
    let current: String?
    let choose: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 56), spacing: 8)], spacing: 8) {
                    ForEach(Self.icons, id: \.self) { icon in
                        Button { pick(icon) } label: {
                            Text(icon).font(.system(size: 32)).frame(width: 56, height: 56)
                                .background(icon == current ? AnyShapeStyle(.tint.opacity(0.2)) : AnyShapeStyle(.fill.quaternary), in: .rect(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(icon == current ? .isSelected : [])
                        .accessibilityIdentifier("pageIcon-\(icon)")
                    }
                }
                .padding()
            }
            .navigationTitle("Page icon")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if current != nil {
                    ToolbarItem(placement: .destructiveAction) { Button("Remove", role: .destructive) { pick("") } }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func pick(_ icon: String) {
        choose(icon)
        dismiss()
    }
}

/// The page's "Work with this page" conversations, newest first.
private struct PageChatsSheet: View {
    let chats: [PageChat]
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(chats, id: \.threadId) { chat in
                Button {
                    dismiss()
                    app.push(.thread(id: chat.threadId))
                } label: {
                    Label { Text(Date(timeIntervalSince1970: chat.createdAt / 1000), format: .dateTime.month().day().hour().minute()) }
                        icon: { Image(systemName: Symbols.thread) }
                }
            }
            .navigationTitle("Chats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}

private struct PageWebSheet: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WebView(url: url)
                .ignoresSafeArea(edges: .bottom)
                .toolbar { Button("Done") { dismiss() } }
        }
    }
}
