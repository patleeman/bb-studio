import SwiftUI

/// A page's actions, the desktop's header buttons and ⋯ menu, as one list:
/// the navigation bar shows Edit and Comments and puts the rest under ⋯; a
/// Workbench tab hands them all to the shell's More.
@MainActor
struct PageActions {
    let page: PageMeta?
    let model: PageModel
    let chats: [PageChat]
    let gone: Bool
    let star: StudioItem?
    let studio: StudioStore
    let open: (PageSheet) -> Void
    let ask: (PageDialog) -> Void
    let act: (@escaping @MainActor (BBClient) async throws -> Void) -> Void

    private var pageId: String { model.pageId }
    private var hasDraft: Bool { PageDraftStore().exists(server: model.serverURL, page: pageId) }

    var edit: WorkbenchTabAction? {
        guard !gone || hasDraft else { return nil }
        return WorkbenchTabAction(id: "edit", title: "Edit", systemImage: "square.and.pencil", run: { open(.editor) })
    }

    var comments: WorkbenchTabAction? {
        guard model.comments != nil, !gone else { return nil }
        let count = model.openComments
        return WorkbenchTabAction(id: "comments", title: count > 0 ? "Comments (\(count))" : "Comments", systemImage: "text.bubble",
                                  run: { open(.comments(focus: nil)) })
    }

    var all: [WorkbenchTabAction] { [edit, comments].compactMap { $0 } + more }

    var more: [WorkbenchTabAction] {
        guard !gone else { return [] }
        var list: [WorkbenchTabAction] = []
        if let star {
            let starred = studio.isStarred(star)
            list.append(WorkbenchTabAction(id: "star", title: starred ? "Unstar" : "Star", systemImage: starred ? "star.slash" : "star", run: {
                act { try await studio.setStarred(star, !starred, client: $0) }
            }))
        }
        list.append(WorkbenchTabAction(id: "addChild", title: "Add a Page Inside", systemImage: "doc.badge.plus", run: addChild))
        list.append(WorkbenchTabAction(id: "rename", title: "Rename", systemImage: "pencil", run: { ask(.rename) }))
        list.append(WorkbenchTabAction(id: "icon", title: page?.emoji == nil ? "Add Icon" : "Change Icon", systemImage: "face.smiling",
                                       run: { open(.icon) }))
        list.append(WorkbenchTabAction(id: "history", title: "Version History", systemImage: "clock.arrow.circlepath", run: { open(.history) }))
        list.append(WorkbenchTabAction(id: "activity", title: "Activity", systemImage: "clock", run: { open(.activity) }))
        if !chats.isEmpty {
            list.append(WorkbenchTabAction(id: "chats", title: "Chats (\(chats.count))", systemImage: Symbols.thread, run: { open(.chats) }))
        }
        list.append(WorkbenchTabAction(id: "related", title: "Related", systemImage: "link", run: { open(.related) }))
        list.append(WorkbenchTabAction(id: "copyMarkdown", title: "Copy as Markdown", systemImage: "doc.on.doc", disabled: model.markdown == nil,
                                       run: { UIPasteboard.general.string = model.plainMarkdown }))
        list.append(WorkbenchTabAction(id: "copyReference", title: "Copy Reference", systemImage: "at", run: {
            UIPasteboard.general.string = "@[\(page?.displayTitle ?? "Page")](page:\(pageId))"
        }))
        list.append(WorkbenchTabAction(id: "share", title: "Share Link", systemImage: "square.and.arrow.up",
                                       share: AppModel.shared.client.webURL(forPage: pageId).absoluteURL))
        list.append(WorkbenchTabAction(id: "exportPDF", title: "Export PDF", systemImage: "doc.richtext", run: { export("pdf") }))
        list.append(WorkbenchTabAction(id: "exportMarkdown", title: "Export Markdown", systemImage: "arrow.down.doc", run: { export("markdown") }))
        list.append(WorkbenchTabAction(id: "web", title: "Open in BB Web", systemImage: "safari", run: { open(.web) }))
        if page?.parentId != nil {
            list.append(WorkbenchTabAction(id: "moveTop", title: "Move to Top Level", systemImage: "arrow.up.to.line", run: {
                act { try await $0.updatePage(pageId, parentId: .some(nil)) }
            }))
        }
        if page?.archived == true {
            list.append(WorkbenchTabAction(id: "restore", title: "Restore from Archive", systemImage: "arrow.uturn.backward", run: {
                act { try await $0.updatePage(pageId, archived: false) }
            }))
        } else {
            list.append(WorkbenchTabAction(id: "archive", title: "Archive", systemImage: "archivebox", run: { ask(.archive) }))
        }
        list.append(WorkbenchTabAction(id: "delete", title: "Delete", systemImage: "trash", role: .destructive, run: { ask(.delete) }))
        return list
    }

    /// A new empty page inside this one, opened at once (an empty page opens in the editor).
    private func addChild() {
        let projectId = page?.projectId
        act { client in
            let child = try await client.createPage(projectId: projectId, parentId: pageId)
            AppModel.shared.push(.page(id: child.id))
        }
    }

    /// Studio's export of the page, written to a file for the share sheet.
    private func export(_ format: String) {
        let title = page?.displayTitle ?? "Page"
        act { client in
            guard let file = try await client.exportItem(pluginId: "pages", id: pageId, format: format).first,
                  let data = Data(base64Encoded: file.data) else { throw BBError(status: 0, message: "Studio sent no file.") }
            let folder = FileManager.default.temporaryDirectory.appending(path: "page-export-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let name = file.name.isEmpty ? "\(title).\(format == "pdf" ? "pdf" : "md")" : file.name
            let url = folder.appending(path: name.replacingOccurrences(of: "/", with: "-"))
            try data.write(to: url)
            open(.export(url))
        }
    }
}
