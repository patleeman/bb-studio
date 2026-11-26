import WebKit
import XCTest
@testable import BBStudio

/// Round 7 review (B4, B5, S1): agent-written HTML stays on its own document,
/// the design bridge only takes what the current mode allows, and the browser
/// tab's Back reads the history when it runs.
@MainActor
final class ViewerSecurityTests: XCTestCase {
    private let screen = URL(string: "https://bb.invalid/api/v1/plugins/studio/http/designs/screen?design=dsn_1&screen=1a&v=7&s=7")!

    // MARK: Navigation policy

    func testADesignViewStaysOnItsOwnScreen() {
        XCTAssertEqual(UntrustedWeb.decide(url: screen, allowed: screen, mainFrame: true, linkActivated: false), .allow)
        XCTAssertEqual(UntrustedWeb.decide(url: URL(string: screen.absoluteString + "#step2")!, allowed: screen, mainFrame: true, linkActivated: false),
                       .allow, "a step is the same document")
        let other = URL(string: "https://bb.invalid/api/v1/plugins/studio/http/designs/screen?design=dsn_1&screen=1b&v=7&s=7")!
        XCTAssertEqual(UntrustedWeb.decide(url: other, allowed: screen, mainFrame: true, linkActivated: false), .cancel,
                       "not even another screen of the same server")
        let away = URL(string: "https://elsewhere.invalid/steal")!
        XCTAssertEqual(UntrustedWeb.decide(url: away, allowed: screen, mainFrame: true, linkActivated: false), .cancel, "script or meta refresh")
        XCTAssertEqual(UntrustedWeb.decide(url: away, allowed: screen, mainFrame: true, linkActivated: true), .openOutside(away), "a tapped link leaves for Safari")
        XCTAssertEqual(UntrustedWeb.decide(url: screen, allowed: screen, mainFrame: false, linkActivated: false), .cancel, "frames only load about: documents")
        XCTAssertEqual(UntrustedWeb.decide(url: URL(string: "about:srcdoc"), allowed: screen, mainFrame: false, linkActivated: false), .allow)
    }

    func testAPageBlockOnlyShowsItsOwnHTML() {
        XCTAssertEqual(UntrustedWeb.decide(url: URL(string: "about:blank"), allowed: nil, mainFrame: true, linkActivated: false), .allow,
                       "loadHTMLString's document")
        for url in ["https://elsewhere.invalid/", "file:///etc/hosts", "bbstudio://settings", "data:text/html,hi", "javascript:alert(1)"] {
            XCTAssertEqual(UntrustedWeb.decide(url: URL(string: url), allowed: nil, mainFrame: true, linkActivated: false), .cancel, url)
        }
        XCTAssertEqual(UntrustedWeb.decide(url: URL(string: "file:///etc/hosts"), allowed: nil, mainFrame: true, linkActivated: true), .cancel,
                       "only web and mail links open outside, even when tapped")
        let mail = URL(string: "mailto:someone@example.invalid")!
        XCTAssertEqual(UntrustedWeb.decide(url: mail, allowed: nil, mainFrame: true, linkActivated: true), .openOutside(mail))
        XCTAssertEqual(UntrustedWeb.decide(url: nil, allowed: nil, mainFrame: true, linkActivated: true), .cancel)
    }

    func testUntrustedViewsKeepNothing() {
        XCTAssertFalse(UntrustedWeb.configuration().websiteDataStore.isPersistent, "no BB web cookies or storage")
        XCTAssertFalse(UntrustedWeb.configuration().preferences.javaScriptCanOpenWindowsAutomatically)
    }

    // MARK: The design bridge

    func testTheBridgeOnlyTakesWhatTheModeAllows() {
        let pick = DesignFrameEvent.pick(DesignPick(selector: "h1", html: "", text: "", rect: .zero))
        let text = DesignFrameEvent.text(before: "Old", after: "New")
        for mode in DesignMode.allCases {
            XCTAssertEqual(DesignLiveFrame.accepts(pick, in: mode), mode == .comment, "pick in \(mode)")
            XCTAssertEqual(DesignLiveFrame.accepts(text, in: mode), mode == .edit, "a forged text edit in \(mode) never saves")
            XCTAssertEqual(DesignLiveFrame.accepts(.notEditable, in: mode), mode == .edit)
            XCTAssertEqual(DesignLiveFrame.accepts(.pin("dc_1"), in: mode), mode == .comment || mode == .play)
        }
    }

    // MARK: The browser tab

    /// A → B → C, with the actions made at B (the shell may keep an older list, as their
    /// equality ignores closures): Back goes to B, not to A.
    func testBackReadsTheHistoryWhenItRuns() async throws {
        let page = WebPage()
        let a = URL(string: "data:text/html,A")!, b = URL(string: "data:text/html,B")!, c = URL(string: "data:text/html,C")!
        for try await _ in page.load(URLRequest(url: a)) {}
        for try await _ in page.load(URLRequest(url: b)) {}
        let madeAtB = WorkbenchBrowserTab.navigation(page)
        for try await _ in page.load(URLRequest(url: c)) {}
        XCTAssertEqual(page.url, c)
        let back = try XCTUnwrap(madeAtB.first { $0.id == "back" })
        back.run()
        let until = Date().addingTimeInterval(10)
        while page.url != b, Date() < until { try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertEqual(page.url, b, "Back from C goes to B")
    }
}
