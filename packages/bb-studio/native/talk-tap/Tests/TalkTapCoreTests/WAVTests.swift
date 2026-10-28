import XCTest
@testable import TalkTapCore

final class WAVTests: XCTestCase {
    func testHeader() {
        let data = WAV.encode([0, 1, -1], sampleRate: 16000)
        let bytes = [UInt8](data)
        XCTAssertEqual(bytes.count, 44 + 6)
        XCTAssertEqual(String(decoding: bytes[0..<4], as: UTF8.self), "RIFF")
        XCTAssertEqual(String(decoding: bytes[8..<16], as: UTF8.self), "WAVEfmt ")
        XCTAssertEqual(String(decoding: bytes[36..<40], as: UTF8.self), "data")
        func u32(_ at: Int) -> UInt32 { UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24 }
        func u16(_ at: Int) -> UInt16 { UInt16(bytes[at]) | UInt16(bytes[at + 1]) << 8 }
        XCTAssertEqual(u32(4), 36 + 6) // RIFF size
        XCTAssertEqual(u16(20), 1) // PCM
        XCTAssertEqual(u16(22), 1) // mono
        XCTAssertEqual(u32(24), 16000)
        XCTAssertEqual(u32(28), 32000) // byte rate
        XCTAssertEqual(u16(32), 2) // block align
        XCTAssertEqual(u16(34), 16) // bits
        XCTAssertEqual(u32(40), 6)
        XCTAssertEqual(Int16(bitPattern: u16(44)), 0)
        XCTAssertEqual(Int16(bitPattern: u16(46)), Int16.max)
        XCTAssertEqual(Int16(bitPattern: u16(48)), -Int16.max)
    }

    func testRoundTripAndClipping() throws {
        let samples: [Float] = [0, 0.5, -0.25, 2, -3]
        let decoded = try WAV.decode(WAV.encode(samples))
        XCTAssertEqual(decoded.sampleRate, 16000)
        XCTAssertEqual(decoded.channels, 1)
        XCTAssertEqual(decoded.samples.count, 5)
        for (a, b) in zip(decoded.samples, [0, 0.5, -0.25, 1, -1] as [Float]) { XCTAssertEqual(a, b, accuracy: 1.0 / 32767) }
    }

    func testAtomicWrite() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("wav-\(UUID())")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("them-00000.wav").path
        try WAV.write(TestSignals.syllable(), to: path)
        try WAV.write([0.1, 0.2], to: path) // overwrite
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: dir.path), ["them-00000.wav"])
        XCTAssertEqual(try WAV.decode(Data(contentsOf: URL(fileURLWithPath: path))).samples.count, 2)
    }

    func testRejectsNonPCM() {
        XCTAssertThrowsError(try WAV.decode(Data("RIFF0000WAVE".utf8)))
        XCTAssertThrowsError(try WAV.decode(Data([1, 2, 3])))
    }
}
