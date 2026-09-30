import CoreSpotlight
import Foundation

/// Puts open threads in Spotlight search; picking one opens it in the app.
enum Spotlight {
    static let domain = "nyc.plee.bbgo.threads"
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
}
