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

extension EnvironmentValues {
    /// Something of the app's covers the transcript (BB: Home over it):
    /// VoiceOver leaves its UIKit views, which SwiftUI's
    /// `accessibilityHidden` doesn't reliably reach.
    @Entry var transcriptCovered = false
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
    /// Over the rows, from the header to the composer (the Workbench); nil shows the rows.
    var cover: (() -> AnyView)? = nil
    var onPillChange: ((TranscriptPillState) -> Void)?
    var log: ((String) -> Void)?
    var dismissKeyboard: ((UIWindow) -> Void)?
    /// Shown on the pill while reading: something waiting at the end.
    var pillNote: String?
    /// How the log writes a row id.
    var describeID: ((AnyHashable) -> String)?
    /// The conversation, for its reading spot across rebuilds (`TranscriptReadingSpots`).
    var spotKey: String?
    /// Optional change keys for the hosted composer and top chrome. When set and
    /// unchanged (along with `colorScheme`, `dynamicTypeSize`, and `legibilityWeight`),
    /// their UIHostingController rootViews aren't replaced on pure streaming row updates.
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
        var covered = false
        var colorScheme: ColorScheme?
        var dynamicTypeSize: DynamicTypeSize?
        var legibilityWeight: LegibilityWeight?

        struct DiffResult {
            var rowsChanged: Bool
            var needsSetRows: Bool
            var changed: [AnyHashable]
        }

        /// Diffs `next` against the coordinator's current rows and updates
        /// `items`, `itemIDs`, and `byID` atomically.
        func apply(_ next: [Item]) -> DiffResult {
            let oldCount = items.count
            if next.count >= oldCount, oldCount > 0 {
                var samePrefix = true
                var changed: [AnyHashable] = []
                var pendingUpdates: [(id: AnyHashable, item: Item)] = []
                for index in 0..<oldCount {
                    let item = next[index]
                    let old = items[index]
                    if item.id != old.id {
                        samePrefix = false
                        break
                    }
                    if item != old {
                        let id = itemIDs[index]
                        changed.append(id)
                        pendingUpdates.append((id, item))
                    }
                }
                if samePrefix {
                    // Commit buffered updates only after confirming the prefix holds,
                    // so a fallback to the slow path never compares against mutated `byID`.
                    for (id, item) in pendingUpdates { byID[id] = item }
                    if next.count == oldCount {
                        if changed.isEmpty {
                            return DiffResult(rowsChanged: false, needsSetRows: false, changed: [])
                        }
                        items = next
                        return DiffResult(rowsChanged: true, needsSetRows: false, changed: changed)
                    }
                    for index in oldCount..<next.count {
                        let item = next[index]
                        let id = AnyHashable(item.id)
                        itemIDs.append(id)
                        byID[id] = item
                    }
                    items = next
                    return DiffResult(rowsChanged: true, needsSetRows: true, changed: changed)
                }
            }

            guard next != items else {
                return DiffResult(rowsChanged: false, needsSetRows: false, changed: [])
            }
            var changed: [AnyHashable] = []
            var nextByID: [AnyHashable: Item] = [:]
            var nextIDs: [AnyHashable] = []
            nextByID.reserveCapacity(next.count)
            nextIDs.reserveCapacity(next.count)
            for item in next {
                let id = AnyHashable(item.id)
                if let old = byID[id], old != item { changed.append(id) }
                nextByID[id] = item
                nextIDs.append(id)
            }
            items = next
            itemIDs = nextIDs
            byID = nextByID
            return DiffResult(rowsChanged: true, needsSetRows: true, changed: changed)
        }
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
        controller.view.accessibilityElementsHidden = environment.transcriptCovered
        controller.onPillChange = onPillChange
        controller.log = log
        if let dismissKeyboard { controller.dismissKeyboard = dismissKeyboard }
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
        let diff = coordinator.apply(items)
        if diff.rowsChanged {
            if diff.needsSetRows {
                controller.setRows(coordinator.itemIDs, changed: diff.changed)
            } else {
                controller.reconfigure(diff.changed)
            }
        }

        // Skip re-assigning hosted chrome only on pure streaming row updates;
        // refresh whenever rows didn't change (SwiftUI environment/AX update),
        // the chrome token changed, or visual environment traits changed.
        let envChanged = coordinator.colorScheme != environment.colorScheme
            || coordinator.dynamicTypeSize != environment.dynamicTypeSize
            || coordinator.legibilityWeight != environment.legibilityWeight
        coordinator.colorScheme = environment.colorScheme
        coordinator.dynamicTypeSize = environment.dynamicTypeSize
        coordinator.legibilityWeight = environment.legibilityWeight

        let skipComposer = diff.rowsChanged && !envChanged && coordinator.composerMounted
            && composerVersion != nil && coordinator.composerVersion == composerVersion
        if !skipComposer {
            coordinator.composerMounted = true
            coordinator.composerVersion = composerVersion
            controller.setComposer(AnyView(composer().environment(\.self, environment)))
        }
        let nextHasTop = top != nil
        let skipTop = diff.rowsChanged && !envChanged && coordinator.topMounted && coordinator.hasTop == nextHasTop
            && (!nextHasTop || (topVersion != nil && coordinator.topVersion == topVersion))
        if !skipTop {
            coordinator.topMounted = true
            coordinator.hasTop = nextHasTop
            coordinator.topVersion = topVersion
            controller.setTop(top.map { AnyView($0().environment(\.self, environment)) })
        }
        if (cover != nil) != coordinator.covered || (cover != nil && (!diff.rowsChanged || envChanged)) {
            coordinator.covered = cover != nil
            controller.setCover(cover.map { AnyView($0().environment(\.self, environment)) })
        }
    }
}
