import XCTest
@testable import BBStudio

/// The composer's one mic and one indicator (`VoiceComposer`).
@MainActor
final class ComposerVoiceTests: XCTestCase {
    private func ticks(_ machine: inout VoiceComposer, _ count: Int, level: Float) -> [VoiceComposer.Effect] {
        (0..<count).flatMap { _ in machine.handle(.tick(level: level)) }
    }

    private func voiceOn() -> VoiceComposer {
        var machine = VoiceComposer(hintShown: true)
        _ = machine.handle(.voiceMode(true))
        return machine
    }

    // MARK: Exclusivity

    func testIdleShowsTheMicAndNoIndicator() {
        let machine = VoiceComposer(hintShown: true)
        XCTAssertEqual(machine.indicator, .none)
        XCTAssertTrue(machine.showsMic)
        XCTAssertFalse(machine.showsPushToTalk)
        XCTAssertNil(machine.placeholder)
    }

    func testDictatingShowsOneRecorderWithATimer() {
        var machine = VoiceComposer(hintShown: true)
        _ = machine.handle(.talk(.dictating))
        XCTAssertEqual(machine.indicator, .input)
        XCTAssertTrue(machine.showsTimer)
        XCTAssertEqual(machine.placeholder, "Listening…")
    }

    func testVoiceModeHidesTheDictationMicAndHasNoTimer() {
        var machine = voiceOn()
        XCTAssertFalse(machine.showsMic)
        XCTAssertTrue(machine.showsPushToTalk)
        _ = machine.handle(.pressBegan)
        XCTAssertEqual(machine.indicator, .input)
        XCTAssertFalse(machine.showsTimer)
    }

    func testTurningVoiceModeOnWhileDictatingFinishesTheDictationFirst() {
        var machine = VoiceComposer(hintShown: true)
        _ = machine.handle(.talk(.dictating))
        XCTAssertEqual(machine.handle(.voiceMode(true)), [.finishDictation])
        XCTAssertTrue(machine.showsPushToTalk)
    }

    func testTheBotSpeakingTakesTheSameSpotAndInputWins() {
        var machine = voiceOn()
        _ = machine.handle(.botSpeaking(true))
        XCTAssertEqual(machine.indicator, .output)
        XCTAssertEqual(machine.placeholder, "Speaking…")
        // Pressing to talk stops it, and only your voice shows.
        XCTAssertEqual(machine.handle(.pressBegan), [.stopPlayback, .startTalk(handsFree: false)])
        XCTAssertEqual(machine.indicator, .input)
        XCTAssertEqual(machine.placeholder, "Listening…")
    }

    func testDictatingOverAReplyStopsIt() {
        var machine = VoiceComposer(hintShown: true)
        _ = machine.handle(.botSpeaking(true))
        XCTAssertEqual(machine.handle(.talk(.dictating)), [.stopPlayback])
        XCTAssertEqual(machine.indicator, .input)
    }

    func testTurningVoiceModeOffEndsTheTalk() {
        var machine = voiceOn()
        _ = machine.handle(.pressBegan)
        XCTAssertEqual(machine.handle(.voiceMode(false)), [.cancelTalk])
        XCTAssertTrue(machine.showsMic)
    }

    // MARK: Push to talk and hands-free

    func testPushToTalkSendsOnRelease() {
        var machine = voiceOn()
        XCTAssertEqual(machine.mode, .pushToTalk)
        XCTAssertEqual(machine.handle(.pressBegan), [.startTalk(handsFree: false)])
        XCTAssertTrue(machine.blocksPlayback)
        // Speaking during the hold keeps it push to talk, however long it lasts.
        XCTAssertEqual(ticks(&machine, 30, level: 0.6), [])
        XCTAssertEqual(machine.handle(.pressEnded), [.sendTalk])
        _ = machine.handle(.talk(.sending))
        _ = machine.handle(.talk(.idle))
        XCTAssertEqual(machine.input, .idle)
        XCTAssertEqual(machine.mode, .pushToTalk)
    }

    func testAShortQuietHoldStaysPushToTalk() {
        var machine = voiceOn()
        _ = machine.handle(.pressBegan)
        XCTAssertEqual(ticks(&machine, VoiceComposer.longPressTicks - 1, level: 0.1), [])
        XCTAssertEqual(machine.handle(.pressEnded), [.sendTalk])
    }

    func testAQuietLongPressSwitchesToHandsFreeAndLettingGoDoesntSend() {
        var machine = voiceOn()
        _ = machine.handle(.pressBegan)
        XCTAssertEqual(ticks(&machine, VoiceComposer.longPressTicks, level: 0.1), [.goHandsFree])
        XCTAssertEqual(machine.mode, .handsFree)
        XCTAssertEqual(machine.input, .handsFree)
        XCTAssertEqual(machine.handle(.pressEnded), [])
        _ = machine.handle(.talk(.handsFree))
        XCTAssertEqual(machine.indicator, .input)
        XCTAssertFalse(machine.showsTimer)
    }

    func testHandsFreeSendsAfterAPauseAndListensAgain() {
        var machine = voiceOn()
        XCTAssertEqual(machine.handle(.handsFreeToggled), [.startTalk(handsFree: true)])
        // Nothing said: nothing sent.
        XCTAssertEqual(ticks(&machine, 40, level: 0.1), [])
        XCTAssertFalse(machine.blocksPlayback)
        XCTAssertEqual(ticks(&machine, 5, level: 0.6), [])
        XCTAssertTrue(machine.blocksPlayback)
        XCTAssertEqual(ticks(&machine, VoiceComposer.endOfTurnTicks - 1, level: 0.1), [])
        XCTAssertEqual(ticks(&machine, 1, level: 0.1), [.sendTalk])
        _ = machine.handle(.talk(.sending))
        XCTAssertEqual(machine.handle(.talk(.idle)), [.startTalk(handsFree: true)])
        XCTAssertEqual(machine.mode, .handsFree)
    }

    func testTappingTheListeningPillGoesBackToPushToTalk() {
        var machine = voiceOn()
        _ = machine.handle(.handsFreeToggled)
        // Nothing said yet: the recording is dropped.
        XCTAssertEqual(machine.handle(.pillTapped), [.cancelTalk])
        XCTAssertEqual(machine.mode, .pushToTalk)
        // And it doesn't listen again when that ends.
        XCTAssertEqual(machine.handle(.talk(.idle)), [])
        XCTAssertEqual(machine.indicator, .none)
    }

    func testTappingThePillAfterSpeakingSendsIt() {
        var machine = voiceOn()
        _ = machine.handle(.handsFreeToggled)
        _ = ticks(&machine, 3, level: 0.6)
        XCTAssertEqual(machine.handle(.pillTapped), [.sendTalk])
        XCTAssertEqual(machine.handle(.talk(.idle)), [])
        XCTAssertEqual(machine.mode, .pushToTalk)
    }

    func testHandsFreeEndedByAnErrorOrACallStops() {
        var machine = voiceOn()
        _ = machine.handle(.handsFreeToggled)
        _ = machine.handle(.talk(.handsFree))
        XCTAssertEqual(machine.handle(.talk(.idle)), [])
        XCTAssertEqual(machine.mode, .pushToTalk)
    }

    // MARK: Interrupts

    func testTalkingOverTheBotHandsFreeStopsIt() {
        var machine = voiceOn()
        _ = machine.handle(.handsFreeToggled)
        _ = machine.handle(.botSpeaking(true))
        XCTAssertEqual(machine.indicator, .output)
        // Its echo, below the barge-in level, doesn't.
        XCTAssertEqual(ticks(&machine, 20, level: 0.4), [])
        // A blip doesn't either.
        XCTAssertEqual(ticks(&machine, VoiceComposer.bargeInTicks - 1, level: 0.7), [])
        XCTAssertEqual(ticks(&machine, 1, level: 0.1), [])
        XCTAssertEqual(ticks(&machine, VoiceComposer.bargeInTicks, level: 0.7), [.stopPlayback])
        XCTAssertTrue(machine.blocksPlayback)
        // Playback stopped: the turn carries on and is sent after the pause.
        XCTAssertEqual(machine.handle(.botSpeaking(false)), [])
        XCTAssertEqual(machine.indicator, .input)
        XCTAssertEqual(ticks(&machine, VoiceComposer.endOfTurnTicks, level: 0.1), [.sendTalk])
    }

    func testAReplyPlayedOutHandsFreeDropsItsEchoAndListensAfresh() {
        var machine = voiceOn()
        _ = machine.handle(.handsFreeToggled)
        _ = machine.handle(.talk(.handsFree))
        _ = machine.handle(.botSpeaking(true))
        XCTAssertEqual(machine.handle(.botSpeaking(false)), [.cancelTalk])
        _ = machine.handle(.talk(.sending))
        XCTAssertEqual(machine.handle(.talk(.idle)), [.startTalk(handsFree: true)])
    }

    func testPushToTalkDoesntBargeInOnLevelsAlone() {
        var machine = voiceOn()
        _ = machine.handle(.botSpeaking(true))
        XCTAssertEqual(ticks(&machine, 10, level: 0.9), [])
        XCTAssertEqual(machine.indicator, .output)
    }

    // MARK: First-use hint

    func testTheHintShowsOnceAndIsRemembered() {
        var machine = VoiceComposer(hintShown: false)
        XCTAssertEqual(machine.handle(.voiceMode(true)), [.rememberHint])
        XCTAssertEqual(machine.indicator, .hint)
        _ = machine.handle(.hintExpired)
        XCTAssertEqual(machine.indicator, .none)
        _ = machine.handle(.voiceMode(false))
        XCTAssertEqual(machine.handle(.voiceMode(true)), [])
        XCTAssertEqual(machine.indicator, .none)
    }

    func testPressingHidesTheHint() {
        var machine = VoiceComposer(hintShown: false)
        _ = machine.handle(.voiceMode(true))
        _ = machine.handle(.pressBegan)
        XCTAssertEqual(machine.indicator, .input)
        _ = machine.handle(.pressEnded)
        _ = machine.handle(.talk(.idle))
        XCTAssertEqual(machine.indicator, .none)
    }

    func testTheHintIsPersistedAcrossComposers() {
        let defaults = UserDefaults(suiteName: "ComposerVoiceTests")!
        defaults.removePersistentDomain(forName: "ComposerVoiceTests")
        let first = ComposerVoice(defaults: defaults)
        XCTAssertFalse(first.machine.hintShown)
        first.send(.voiceMode(true))
        XCTAssertEqual(first.shown.indicator, .hint)
        XCTAssertTrue(defaults.bool(forKey: ComposerVoice.hintKey))
        let second = ComposerVoice(defaults: defaults)
        second.send(.voiceMode(true))
        XCTAssertEqual(second.shown.indicator, .none)
        defaults.removePersistentDomain(forName: "ComposerVoiceTests")
    }

    func testATapOnPushToTalkShowsTheHintAgain() {
        var machine = voiceOn()
        XCTAssertEqual(machine.indicator, .none)
        _ = machine.handle(.pushToTalkTapped)
        XCTAssertEqual(machine.indicator, .hint)
    }

    // MARK: The clock

    func testTheVoiceClockRunsOnlyWithSubscribers() {
        let clock = VoiceClock.shared
        let id = clock.subscribe {}
        XCTAssertTrue(clock.isRunning)
        clock.unsubscribe(id)
        XCTAssertFalse(clock.isRunning)
    }
}
