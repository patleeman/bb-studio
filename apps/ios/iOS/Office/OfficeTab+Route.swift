import Foundation

extension OfficeTab {
    private var item: OfficeItem? {
        guard let itemRef else { return nil }
        return OfficeItem(itemId: itemRef.itemId, pluginId: itemRef.pluginId, kind: itemKind ?? "", title: title ?? "Untitled", href: href ?? "", updatedAt: openedAt)
    }
    var route: Route? {
        switch kind {
        case .thread: threadId.map { .thread(id: $0) }
        case .item: item?.route
        case .bot: targetId(prefix: "bot:").map { .botDesk(id: $0) }
        case .conversation: targetId(prefix: "conversation:").map { .savedView(id: $0) }
        case .library: .studioCollection
        case .inbox, .home: nil
        }
    }
    var symbol: String {
        switch kind {
        case .thread: "bubble.left.and.bubble.right"
        case .item: item?.symbol ?? "doc"
        case .bot: "person.crop.circle"
        case .conversation: "person.2"
        case .inbox: "tray"
        case .home: "house"
        case .library: "books.vertical"
        }
    }
}

extension TabsStore {
    /// Called when native navigation opens a target. The server resolves item
    /// hrefs so provider aliases and canonical refs stay consistent with web.
    func noteOpened(_ route: Route) async {
        switch route {
        case .thread(let id): await open(ref: "thread:\(id)")
        case .bot(let id), .botDesk(let id): await open(ref: "bot:\(id)")
        case .savedView(let id): await open(ref: "conversation:\(id)")
        case .page(let id): await open(href: "/plugins/pages/pages/\(id)")
        case .drawing(let id): await open(href: "/plugins/excalidraw/drawings/\(id)")
        case .artifact(let id): await open(href: "/plugins/studio/artifacts/\(id)")
        case .recording(let id): await open(href: "/plugins/studio/recordings/\(id)")
        case .task(let id): await open(href: "/plugins/studio/tasks/\(id)")
        case .table(let id): await open(href: "/plugins/studio/tables/\(id)")
        case .studioCollection: await open(ref: "library")
        default: break
        }
    }
}
