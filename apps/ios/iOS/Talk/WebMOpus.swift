import AVFoundation

/// Opus audio from a WebM file, as MediaRecorder writes it: the packets and
/// the track's channel count. AVFoundation can't open WebM, but it can decode Opus.
struct WebMOpus {
    var channels = 1
    var preSkip = 0
    var packets: [Data] = []

    init(_ data: Data) throws {
        let bytes = [UInt8](data)
        var index = 0
        // Master elements are entered (MediaRecorder writes Segment and Cluster with
        // unknown sizes), blocks are read, and everything else is skipped.
        let masters: Set<UInt32> = [0x1853_8067, 0x1F43_B675, 0x1654_AE6B, 0xAE, 0xE1, 0xA0]
        while index < bytes.count {
            guard let id = Self.vint(bytes, &index, keepMarker: true), let size = Self.vint(bytes, &index, keepMarker: false) else { break }
            // All value bits set means the size is unknown.
            let unknown = size.value == (UInt64(1) << (7 * UInt64(size.length))) - 1
            if masters.contains(UInt32(truncatingIfNeeded: id.value)) { continue }
            let end = unknown ? bytes.count : min(bytes.count, index + Int(size.value))
            switch id.value {
            case 0xA3, 0xA1:  // SimpleBlock, Block
                var cursor = index
                _ = Self.vint(bytes, &cursor, keepMarker: false)  // track
                cursor += 2  // timecode
                let flags = cursor < end ? bytes[cursor] : 0
                cursor += 1
                if flags & 0x06 == 0, cursor < end { packets.append(Data(bytes[cursor..<end])) }
            case 0x9F:  // Channels
                channels = max(1, Int(Self.uint(bytes[index..<end])))
            case 0x63A2:  // CodecPrivate: OpusHead
                let head = Array(bytes[index..<end])
                if head.count >= 12 {
                    channels = max(1, Int(head[9]))
                    preSkip = Int(head[10]) | Int(head[11]) << 8
                }
            default:
                break
            }
            index = end
        }
        guard !packets.isEmpty else { throw CocoaError(.fileReadCorruptFile) }
    }

    /// 48 kHz frames in a packet, from its TOC byte (RFC 6716 §3.1).
    static func frames(_ packet: Data) -> Int {
        guard let toc = packet.first else { return 0 }
        let config = Int(toc >> 3)
        let size: Int
        switch config {
        case 0...11: size = [480, 960, 1920, 2880][config % 4]
        case 12...15: size = [480, 960][config % 2]
        default: size = [120, 240, 480, 960][config % 4]
        }
        switch toc & 0x03 {
        case 0: return size
        case 1, 2: return size * 2
        default: return packet.count > 1 ? size * Int(packet[packet.startIndex + 1] & 0x3F) : 0
        }
    }

    /// Decodes to 48 kHz float PCM.
    func decode() throws -> AVAudioPCMBuffer {
        var description = AudioStreamBasicDescription(
            mSampleRate: 48000, mFormatID: kAudioFormatOpus, mFormatFlags: 0, mBytesPerPacket: 0,
            mFramesPerPacket: 0, mBytesPerFrame: 0, mChannelsPerFrame: UInt32(channels), mBitsPerChannel: 0, mReserved: 0)
        guard let input = AVAudioFormat(streamDescription: &description),
            let output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: AVAudioChannelCount(channels), interleaved: false),
            let converter = AVAudioConverter(from: input, to: output)
        else { throw CocoaError(.featureUnsupported) }
        let total = packets.reduce(0) { $0 + Self.frames($1) }
        guard total > 0, let pcm = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: AVAudioFrameCount(total)) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let maxPacket = packets.map(\.count).max() ?? 0
        var next = 0
        var failure: NSError?
        while next < packets.count {
            guard let chunk = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: 5760) else { break }
            let status = converter.convert(to: chunk, error: &failure) { _, state in
                guard next < packets.count else {
                    state.pointee = .endOfStream
                    return nil
                }
                let packet = packets[next]
                let buffer = AVAudioCompressedBuffer(format: input, packetCapacity: 1, maximumPacketSize: maxPacket)
                packet.copyBytes(to: buffer.data.assumingMemoryBound(to: UInt8.self), count: packet.count)
                buffer.packetDescriptions?.pointee = AudioStreamPacketDescription(
                    mStartOffset: 0, mVariableFramesInPacket: UInt32(Self.frames(packet)), mDataByteSize: UInt32(packet.count))
                buffer.packetCount = 1
                buffer.byteLength = UInt32(packet.count)
                next += 1
                state.pointee = .haveData
                return buffer
            }
            if status == .error { throw failure ?? CocoaError(.fileReadCorruptFile) }
            append(chunk, to: pcm)
            if status == .endOfStream { break }
        }
        return pcm
    }

    private func append(_ chunk: AVAudioPCMBuffer, to pcm: AVAudioPCMBuffer) {
        let count = min(chunk.frameLength, pcm.frameCapacity - pcm.frameLength)
        guard count > 0, let from = chunk.floatChannelData, let to = pcm.floatChannelData else { return }
        for channel in 0..<Int(pcm.format.channelCount) {
            (to[channel] + Int(pcm.frameLength)).update(from: from[channel], count: Int(count))
        }
        pcm.frameLength += count
    }

    private static func vint(_ bytes: [UInt8], _ index: inout Int, keepMarker: Bool) -> (value: UInt64, length: Int)? {
        guard index < bytes.count else { return nil }
        let first = bytes[index]
        let length = first.leadingZeroBitCount + 1
        guard length <= 8, index + length <= bytes.count else { return nil }
        var value = UInt64(keepMarker ? first : first & (0xFF >> length))
        for offset in 1..<length { value = value << 8 | UInt64(bytes[index + offset]) }
        index += length
        return (value, length)
    }

    private static func uint(_ slice: ArraySlice<UInt8>) -> UInt64 {
        slice.reduce(0) { $0 << 8 | UInt64($1) }
    }
}
