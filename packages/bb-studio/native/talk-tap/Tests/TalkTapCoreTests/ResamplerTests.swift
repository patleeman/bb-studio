import XCTest
@testable import TalkTapCore

final class ResamplerTests: XCTestCase {
    func testDownsamples48kInChunks() {
        let resampler = Resampler(inputRate: 48000)
        var out: [Float] = []
        let tone = (0..<48000).map { Float(sin(2 * Double.pi * 440 * Double($0) / 48000)) * 0.5 }
        for start in stride(from: 0, to: tone.count, by: 480) { out += resampler.process(Array(tone[start..<start + 480])) }
        out += resampler.flush()
        XCTAssertEqual(out.count, 16000, accuracy: 64)
        // Still a 440 Hz tone: count rising zero crossings over the middle second.
        let middle = out[2000..<14000]
        let crossings = zip(middle, middle.dropFirst()).filter { $0 < 0 && $1 >= 0 }.count
        XCTAssertEqual(Double(crossings) / 0.75, 440, accuracy: 5)
    }

    func testPassesThrough16k() {
        let resampler = Resampler(inputRate: 16000)
        XCTAssertEqual(resampler.process([0.1, 0.2]), [0.1, 0.2])
        XCTAssertEqual(resampler.flush(), [])
    }

    func testDownmix() throws {
        let format = try XCTUnwrap(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 2))
        buffer.frameLength = 2
        buffer.floatChannelData![0][0] = 1; buffer.floatChannelData![0][1] = 0
        buffer.floatChannelData![1][0] = 0; buffer.floatChannelData![1][1] = -1
        XCTAssertEqual(Downmix.mono(buffer), [0.5, -0.5])

        var interleaved: [Float] = [1, 0, 0.5, 0.5, 0, -1]
        let mono = interleaved.withUnsafeMutableBytes { raw -> [Float] in
            var list = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2, mDataByteSize: UInt32(raw.count), mData: raw.baseAddress))
            return Downmix.mono(&list, frames: 3, interleaved: true)
        }
        XCTAssertEqual(mono, [0.5, 0.5, -0.5])
    }
}

import AVFoundation
