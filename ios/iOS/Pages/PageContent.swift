import SwiftUI

/// The page's scroll: breadcrumbs, icon and title, the archived banner, the
/// blocks, and the pages inside it. `focusBlock` scrolls to a block and
/// pulses it (a comment's "Show in page").
struct PageScroll: View {
    @ObservedObject var model: PageModel
    let meta: PageMeta?
    @Binding var focusBlock: String?
    @Binding var sheet: PageSheet?
    let restore: () -> Void
    @EnvironmentObject private var app: AppModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error = model.error {
                        PagesErrorRow(message: error) { await model.load(app.client) }
                    }
                    PageDraftBanner(model: model, sheet: $sheet)
                    PageHeader(model: model, meta: meta, sheet: $sheet, restore: restore)
                    PageBody(model: model, focusBlock: focusBlock, sheet: $sheet)
                    PageChildren(pageId: model.pageId)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .modifier(RegularScrollingSurface())
            .refreshable {
                async let tree: Void = PagesStore.shared.load(app.client)
                await model.load(app.client)
                await tree
            }
            .onChange(of: focusBlock) { _, block in
                guard let block else { return }
                withAnimation(.snappy) { proxy.scrollTo(block, anchor: .center) }
                Task {
                    try? await Task.sleep(for: .seconds(1.6))
                    if focusBlock == block { focusBlock = nil }
                }
            }
        }
        .accessibilityIdentifier("pageScroll")
    }
}

/// "Resume draft on this phone", over a page with unsaved edits here.
private struct PageDraftBanner: View {
    @ObservedObject var model: PageModel
    @Binding var sheet: PageSheet?

    var body: some View {
        if PageDraftStore().exists(server: model.serverURL, page: model.pageId) {
            Button { sheet = .editor } label: {
                Label("Resume draft on this phone", systemImage: "doc.badge.clock").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }
}

/// Parents as a trail, the icon (tap to change), the title, where and when it was edited, and the archived banner.
private struct PageHeader: View {
    @ObservedObject var model: PageModel
    let meta: PageMeta?
    @Binding var sheet: PageSheet?
    let restore: () -> Void
    @ObservedObject private var store = PagesStore.shared
    @EnvironmentObject private var app: AppModel

    /// The page's parents, the top one first.
    private var parents: [PageMeta] {
        var trail: [PageMeta] = []
        var next = meta?.parentId
        while let id = next, let parent = store.page(id), !trail.contains(where: { $0.id == id }) {
            trail.insert(parent, at: 0)
            next = parent.parentId
        }
        return trail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !parents.isEmpty { breadcrumbs }
            if meta?.archived == true { archived }
            Button { sheet = .icon } label: {
                if let emoji = meta?.emoji {
                    Text(emoji).font(.system(size: 44))
                } else {
                    Label("Add icon", systemImage: "face.smiling").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(meta?.emoji == nil ? "Add icon" : "Change icon")
            .accessibilityIdentifier("pageIcon")
            Text(meta?.displayTitle ?? " ")
                .font(.largeTitle.bold())
                .foregroundStyle(meta?.title?.isEmpty == false ? .primary : .secondary)
            if let meta, let updatedAt = meta.updatedAt { edited(meta, updatedAt) }
        }
    }

    private var breadcrumbs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(parents) { parent in
                    Button { app.push(.page(id: parent.id)) } label: {
                        Text([parent.emoji, parent.displayTitle].compactMap { $0 }.joined(separator: " ")).lineLimit(1)
                    }
                    .frame(minHeight: 44)
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            .font(.footnote)
        }
        .accessibilityIdentifier("pageBreadcrumbs")
    }

    private var archived: some View {
        HStack {
            Label("This page is archived.", systemImage: "archivebox").font(.subheadline)
            Spacer()
            Button("Restore", action: restore).buttonStyle(.bordered).controlSize(.small)
        }
        .padding(10)
        .background(.fill.tertiary, in: .rect(cornerRadius: 10))
        .accessibilityIdentifier("pageArchivedBanner")
    }

    private func edited(_ meta: PageMeta, _ updatedAt: Double) -> some View {
        HStack(spacing: 4) {
            Text(meta.projectId.map { store.projectNames[$0] ?? "Project" } ?? "Global")
            Text("·")
            Text("Edited")
            Text(Date(timeIntervalSince1970: updatedAt / 1000), format: .relative(presentation: .named, unitsStyle: .wide))
            if let by = meta.updatedBy, !by.isEmpty, by != "user" { Text("by \(by)") }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
}

/// The blocks, or why there are none.
private struct PageBody: View {
    @ObservedObject var model: PageModel
    let focusBlock: String?
    @Binding var sheet: PageSheet?

    var body: some View {
        if let markdown = model.markdown {
            if model.isEmpty {
                Text("This page is empty.").foregroundStyle(.secondary)
            } else {
                let blocks = model.blocks
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                        PageBlockRow(block: block, threads: model.openThreads(in: block), focused: focusBlock == block.id, sheet: $sheet)
                            .padding(.top, index == 0 ? 0 : block.isListItem && blocks[index - 1].isListItem ? 4 : 12)
                    }
                }
                .environment(\.pageId, model.pageId)
                .environment(\.pageImages, PageDocument.images(markdown))
            }
        } else if model.error == nil {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        }
    }
}

/// One block: its content, a mark with its open comments' count (tap to read
/// them), and touch-and-hold for Comment and Copy.
private struct PageBlockRow: View {
    let block: PageBlock
    let threads: [PageCommentThread]
    let focused: Bool
    @Binding var sheet: PageSheet?

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            PageMarkdown(source: block.markdown).frame(maxWidth: .infinity, alignment: .leading)
            if !threads.isEmpty {
                Button { sheet = .comments(focus: threads.first?.id) } label: {
                    Label("\(threads.count)", systemImage: "text.bubble.fill")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Color.yellow.opacity(0.3), in: .capsule)
                        .frame(minWidth: 44, minHeight: 44, alignment: .top)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(threads.count) comment\(threads.count == 1 ? "" : "s")")
                .accessibilityIdentifier("pageCommentMark-\(block.id)")
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(focused ? Color.yellow.opacity(0.25) : threads.isEmpty ? .clear : Color.yellow.opacity(0.07), in: .rect(cornerRadius: 8))
        .padding(.horizontal, -6)
        .animation(.easeInOut(duration: 0.4), value: focused)
        .contentShape(.rect)
        .contextMenu {
            if !block.id.hasPrefix("#") {
                Button { sheet = .newComment(block: block.id) } label: { Label("Comment", systemImage: "text.bubble") }
            }
            Button { UIPasteboard.general.string = PageEditorModel.plain(block.markdown) } label: { Label("Copy", systemImage: "doc.on.doc") }
        }
        .id(block.id)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pageBlock-\(block.id)")
    }
}

/// The pages inside this one, opening as pushed pages.
private struct PageChildren: View {
    let pageId: String
    @ObservedObject private var store = PagesStore.shared
    @EnvironmentObject private var app: AppModel

    var body: some View {
        let pages = store.children(of: pageId)
        if !pages.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Pages").font(.headline).padding(.bottom, 6)
                ForEach(pages) { page in
                    Button { app.push(.page(id: page.id)) } label: {
                        HStack {
                            PageRow(page: page)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 8)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
            }
            .padding(.top, 12)
        }
    }
}
