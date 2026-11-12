// 16-bit PCM WAV files: segments are written as 16 kHz mono.
import Foundation

public enum WAV {
    /// The bytes of a 16-bit PCM WAV file holding `samples` (-1...1, clipped).
    public static func encode(_ samples: [Float], sampleRate: Int = 16000, channels: Int = 1) -> Data {
        var pcm = Data(capacity: samples.count * 2)
        for sample in samples {
            let clipped = max(-1, min(1, sample))
            let value = Int16((clipped * Float(Int16.max)).rounded())
            withUnsafeBytes(of: value.littleEndian) { pcm.append(contentsOf: $0) }
        }
        var data = Data(capacity: 44 + pcm.count)
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + pcm.count))
        data.append(contentsOf: Array("WAVE".utf8))
        data.append(contentsOf: Array("fmt ".utf8)); u32(16)
        u16(1) // PCM
        u16(UInt16(channels))
        u32(UInt32(sampleRate))
        u32(UInt32(sampleRate * channels * 2)) // byte rate
        u16(UInt16(channels * 2)) // block align
        u16(16) // bits per sample
        data.append(contentsOf: Array("data".utf8)); u32(UInt32(pcm.count))
        data.append(pcm)
        return data
    }

    /// Writes the file atomically (a temp file, then a rename), so a reader never sees half a segment.
    public static func write(_ samples: [Float], to path: String, sampleRate: Int = 16000) throws {
        let url = URL(fileURLWithPath: path)
        let temp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).partial")
        try encode(samples, sampleRate: sampleRate).write(to: temp)
        _ = try? FileManager.default.removeItem(at: url)
        try FileManager.default.moveItem(at: temp, to: url)
    }

    public struct Decoded: Equatable {
        public var sampleRate: Int
        public var channels: Int
        /// Interleaved samples, -1...1.
        public var samples: [Float]
    }

    /// Reads a 16-bit PCM WAV, skipping chunks other than `fmt ` and `data`.
    public static func decode(_ data: Data) throws -> Decoded {
        let bytes = [UInt8](data)
        func u32(_ at: Int) -> UInt32 { UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24 }
        func u16(_ at: Int) -> UInt16 { UInt16(bytes[at]) | UInt16(bytes[at + 1]) << 8 }
        func tag(_ at: Int) -> String { String(decoding: bytes[at..<at + 4], as: UTF8.self) }
        guard bytes.count >= 12, tag(0) == "RIFF", tag(8) == "WAVE" else { throw ProtocolError("not a WAV file") }
        var offset = 12
        var rate = 0, channels = 0, bits = 0
        while offset + 8 <= bytes.count {
            let id = tag(offset)
            let size = Int(u32(offset + 4))
            let body = offset + 8
            guard body + size <= bytes.count else { throw ProtocolError("truncated \(id) chunk") }
            if id == "fmt " {
                guard u16(body) == 1 else { throw ProtocolError("only PCM WAV is supported") }
                channels = Int(u16(body + 2))
                rate = Int(u32(body + 4))
                bits = Int(u16(body + 14))
            } else if id == "data" {
                guard bits == 16, channels > 0 else { throw ProtocolError("only 16-bit PCM WAV is supported") }
                var samples = [Float]()
                samples.reserveCapacity(size / 2)
                var i = body
                while i + 1 < body + size {
                    samples.append(Float(Int16(bitPattern: u16(i))) / Float(Int16.max))
                    i += 2
                }
                return Decoded(sampleRate: rate, channels: channels, samples: samples)
            }
            offset = body + size + (size & 1)
        }
        throw ProtocolError("WAV file has no data chunk")
    }
}
