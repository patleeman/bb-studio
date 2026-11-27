import XCTest
@testable import BBStudio

/// Round 5, change 1: one thing above a Bot conversation's composer, one-shot
/// notices as transcript lines, lasting states as composer chips.
@MainActor
final class ComposerSlotTests: XCTestCase {
    private func card(_ id: String, _ state: WorkerApproval.State = .pending) -> ConversationApprovals.Card {
        ConversationApprovals.Card(approval: WorkerApproval(worker: .init(threadId: "w-\(id)", title: "Worker \(id)"),
                                                            interactionId: id, state: state, title: "Push \(id)"))
    }

    func testSlotOrder() {
        XCTAssertEqual(ComposerSlot.pick(.init(approvals: 1, routerNotice: true, planReview: true, onlyStrand: true, strands: true)), .approval)
        XCTAssertEqual(ComposerSlot.pick(.init(routerNotice: true, planReview: true, strands: true)), .routerNotice)
        XCTAssertEqual(ComposerSlot.pick(.init(planReview: true, onlyStrand: true, strands: true)), .planReview)
        XCTAssertEqual(ComposerSlot.pick(.init(onlyStrand: true, strands: true)), .onlyStrand)
        XCTAssertEqual(ComposerSlot.pick(.init(strands: true)), .strands)
        XCTAssertEqual(ComposerSlot.pick(.init()), .none)
    }

    func testActionableApprovalsBeforeDesktopOnlyAsks() {
        let gateway = Strand.Ask(id: "g1", kind: .gateway, threadId: "t", label: "Calendar access")
        let pages = ComposerSlot.pages([card("a", .approved), card("b")], gateway: [gateway], hidden: [])
        XCTAssertEqual(pages.map(\.id), ["w-b:b", "w-a:a", "gateway:t:g1"])
        let hidden = ComposerSlot.pages([card("a"), card("b")], gateway: [gateway], hidden: ["w-a:a"])
        XCTAssertEqual(hidden.map(\.id), ["w-b:b", "gateway:t:g1"])
        XCTAssertTrue(ComposerSlot.pages([], gateway: [gateway], hidden: []).isEmpty, "a desktop-only ask never takes the slot alone")
        XCTAssertTrue(ComposerSlot.pages([card("a")], gateway: [gateway], hidden: ["w-a:a"]).isEmpty)
    }

    func testPageStaysOnItsCard() {
        let pages = ComposerSlot.pages([card("a"), card("b")], gateway: [], hidden: [])
        XCTAssertEqual(ComposerSlot.page(0, previousId: "w-b:b", in: pages), 1)
        XCTAssertEqual(ComposerSlot.page(5, previousId: "gone", in: pages), 1)
        XCTAssertEqual(ComposerSlot.page(1, previousId: nil, in: []), 0)
    }

    func testGatewayAsksComeFromStrands() {
        let list = StrandList(threadId: "t", enabled: true, strands: [
            Strand(id: "s", title: "Calendar", state: .needsYou, asks: [
                Strand.Ask(id: "a", kind: .approval, threadId: "w", label: "Push"),
                Strand.Ask(id: "g", kind: .gateway, threadId: "t", label: "Calendar access"),
            ]),
        ])
        XCTAssertEqual(ComposerSlot.gatewayAsks(list).map(\.id), ["g"])
    }

    func testApprovalSlotsBringUpOnlyShownCards() {
        let slots = ApprovalSlots()
        slots.set(["w:i"], for: "conv")
        let shown = Strand.Ask(id: "i", kind: .approval, threadId: "w", label: "Push")
        let other = Strand.Ask(id: "x", kind: .approval, threadId: "w", label: "Other")
        XCTAssertEqual(slots.cardId(for: shown, in: "conv"), "w:i")
        XCTAssertNil(slots.cardId(for: other, in: "conv"))
        slots.bringUp("w:i", in: "conv")
        XCTAssertEqual(slots.take("conv"), "w:i")
        XCTAssertNil(slots.take("conv"))
    }

    func testChipsForLastingStates() {
        let todos = [Todos.Item(id: "1", text: "a", status: "completed"), Todos.Item(id: "2", text: "b", status: "pending")]
        let chips = ComposerChip.chips(pause: "paused", planning: true, goal: "Ship", todos: todos, background: 1, queued: 2,
                                       note: true, editing: true, permission: nil, handingOff: true)
        XCTAssertEqual(chips.map(\.kind), [.paused, .planMode, .goal, .todos, .background, .queued, .notes, .editing, .handingOff])
        XCTAssertEqual(chips.first?.action, "Resume")
        XCTAssertEqual(chips.first { $0.kind == .todos }?.text, "1/2 todos")
        XCTAssertTrue(chips.first { $0.kind == .editing }?.closes == true)
        XCTAssertEqual(ComposerChip.chips(pause: "stopped", planning: false, goal: nil, todos: [], background: 0, queued: 0,
                                          note: false, editing: false, permission: "full", handingOff: false).map(\.kind),
                       [.paused, .permission])
        XCTAssertTrue(ComposerChip.chips(pause: nil, planning: false, goal: nil, todos: [], background: 0, queued: 0,
                                         note: false, editing: false, permission: nil, handingOff: false).isEmpty)
    }

    func testOneShotNotices() {
        let fallback = ModelFallback(sourceSeq: 12, originalModel: "Claude", fallbackModel: "GPT-5.2", message: nil)
        let lines = TranscriptNotice.lines(fallback: fallback, dismissedFallbacks: "", handoffDone: "Switched to GPT-5.2",
                                           storageError: "Couldn't save", turnFailed: true)
        XCTAssertEqual(lines.map(\.id), ["fallback-12", "handoff", "storage", "turn-failed"])
        XCTAssertEqual(lines.first?.action, .dismissFallback(12))
        XCTAssertEqual(lines.last?.action, .retryTurn)
        XCTAssertTrue(TranscriptNotice.lines(fallback: fallback, dismissedFallbacks: ",3,12", handoffDone: nil, storageError: nil,
                                             turnFailed: false).isEmpty)
    }

    func testStrandsLineCarriesNoNeedsYouCount() {
        let list = StrandList(threadId: "t", enabled: true, strands: [
            Strand(id: "n", title: "Budget", state: .needsYou, latestSeq: 9),
            Strand(id: "r", title: "Theme stills", state: .running, latestSeq: 3),
        ])
        XCTAssertEqual(StrandsBoxModel.line(list), "Theme stills")
        XCTAssertFalse(StrandsBoxModel.line(list).contains("need"))
        let idle = StrandList(threadId: "t", enabled: true, strands: [
            Strand(id: "a", title: "Older", state: .active, latestSeq: 1),
            Strand(id: "b", title: "Newer", state: .doneUnseen, latestSeq: 5),
        ])
        XCTAssertEqual(StrandsBoxModel.line(idle), "Newer")
    }
}
