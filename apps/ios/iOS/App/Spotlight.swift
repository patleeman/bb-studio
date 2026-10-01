import CoreSpotlight
import Foundation

/// Puts open threads in Spotlight search; picking one opens it in the app.
enum Spotlight {
    static let domain = "nyc.plee.bbgo.threads"
    static let studioDomain = "nyc.plee.bbgo.studio"
    /// Handoff: the Mac has no BB Studio, so it opens `webpageURL` in the browser.
    static let threadActivityType = "nyc.plee.bbgo.thread"

    private static var indexedSignature = 0

    static func index(_ threads: [ThreadEntry], projectNames: [String: String]) {
        var hasher = Hasher()
        for thread in threads {
            hasher.combine(thread.id)
            hasher.combine(thread.displayTitle)
        }
        let signature = hasher.finalize()
        guard signature != indexedSignature else { return }
        indexedSignature = signature

        let items = threads.map { thread in
            let attributes = CSSearchableItemAttributeSet(contentType: .text)
            attributes.title = thread.displayTitle
            attributes.contentDescription = projectNames[thread.projectId] ?? thread.projectName
            attributes.contentModificationDate = Date(timeIntervalSince1970: thread.updatedAt / 1000)
            return CSSearchableItem(uniqueIdentifier: thread.id, domainIdentifier: domain, attributeSet: attributes)
        }
        let index = CSSearchableIndex.default()
        // Replace the whole set so archived threads drop out.
        index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
            index.indexSearchableItems(items)
        }
    }

    /// Replaces the Studio domain so archived and deleted items leave search.
    static func indexStudio(_ items: [StudioItem]) {
        let searchable = items.filter { !$0.archived && ["page", "task", "recording", "dictation", "drawing", "artifact"].contains($0.kind) }
        let results = searchable.map { item in
            let attributes = CSSearchableItemAttributeSet(contentType: .text)
            attributes.title = item.displayTitle
            attributes.contentDescription = item.preview ?? item.kind.capitalized
            attributes.contentModificationDate = Date(timeIntervalSince1970: item.updatedAt / 1000)
            return CSSearchableItem(uniqueIdentifier: item.id, domainIdentifier: studioDomain, attributeSet: attributes)
        }
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [studioDomain]) { error in
            guard error == nil else { return }
            CSSearchableIndex.default().indexSearchableItems(results)
        }
    }
}
