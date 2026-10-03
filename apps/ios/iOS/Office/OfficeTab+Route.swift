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
        // A split opens its first tab; each half opens its own from the row.
        case .split: members?.first?.route
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
        case .split: "rectangle.split.2x1"
        }
    }
}

/// Space routing, per device: "own" opens something new in the Space it
/// belongs to and the app follows; "current" keeps everything where you are.
enum OfficeRouting: String {
    case own, current
    static let key = "officeRouting"
    static var setting: OfficeRouting { OfficeRouting(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .own }
}

extension TabsStore {
    /// What a native screen is, as a tab: a ref, or a web path the server resolves.
    func target(for route: Route) -> (ref: String?, href: String?)? {
        switch route {
        case .thread(let id): ("thread:\(id)", nil)
        case .bot(let id), .botDesk(let id): ("bot:\(id)", nil)
        case .savedView(let id): ("conversation:\(id)", nil)
        case .page(let id): (nil, "/plugins/pages/pages/\(id)")
        case .drawing(let id): (nil, "/plugins/excalidraw/drawings/\(id)")
        case .artifact(let id): (nil, "/plugins/studio/artifacts/\(id)")
        case .recording(let id): (nil, "/plugins/studio/recordings/\(id)")
        case .task(let id): (nil, "/plugins/studio/tasks/\(id)")
        case .table(let id): (nil, "/plugins/studio/tables/\(id)")
        case .studioCollection: ("library", nil)
        default: nil
        }
    }

    /// Whether the sidebar already has this target, on its own or inside a split.
    func hasTab(ref: String?, href: String?) -> Bool {
        (essentials + pinned + today).flatMap { [$0] + ($0.members ?? []) }
            .contains { (ref != nil && $0.ref == ref) || (href != nil && $0.href == href) }
    }

    /// Records that a screen opened, so it joins Today. Something new that
    /// belongs to another Space opens there instead (Space routing); the
    /// returned Space id says where, when it isn't this one.
    func noteOpened(_ route: Route, client: BBClient) async -> String? {
        guard let target = target(for: route) else { return nil }
        let follow = OfficeRouting.setting == .own && !hasTab(ref: target.ref, href: target.href)
        do {
            let result = if let ref = target.ref {
                try await client.officeTabOpen(spaceId, ref: ref, follow: follow)
            } else {
                try await client.officeTabOpen(spaceId, href: target.href!, follow: follow)
            }
            if result.spaceId != spaceId { return result.spaceId }
        } catch {
            return nil
        }
        await refresh()
        return nil
    }
}
