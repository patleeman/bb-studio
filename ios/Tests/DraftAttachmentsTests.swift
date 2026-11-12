import XCTest
@testable import BBStudio

final class DraftAttachmentsTests: XCTestCase {
    private let a = URL(string: "https://drafts-a.invalid")!
    private let b = URL(string: "https://drafts-b.invalid")!
    private var thread = ""

    override func setUp() { thread = "thr_test\(UUID().uuidString.prefix(8))" }
    override func tearDown() {
        DraftAttachments.save([], threadId: thread, serverURL: a)
        DraftAttachments.save([], threadId: thread, serverURL: b)
    }

    private func photo() -> PendingAttachment {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        return PendingAttachment.image(image)!
    }

    func testAttachmentsComeBackForTheirThreadAndServerOnly() {
        let file = PendingAttachment(data: Data("notes".utf8), name: "notes.txt", mimeType: "text/plain")
        let items = [photo(), file]
        DraftAttachments.save(items, threadId: thread, serverURL: a)

        let loaded = DraftAttachments.load(thread, serverURL: a)
        XCTAssertEqual(loaded.map(\.id), items.map(\.id))
        XCTAssertEqual(loaded.map(\.data), items.map(\.data))
        XCTAssertEqual(loaded.map(\.name), ["photo.jpg", "notes.txt"])
        XCTAssertNotNil(loaded[0].thumbnail, "A photo gets its thumbnail back")
        XCTAssertNil(loaded[1].thumbnail)

        XCTAssertEqual(DraftAttachments.load(thread, serverURL: b), [])
        XCTAssertEqual(DraftAttachments.load(thread + "x", serverURL: a), [])
    }

    func testRemovingOneAndClearingAllAreKept() {
        let first = photo(), second = photo()
        DraftAttachments.save([first, second], threadId: thread, serverURL: a)
        DraftAttachments.save([second], threadId: thread, serverURL: a)
        XCTAssertEqual(DraftAttachments.load(thread, serverURL: a).map(\.id), [second.id])
        DraftAttachments.save([], threadId: thread, serverURL: a)
        XCTAssertEqual(DraftAttachments.load(thread, serverURL: a), [])
    }

    func testAFailedSendKeepsItsFilesUnlessNewerOnesWait() {
        let sent = photo(), newer = photo()
        DraftAttachments.restore([sent], threadId: thread, serverURL: a)
        XCTAssertEqual(DraftAttachments.load(thread, serverURL: a).map(\.id), [sent.id])
        DraftAttachments.save([newer], threadId: thread, serverURL: a)
        DraftAttachments.restore([sent], threadId: thread, serverURL: a)
        XCTAssertEqual(DraftAttachments.load(thread, serverURL: a).map(\.id), [newer.id])
    }
}
