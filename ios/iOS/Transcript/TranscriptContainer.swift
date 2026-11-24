import SwiftUI
import UIKit

/// Requests into a transcript from SwiftUI, outside any view's state: a
/// request redraws nothing, and nothing writes a position back.
@MainActor
final class TranscriptHandle {
    fileprivate(set) weak var controller: TranscriptController?

    init() {}

    /// At the end, and staying there as it moves.
    var atEnd: Bool { controller?.atEnd ?? true }

    func jumpToLatest(animated: Bool = true) { controller?.jumpToLatest(animated: animated) }

    func scrollTo<ID: Hashable>(_ id: ID, position: TranscriptRowPosition = .top, animated: Bool = false) {
        controller?.scrollTo(AnyHashable(id), position: position, animated: animated)
    }

    /// Redraws these rows' cells now, without diffing the rest: for a row
    /// that changes many times a second (a streamed answer).
    func reconfigure<ID: Hashable>(_ ids: [ID]) { controller?.reconfigure(ids.map { AnyHashable($0) }) }

    /// An optimistic row confirmed under a new id: the row keeps its place
    /// and height. Call before the items with the new id go in.
    func carry<ID: Hashable>(from old: ID, to new: ID) { controller?.carry(from: AnyHashable(old), to: AnyHashable(new)) }
}

/// A chat transcript and its composer, on UIKit. Generic over the row: it
/// takes rows in order and a SwiftUI view for each, and hands back the
/// reader's state and requests (near the top, the pill).
///
/// Rows are compared by value: a changed row reconfigures only its cell,
/// and only a change of order or membership goes through a snapshot.
/// Place it with `.ignoresSafeArea(.container)`: it runs under the header
/// and to the edges, and ends at the keyboard's top, which the composer
/// rests on.
///
/// The SwiftUI environment here (environment objects, `openURL`, custom
/// keys) is carried into the cells, the composer and the header.
struct TranscriptContainer<Item: Identifiable & Equatable, Row: View, Composer: View, Top: View, Pill: View>: UIViewControllerRepresentable {
    var items: [Item]
    var chrome = TranscriptChrome()
    var handle: TranscriptHandle?
    var row: (Item) -> Row
    var composer: () -> Composer
    var top: (() -> Top)?
    var pill: (TranscriptPillState, @escaping () -> Void) -> Pill
    var onNearTop: (() -> Void)?
    var onEmptyTap: (() -> Void)?
    var onPage: ((CGFloat, CGFloat?) -> Void)?
    var rowsHidden = false
    var onPillChange: ((TranscriptPillState) -> Void)?
    var log: ((String) -> Void)?
    var dismissKeyboard: ((UIWindow) -> Void)?
    /// Shown on the pill while reading: something waiting at the end.
    var pillNote: String?
    var probe: ((CGRect) -> Void)?
    /// How the log writes a row id.
    var describeID: ((AnyHashable) -> String)?
    /// The conversation, for its reading spot across rebuilds (`TranscriptReadingSpots`).
    var spotKey: String?
    /// Optional change keys for the hosted composer and top chrome. When set and
    /// unchanged (along with colorScheme / dynamicTypeSize), their UIHostingController
    /// rootViews aren't replaced on unrelated row updates (e.g. streaming tokens).
    var composerVersion: AnyHashable? = nil
    var topVersion: AnyHashable? = nil

    final class Coordinator {
        var items: [Item] = []
        var itemIDs: [AnyHashable] = []
        var byID: [AnyHashable: Item] = [:]
        var composerMounted = false
        var composerVersion: AnyHashable?
        var topMounted = false
        var topVersion: AnyHashable?
        var hasTop = false
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> TranscriptController {
        let controller = TranscriptController()
        handle?.controller = controller
        return controller
    }

    func updateUIViewController(_ controller: TranscriptController, context: Context) {
        handle?.controller = controller
        let environment = context.environment
        let coordinator = context.coordinator
        controller.onNearTop = onNearTop
        controller.onEmptyTap = onEmptyTap
        controller.onPage = onPage
        controller.rowsHidden = rowsHidden
        controller.onPillChange = onPillChange
        controller.log = log
        if let dismissKeyboard { controller.dismissKeyboard = dismissKeyboard }
        controller.probe = probe
        controller.spotKey = spotKey
        if let describeID { controller.describe = describeID }
        controller.chrome = chrome
        let row = row
        controller.content = { id in
            guard let item = coordinator.byID[id] else { return AnyView(EmptyView()) }
            return AnyView(row(item).environment(\.self, environment))
        }
        let pill = pill
        controller.pillContent = { state, jump in AnyView(pill(state, jump).environment(\.self, environment)) }

        defer { controller.pillNote = pillNote }
        // Diff rows first so we know whether this update is purely a streaming
        // row update (unchanged composerVersion/topVersion with changed items)
        // vs. a SwiftUI environment/chrome update (e.g. Accessibility, theme,
        // focus, or dynamic type), which must always refresh the hosted chrome.
        var rowsChanged = false
        let oldCount = coordinator.items.count
        var handledRows = false
        if items.count >= oldCount, oldCount > 0 {
            var samePrefix = true
            var changed: [AnyHashable] = []
            for index in 0..<oldCount {
                let item = items[index]
                let old = coordinator.items[index]
                if item.id != old.id {
                    samePrefix = false
                    break
                }
                if item != old {
                    let id = coordinator.itemIDs[index]
                    changed.append(id)
                    coordinator.byID[id] = item
                }
            }
            if samePrefix {
                handledRows = true
                if items.count == oldCount {
                    if !changed.isEmpty {
                        rowsChanged = true
                        coordinator.items = items
                        controller.reconfigure(changed)
                    }
                } else {
                    rowsChanged = true
                    for index in oldCount..<items.count {
                        let item = items[index]
                        let id = AnyHashable(item.id)
                        coordinator.itemIDs.append(id)
                        coordinator.byID[id] = item
                    }
                    coordinator.items = items
                    controller.setRows(coordinator.itemIDs, changed: changed)
                }
            }
        }
        if !handledRows {
            rowsChanged = items != coordinator.items
            if rowsChanged {
                var changed: [AnyHashable] = []
                var byID: [AnyHashable: Item] = [:]
                var itemIDs: [AnyHashable] = []
                byID.reserveCapacity(items.count)
                itemIDs.reserveCapacity(items.count)
                for item in items {
                    let id = AnyHashable(item.id)
                    if let old = coordinator.byID[id], old != item { changed.append(id) }
                    byID[id] = item
                    itemIDs.append(id)
                }
                coordinator.items = items
                coordinator.itemIDs = itemIDs
                coordinator.byID = byID
                controller.setRows(itemIDs, changed: changed)
            }
        }

        // Skip re-assigning hosted chrome only on pure streaming row updates;
        // when rows didn't change (SwiftUI environment/AX update) or the chrome
        // token changed, refresh the hosted composer/top with the fresh environment.
        let skipComposer = rowsChanged && coordinator.composerMounted
            && composerVersion != nil && coordinator.composerVersion == composerVersion
        if !skipComposer {
            coordinator.composerMounted = true
            coordinator.composerVersion = composerVersion
            controller.setComposer(AnyView(composer().environment(\.self, environment)))
        }
        let nextHasTop = top != nil
        let skipTop = rowsChanged && coordinator.topMounted && coordinator.hasTop == nextHasTop
            && (!nextHasTop || (topVersion != nil && coordinator.topVersion == topVersion))
        if !skipTop {
            coordinator.topMounted = true
            coordinator.hasTop = nextHasTop
            coordinator.topVersion = topVersion
            controller.setTop(top.map { AnyView($0().environment(\.self, environment)) })
        }
    }
}
