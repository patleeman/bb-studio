import XCTest
@testable import BBStudio

@MainActor
final class DictationSubmissionTests: XCTestCase {
    func testFailureKeepsTheSheetOpenAndReportsTheError() async {
        let client = BBClient(baseURL: URL(string: "https://dictation.invalid")!)
        client.transport = { _, _, _ in (500, Data(#"{"error":{"message":"send failed"}}"#.utf8)) }
        let submission = DictationSubmission()
        let sent = await submission.send("words to keep", to: "thread", client: client)
        XCTAssertFalse(sent, "Only success may dismiss the sheet")
        XCTAssertNotNil(submission.error)
        XCTAssertFalse(submission.sending)
    }

    func testRepeatedSendWhilePendingDoesNotSubmitAgain() async {
        let client = BBClient(baseURL: URL(string: "https://dictation.invalid")!)
        let calls = LockedCounter()
        let started = expectation(description: "Send started")
        client.transport = { _, _, _ in
            _ = calls.next()
            started.fulfill()
            try await Task.sleep(for: .milliseconds(100))
            throw URLError(.notConnectedToInternet)
        }
        let submission = DictationSubmission()
        let first = Task { await submission.send("words", to: "thread", client: client) }
        await fulfillment(of: [started], timeout: 2)
        let second = await submission.send("words", to: "thread", client: client)
        _ = await first.value
        XCTAssertFalse(second)
        XCTAssertEqual(calls.next(), 2)
    }
}
