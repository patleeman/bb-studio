// Downmix to mono and resample to 16 kHz, in a stream of chunks.
import AVFoundation

public final class Resampler {
    public let inputRate: Double
    public let outputRate: Double
    private let converter: AVAudioConverter?
    private let inputFormat: AVAudioFormat
    private let outputFormat: AVAudioFormat

    public init(inputRate: Double, outputRate: Double = 16000) {
        self.inputRate = inputRate
        self.outputRate = outputRate
        inputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: inputRate, channels: 1, interleaved: false)!
        outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: outputRate, channels: 1, interleaved: false)!
        if inputRate == outputRate {
            converter = nil
        } else {
            converter = AVAudioConverter(from: inputFormat, to: outputFormat)
            converter?.sampleRateConverterQuality = AVAudioQuality.high.rawValue
        }
    }

    /// Converts the next chunk of mono samples at `inputRate`.
    public func process(_ samples: [Float]) -> [Float] {
        guard let converter else { return samples }
        guard !samples.isEmpty else { return [] }
        let input = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(samples.count))!
        input.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { input.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        return run(converter, input: input, endOfStream: false)
    }

    /// Whatever the converter still holds, at the end of the stream.
    public func flush() -> [Float] {
        guard let converter else { return [] }
        return run(converter, input: nil, endOfStream: true)
    }

    private func run(_ converter: AVAudioConverter, input: AVAudioPCMBuffer?, endOfStream: Bool) -> [Float] {
        let capacity = AVAudioFrameCount(Double(input?.frameLength ?? 0) * outputRate / inputRate) + 1024
        var result: [Float] = []
        var given = false
        while true {
            let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity)!
            var error: NSError?
            let status = converter.convert(to: output, error: &error) { _, inputStatus in
                if let input, !given {
                    given = true
                    inputStatus.pointee = .haveData
                    return input
                }
                inputStatus.pointee = endOfStream ? .endOfStream : .noDataNow
                return nil
            }
            if output.frameLength > 0 {
                result.append(contentsOf: UnsafeBufferPointer(start: output.floatChannelData![0], count: Int(output.frameLength)))
            }
            // A full buffer may mean more is waiting; anything else means it's drained for now.
            if status == .error || status == .endOfStream || status == .inputRanDry || output.frameLength < capacity {
                break
            }
        }
        return result
    }
}

public enum Downmix {
    /// Mono from `frames` frames of float audio, interleaved or one buffer per channel.
    public static func mono(_ list: UnsafePointer<AudioBufferList>, frames: Int, interleaved: Bool) -> [Float] {
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: list))
        var out = [Float](repeating: 0, count: frames)
        if interleaved {
            guard let first = buffers.first, let data = first.mData else { return out }
            let channels = Int(max(first.mNumberChannels, 1))
            let available = Int(first.mDataByteSize) / MemoryLayout<Float>.size / channels
            let floats = data.assumingMemoryBound(to: Float.self)
            for f in 0..<min(frames, available) {
                var sum: Float = 0
                for c in 0..<channels { sum += floats[f * channels + c] }
                out[f] = sum / Float(channels)
            }
        } else {
            let used = buffers.filter { $0.mData != nil }
            guard !used.isEmpty else { return out }
            for buffer in used {
                let floats = buffer.mData!.assumingMemoryBound(to: Float.self)
                let available = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
                for f in 0..<min(frames, available) { out[f] += floats[f] }
            }
            let scale = 1 / Float(used.count)
            for f in 0..<frames { out[f] *= scale }
        }
        return out
    }

    /// Mono from a deinterleaved AVAudioPCMBuffer.
    public static func mono(_ buffer: AVAudioPCMBuffer) -> [Float] {
        let frames = Int(buffer.frameLength)
        guard let channels = buffer.floatChannelData, frames > 0 else { return [] }
        let count = Int(buffer.format.channelCount)
        if buffer.format.isInterleaved {
            let floats = channels[0]
            return (0..<frames).map { f in (0..<count).reduce(Float(0)) { $0 + floats[f * count + $1] } / Float(count) }
        }
        var out = Array(UnsafeBufferPointer(start: channels[0], count: frames))
        guard count > 1 else { return out }
        for c in 1..<count {
            for f in 0..<frames { out[f] += channels[c][f] }
        }
        let scale = 1 / Float(count)
        for f in 0..<frames { out[f] *= scale }
        return out
    }
}
