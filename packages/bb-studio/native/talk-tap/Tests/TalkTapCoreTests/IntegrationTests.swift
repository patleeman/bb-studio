import XCTest
@testable import TalkTapCore

/// Runs the built bb-talk-tap in fake mode, the way Studio's server does, and reads its events.
/// Never creates a tap or opens the mic.
final class IntegrationTests: XCTestCase {
    var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("talk-tap-it-\(UUID())")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    static var binary: URL {
        Bundle(for: IntegrationTests.self).bundleURL.deletingLastPathComponent().appendingPathComponent("bb-talk-tap")
    }

    final class Run {
        let process = Process()
        let stdin = Pipe()
        let stdout = Pipe()
        private let lock = NSLock()
        private var buffer = Data()
        private var parsed: [[String: Any]] = []

        init(_ arguments: [String]) throws {
            process.executableURL = IntegrationTests.binary
            process.arguments = arguments
            process.standardInput = stdin
            process.standardOutput = stdout
            process.standardError = FileHandle.nullDevice
            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                guard let self else { return }
                let data = handle.availableData
                self.lock.lock()
                self.buffer.append(data)
                while let newline = self.buffer.firstIndex(of: 0x0A) {
                    let line = self.buffer[self.buffer.startIndex..<newline]
                    self.buffer.removeSubrange(self.buffer.startIndex...newline)
                    if let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] { self.parsed.append(object) }
                }
                self.lock.unlock()
            }
            try process.run()
        }

        var events: [[String: Any]] { lock.lock(); defer { lock.unlock() }; return parsed }

        func send(_ line: String) { stdin.fileHandleForWriting.write(Data((line + "\n").utf8)) }

        func wait(timeout: TimeInterval) -> Bool {
            let deadline = Date().addingTimeInterval(timeout)
            while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
            if process.isRunning { process.terminate(); return false }
            Thread.sleep(forTimeInterval: 0.1) // let the last lines arrive
            return true
        }
    }

    func writeWav(_ name: String, _ samples: [Float], rate: Int = 16000) throws -> String {
        let path = dir.appendingPathComponent(name).path
        try WAV.write(samples, to: path, sampleRate: rate)
        return path
    }

    func captureArgs(mic: Bool = true, stt: String = #"{"kind":"test"}"#) -> String {
        #"{"target":{"bundleIds":["us.zoom.xos"]},"mic":\#(mic),"segmentDir":"\#(dir.appendingPathComponent("segments").path)","segmentTargetMs":8000,"segmentMaxMs":15000,"stt":\#(stt)}"#
    }

    func testFakeCaptureRunsToTheEndOfTheFiles() throws {
        // Them: 3 s turns with pauses for about 30 s. Me: a few short replies, at 48 kHz to exercise resampling.
        let them = try writeWav("them.wav", TestSignals.talk(utterances: Array(repeating: 3000, count: 8), pauseMs: 700, leadMs: 500))
        let meAudio16k = TestSignals.talk(utterances: [1500, 1200, 2000], pauseMs: 6000, leadMs: 4000, pitch: 220)
        let me48k = Resampler(inputRate: 16000, outputRate: 48000)
        let me = try writeWav("me.wav", me48k.process(meAudio16k) + me48k.flush(), rate: 48000)

        let run = try Run(["capture", "--json-args", captureArgs(), "--fake", them, me, "--fake-speed", "10"])
        XCTAssertTrue(run.wait(timeout: 30), "helper didn't stop at the end of the files")
        XCTAssertEqual(run.process.terminationStatus, 0)
        let events = run.events

        XCTAssertEqual(events.first?["event"] as? String, "started")
        XCTAssertEqual(events.first?["sources"] as? [String], ["them", "me"])
        XCTAssertEqual(events.last?["event"] as? String, "stopped")
        XCTAssertFalse(events.contains { $0["event"] as? String == "error" }, "\(events.filter { $0["event"] as? String == "error" })")

        for source in ["them", "me"] {
            let segments = events.filter { $0["event"] as? String == "segment" && $0["source"] as? String == source }
            XCTAssertEqual(segments.map { $0["index"] as? Int }, Array(0..<segments.count), source)
            // Them: about 30 s in 8 s+ segments. Me: three replies, each closed by the long pause after it.
            XCTAssertEqual(segments.count, source == "them" ? 3 : 3, source)
            var lastEnd = -1
            for segment in segments {
                let path = try XCTUnwrap(segment["path"] as? String)
                let start = try XCTUnwrap(segment["startMs"] as? Int)
                let end = try XCTUnwrap(segment["endMs"] as? Int)
                XCTAssertTrue(path.hasPrefix(dir.path) && path.hasSuffix(".wav"))
                XCTAssertGreaterThanOrEqual(start, lastEnd)
                XCTAssertLessThanOrEqual(end - start, 15000)
                lastEnd = end
                let wav = try WAV.decode(Data(contentsOf: URL(fileURLWithPath: path)))
                XCTAssertEqual(wav.sampleRate, 16000)
                XCTAssertEqual(wav.channels, 1)
                XCTAssertEqual(wav.samples.count, (end - start) * 16, accuracy: 16)

                // Each segment gets exactly one final, after its segment event, with the same times.
                let index = segment["index"] as! Int
                let segmentAt = events.firstIndex { $0["event"] as? String == "segment" && $0["source"] as? String == source && $0["index"] as? Int == index }!
                let finals = events.indices.filter { events[$0]["event"] as? String == "final" && events[$0]["source"] as? String == source && events[$0]["index"] as? Int == index }
                XCTAssertEqual(finals.count, 1)
                if let at = finals.first {
                    XCTAssertGreaterThan(at, segmentAt)
                    XCTAssertEqual(events[at]["startMs"] as? Int, start)
                    XCTAssertEqual(events[at]["endMs"] as? Int, end)
                    XCTAssertEqual(events[at]["text"] as? String, "\(wav.samples.count * 1000 / 16000) ms of audio")
                }
                // Partials never come after their final.
                let partials = events.indices.filter { events[$0]["event"] as? String == "partial" && events[$0]["source"] as? String == source && events[$0]["index"] as? Int == index }
                XCTAssertTrue(partials.allSatisfy { $0 < (finals.first ?? .max) })
            }
            // Me's first reply starts after 4 s of silence, give or take the pre-roll.
            if source == "me" { XCTAssertEqual(segments.first?["startMs"] as? Int ?? 0, 3700, accuracy: 100) }

            // Levels: about one per 100 ms of audio, never more.
            let levels = events.filter { $0["event"] as? String == "level" && $0["source"] as? String == source }
            let audioMs = (source == "them" ? 8 * 3700 + 500 : 4000 + 4700 + 3 * 6000) as Int
            XCTAssertLessThanOrEqual(levels.count, audioMs / 100 + 1)
            XCTAssertGreaterThanOrEqual(levels.count, audioMs / 100 - 5)
        }
        // Them's turns are 3 s with 700 ms pauses, so segments close at a pause past 8 s.
        let themSegments = events.filter { $0["event"] as? String == "segment" && $0["source"] as? String == "them" }
        for segment in themSegments.dropLast() {
            XCTAssertGreaterThanOrEqual((segment["endMs"] as! Int) - (segment["startMs"] as! Int), 8000 - 350)
        }
    }

    func testStopOnStdinClosesTheOpenSegment() throws {
        let them = try writeWav("them.wav", TestSignals.utterance(ms: 60000))
        let me = try writeWav("me.wav", TestSignals.silence(ms: 60000))
        let run = try Run(["capture", "--json-args", captureArgs(stt: #"{"kind":"none"}"#), "--fake", them, me])
        Thread.sleep(forTimeInterval: 2)
        run.send(#"{"cmd":"stop"}"#)
        XCTAssertTrue(run.wait(timeout: 10))
        XCTAssertEqual(run.process.terminationStatus, 0)
        let events = run.events
        XCTAssertEqual(events.last?["event"] as? String, "stopped")
        let segments = events.filter { $0["event"] as? String == "segment" }
        XCTAssertEqual(segments.count, 1)
        XCTAssertEqual(segments.first?["source"] as? String, "them")
        XCTAssertEqual(segments.first?["startMs"] as? Int, 0)
        XCTAssertEqual(Double(segments.first?["endMs"] as? Int ?? 0), 2000, accuracy: 700)
        XCTAssertFalse(events.contains { ["final", "partial"].contains($0["event"] as? String) }) // stt none
    }

    func testClosingStdinStops() throws {
        let them = try writeWav("them.wav", TestSignals.silence(ms: 60000))
        let run = try Run(["capture", "--json-args", captureArgs(mic: false), "--fake", them, them])
        Thread.sleep(forTimeInterval: 0.5)
        try run.stdin.fileHandleForWriting.close()
        XCTAssertTrue(run.wait(timeout: 10))
        let events = run.events
        XCTAssertEqual(events.first?["sources"] as? [String], ["them"])
        XCTAssertEqual(events.last?["event"] as? String, "stopped")
        XCTAssertFalse(events.contains { $0["event"] as? String == "segment" })
    }

    func testBadArgumentsReportAnError() throws {
        let run = try Run(["capture", "--json-args", #"{"target":{"all":true},"segmentDir":"nope"}"#])
        XCTAssertTrue(run.wait(timeout: 10))
        XCTAssertEqual(run.process.terminationStatus, 2)
        XCTAssertEqual(run.events.map { $0["event"] as? String }, ["error", "stopped"])
        XCTAssertEqual(run.events.first?["code"] as? String, "internal")
    }

    func testMissingFakeFile() throws {
        let run = try Run(["capture", "--json-args", captureArgs(), "--fake", "/nonexistent/a.wav", "/nonexistent/b.wav"])
        XCTAssertTrue(run.wait(timeout: 10))
        XCTAssertNotEqual(run.process.terminationStatus, 0)
        XCTAssertEqual(run.events.last?["event"] as? String, "stopped")
    }

    func testPermissionAndVersionCommandsDontPrompt() throws {
        let run = try Run(["permission"])
        XCTAssertTrue(run.wait(timeout: 10))
        let status = try XCTUnwrap(run.events.first?["audioCapture"] as? String)
        XCTAssertTrue(["granted", "denied", "undetermined"].contains(status))

        let apps = try Run(["apps"])
        XCTAssertTrue(apps.wait(timeout: 10))
        XCTAssertNotNil(apps.events.first?["apps"] as? [[String: Any]])
    }
}
