import XCTest
@testable import TalkTapCore

/// Real speech to text. Skipped unless TALK_TAP_WHISPER_MODEL_DIR is set, because the
/// first run downloads the model (626 MB for the default) and compiles it for the
/// Neural Engine. Speech comes from macOS's `say`, rendered to files (nothing plays).
///
///   TALK_TAP_WHISPER_MODEL_DIR=/tmp/talk-tap-models swift test --filter WhisperKitTests
///   TALK_TAP_WHISPER_MODEL=openai_whisper-base.en   (optional; the default is below)
final class WhisperKitTests: XCTestCase {
    static let defaultModel = "openai_whisper-large-v3-v20240930_626MB"
    var dir: URL!
    var modelDir: String!
    var model: String!

    override func setUpWithError() throws {
        guard let modelDir = ProcessInfo.processInfo.environment["TALK_TAP_WHISPER_MODEL_DIR"], !modelDir.isEmpty else {
            throw XCTSkip("set TALK_TAP_WHISPER_MODEL_DIR to run WhisperKit tests (downloads the model)")
        }
        self.modelDir = modelDir
        model = ProcessInfo.processInfo.environment["TALK_TAP_WHISPER_MODEL"] ?? Self.defaultModel
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("talk-tap-wk-\(UUID())")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let dir { try? FileManager.default.removeItem(at: dir) }
    }

    /// Renders `text` with `say` as 16 kHz 16-bit WAV. `[[slnc 2000]]` inserts 2 s of silence.
    func say(_ text: String, to name: String) throws -> String {
        let path = dir.appendingPathComponent(name).path
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        process.arguments = ["-o", path, "--file-format=WAVE", "--data-format=LEI16@16000", text]
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)
        return path
    }

    func testFakeCaptureGivesFinalTranscripts() throws {
        let them = try say("""
            Thanks for joining the call today. I wanted to go over the quarterly budget, and then the launch timeline for the new app. \
            [[slnc 2000]] The design review is done, and engineering thinks we can ship in three weeks. \
            [[slnc 2000]] Let's schedule a follow up meeting on Thursday afternoon.
            """, to: "them.wav")
        let me = try say("[[slnc 9000]] Sounds good to me. [[slnc 6000]] I will send the meeting notes after the call.", to: "me.wav")
        let args = #"{"target":{"all":true},"mic":true,"segmentDir":"\#(dir.appendingPathComponent("seg").path)","stt":{"kind":"whisperkit","model":"\#(model!)","modelDir":"\#(modelDir!)"}}"#
        let run = try IntegrationTests.Run(["capture", "--json-args", args, "--fake", them, me, "--fake-speed", "4"])
        // Allow for a first download and Neural Engine compile.
        XCTAssertTrue(run.wait(timeout: 1800))
        let events = run.events
        XCTAssertEqual(events.last?["event"] as? String, "stopped")
        XCTAssertFalse(events.contains { $0["event"] as? String == "error" }, "\(events.filter { $0["event"] as? String == "error" })")
        XCTAssertEqual(events.last { $0["event"] as? String == "model" }?["stage"] as? String, "ready")

        let segments = events.filter { $0["event"] as? String == "segment" }
        let finals = events.filter { $0["event"] as? String == "final" }
        XCTAssertEqual(finals.count, segments.count)
        func text(_ source: String) -> String {
            finals.filter { $0["source"] as? String == source }.compactMap { $0["text"] as? String }.joined(separator: " ").lowercased()
        }
        print("them:", text("them"))
        print("me:", text("me"))
        for word in ["budget", "launch", "three weeks", "thursday"] { XCTAssertTrue(text("them").contains(word), word) }
        for word in ["sounds good", "notes"] { XCTAssertTrue(text("me").contains(word), word) }
    }

    /// Times transcription of 8 s and 15 s segments (the target and maximum).
    func testSpeedOnSegmentLengths() async throws {
        let transcriber = try await WhisperKitLoader.makeTranscriber(model: model, modelDir: modelDir, language: nil, sink: nil)
        let speech = try WAV.decode(Data(contentsOf: URL(fileURLWithPath: say(
            "We reviewed the budget for the quarter, and the numbers look better than expected. Marketing spent less on ads, " +
            "and sales closed two large deals in September. Next we need to decide on hiring for the support team. " +
            "The support queue has grown every week since the launch, and customers are waiting more than a day for answers. " +
            "If we hire two people this month, they could be ready before the holidays.",
            to: "long.wav"
        )))).samples
        XCTAssertGreaterThan(speech.count, 15 * 16000)
        _ = try await transcriber.transcribe(Array(speech.prefix(16000 * 2))) // warm up
        for seconds in [8, 15] {
            let clip = Array(speech.prefix(seconds * 16000))
            var times: [Double] = []
            for _ in 0..<3 {
                let start = Date()
                let text = try await transcriber.transcribe(clip)
                times.append(Date().timeIntervalSince(start))
                XCTAssertTrue(text.lowercased().contains("budget"), text)
            }
            let median = times.sorted()[1]
            print(String(format: "%@: %d s segment transcribed in %.2f s (%.1fx real time)", model, seconds, median, Double(seconds) / median))
            // Real time or better with room to spare: both sources share one transcriber.
            XCTAssertLessThan(median, Double(seconds) / 2)
        }
    }
}
