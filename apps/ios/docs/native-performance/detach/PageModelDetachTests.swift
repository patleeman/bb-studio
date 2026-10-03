import XCTest
@testable import BBStudio

private actor DetachedReadProbe {
    private var count = 0
    func started() { count += 1 }
    func total() -> Int { count }
}

/// Real realtime delivery, with BBClient's existing transport seam observing reads.
@MainActor
final class PageModelDetachTests: XCTestCase {
    func testQueuedRealtimeReloadIsCancelledOnDetach() async throws {
        let origin = URL(string: "http://127.0.0.1:49486")!
        guard ProcessInfo.processInfo.environment["BB_DETACH_QA_SERVER_URL"] == origin.absoluteString,
              ProcessInfo.processInfo.environment["BB_DETACH_QA_PRIVATE_SIM"] == "YES" else {
            throw XCTSkip("Requires exact staged origin and fresh private simulator opt-in")
        }
        XCTAssertEqual(ServerScope.selectedURL, origin)
        let app = AppModel.shared
        XCTAssertEqual(app.serverURL, origin)
        let fixtureClient = BBClient(baseURL: origin)
        let page = try await fixtureClient.createPage(title: "Detach lifecycle fixture", markdown: "Read-only model fixture")
        print("DETACH_PROBE fixture page: \(page.id)")
        let expected = try await fixtureClient.editablePageMarkdown(page.id)
        let probe = DetachedReadProbe()
        app.client.transport = { method, path, body in
            if path == "/api/v1/plugins/pages/rpc/markdown" {
                await probe.started()
                print("DETACH_PROBE markdown read started")
                try await Task.sleep(for: .seconds(2))
                return (200, Data(#"{"ok":true,"result":{"markdown":"Controlled read"}}"#.utf8))
            }
            return try await fixtureClient.raw(method: method, path: path, body: body)
        }
        let connected = expectation(description: "Real staged socket connected")
        let changed = expectation(description: "Real page-change signal received")
        var observedChange = false
        let observer = app.realtime.listen { event in
            if case .connected = event { connected.fulfill() }
            if case .pluginSignal("pages", _, let payload) = event,
               payload["type"]?.stringValue == "page", payload["pageId"]?.stringValue == page.id,
               !observedChange {
                observedChange = true
                changed.fulfill()
            }
        }
        app.realtime.stop()
        app.realtime.start()
        await fulfillment(of: [connected], timeout: 5)
        try await Task.sleep(for: .seconds(1)) // Allow the local websocket handshake to finish.
        var model: PageModel? = PageModel(pageId: page.id)
        weak var releasedModel = model
        model?.attach(app)
        _ = try await fixtureClient.editPageDocument(page.id, expected: expected, markdown: "Changed owned fixture")
        await fulfillment(of: [changed], timeout: 5)
        // Let every listener process the signal, but stay inside its 600 ms debounce.
        try await Task.sleep(for: .milliseconds(100))
        model?.detach()
        model = nil
        print("DETACH_PROBE detached; model retained: \(releasedModel != nil)")
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertNil(releasedModel, "Detached model must release without waiting for its queued reload")
        try await Task.sleep(for: .seconds(1))
        let reads = await probe.total()
        print("DETACH_PROBE post-detach markdown reads: \(reads)")
        XCTAssertEqual(reads, 0, "The queued reload must not start an API read after detach")
        if reads == 0 {
            let attached = PageModel(pageId: page.id)
            attached.attach(app)
            let current = try await fixtureClient.editablePageMarkdown(page.id)
            _ = try await fixtureClient.editPageDocument(page.id, expected: current, markdown: "Attached control fixture")
            try await Task.sleep(for: .milliseconds(1200))
            let attachedReads = await probe.total()
            print("DETACH_PROBE attached control markdown reads: \(attachedReads)")
            XCTAssertEqual(attachedReads, 1, "Attached models must still reload after a real content change")
            attached.detach()
        }
        app.realtime.removeListener(observer)
        app.realtime.stop()
        // Wait for the deliberately slow pre-fix read before cleaning up its fixture.
        try await Task.sleep(for: .seconds(2))
        app.client.transport = nil
        try await fixtureClient.deletePage(page.id)
    }
}
