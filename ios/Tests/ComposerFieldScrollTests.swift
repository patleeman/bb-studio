import SwiftUI
import UIKit
import XCTest
@testable import BBStudio

/// The composer's field scrolls only when its text is taller than the frame
/// it was laid out at. SwiftUI's size probes (a stack's minimum asks at
/// height 0) used to flip it to scrolling on a short message, and back on the
/// next pass, in every conversation's composer.
@MainActor
final class ComposerFieldScrollTests: XCTestCase {
    private var window: UIWindow?

    override func tearDown() {
        window?.isHidden = true
        window = nil
    }

    /// The conversation's composer (as `ThreadView` sets it up) at the bottom of a screen-sized page.
    private func host(_ text: String, height: CGFloat) -> PastingTextView? {
        // The page is the window, without a device's safe areas.
        let root = ComposerHost(text: text)
            .frame(width: 402, height: height)
            .ignoresSafeArea()
        let controller = UIHostingController(rootView: root)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 402, height: height))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        settle()
        return Self.field(in: window)
    }

    private func settle(_ turns: Int = 10) {
        for _ in 0..<turns {
            window?.layoutIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        }
    }

    private static func field(in view: UIView) -> PastingTextView? {
        if let field = view as? PastingTextView { return field }
        return view.subviews.lazy.compactMap(field).first
    }

    func testAThreeLineMessageNeverScrollsAndLayoutSettles() throws {
        let field = try XCTUnwrap(host("One\nTwo\nThree", height: 874))
        XCTAssertFalse(field.isScrollEnabled, "3 lines fit: no scrolling")
        XCTAssertGreaterThan(field.bounds.height, field.font!.lineHeight * 2.5, "it grew to its 3 lines")

        // Watched over more passes: it never turns on, and the field stops laying out.
        RenderCount.reset()
        var flips = 0
        var last = field.isScrollEnabled
        for _ in 0..<20 {
            settle(1)
            if field.isScrollEnabled != last { flips += 1; last = field.isScrollEnabled }
        }
        XCTAssertEqual(flips, 0, "scrolling stays off")
        XCTAssertLessThanOrEqual(RenderCount.counts["composer.field.layout", default: 0], 2, "no layout loop")
    }

    func testALongMessageScrollsInsideItsCap() throws {
        let long = (1...60).map { "Line \($0)" }.joined(separator: "\n")
        let field = try XCTUnwrap(host(long, height: 874))
        XCTAssertTrue(field.isScrollEnabled, "past its cap the field scrolls")
        let cap = field.font!.lineHeight * 6 + field.textContainerInset.top + field.textContainerInset.bottom
        XCTAssertLessThanOrEqual(field.bounds.height, cap + 1, "and stays at its 6-line cap")
    }

    func testShortOfRoomTheFieldGivesWayAndKeepsSendOnScreen() throws {
        // A page about as tall as the folded Duo's room above the keyboard at large text.
        let long = (1...15).map { "Line \($0)" }.joined(separator: "\n")
        let field = try XCTUnwrap(host(long, height: 220))
        XCTAssertTrue(field.isScrollEnabled, "less room than the text: it scrolls")
        let frame = field.convert(field.bounds, to: nil)
        // Under the field: the row with Send (44), its 6-point margin, and the composer's 8-point padding.
        XCTAssertLessThanOrEqual(frame.maxY, 220 - ComposerRow.button - 6 - 8 + 1, "the row with Send keeps its place under the field")
        XCTAssertGreaterThanOrEqual(frame.minY, -1, "and the field's top is on the page")
    }
}

/// The conversation's composer: `ComposerBar` as `ThreadView` sets it up, at the bottom of the page.
private struct ComposerHost: View {
    @State var text: String
    @State private var focused = false
    @State private var attachments: [PendingAttachment] = []

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            ComposerBar(text: $text, focused: $focused, attachments: $attachments, dictate: {}, clear: true, compact: true) {
                EmptyView()
            } send: {
                Button("Send") {}.frame(width: ComposerRow.button, height: ComposerRow.button)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }
}
