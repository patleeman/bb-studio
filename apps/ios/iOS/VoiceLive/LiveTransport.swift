import AVFAudio
import Foundation
import WebRTC
import os

private let log = Logger(subsystem: "nyc.plee.bbgo", category: "voice-live")

/// One live session's connection: audio both ways and the JSON event channel.
@MainActor
protocol LiveTransport: AnyObject {
    var onMessage: ((Data) -> Void)? { get set }
    var onClosed: ((String?) -> Void)? { get set }
    /// Mic frames (linear RMS, oldest first) and the voice's playback level, for barge-in by level.
    var onLevels: (([Float], Float) -> Void)? { get set }
    func send(_ data: Data)
    /// Barge-in: off silences the voice at once; on lets its next reply play.
    func setAgentAudio(enabled: Bool)
    func setMicMuted(_ muted: Bool)
    func close()
}

/// A WebRTC connection: the offer, then the answer (WebRTCLiveTransport; a fake in tests).
@MainActor
protocol LivePeer: LiveTransport {
    func makeOffer() async throws -> String
    func setAnswer(_ sdp: String) async throws
}

// MARK: - WebRTC (GPT-Live and the Realtime API)

/// The phone's side of a WebRTC session with OpenAI: the mic track up, the
/// voice's track down, and the `oai-events` data channel. The SDP offer goes
/// to Studio (gpt-live-1, which creates the session with its key) or to
/// OpenAI with a 2-minute client secret (gpt-realtime-2.1).
@MainActor
final class WebRTCLiveTransport: NSObject, LivePeer {
    var onMessage: ((Data) -> Void)?
    var onClosed: ((String?) -> Void)?
    var onLevels: (([Float], Float) -> Void)?
    private var meter: Task<Void, Never>?

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory()
    }()

    private var peer: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var mic: RTCAudioTrack?
    private var remote: RTCAudioTrack?
    private var agentAudio = true
    private var gathered: CheckedContinuation<Void, Never>?
    private var queued: [Data] = []

    /// Makes the peer connection and returns its SDP offer, once ICE gathering is done (or 2 s).
    /// The audio session is VoiceLiveAudio's: it's active, and WebRTC told, before this runs.
    func makeOffer() async throws -> String {
        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherOnce
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let peer = Self.factory.peerConnection(with: config, constraints: constraints, delegate: self) else {
            throw BBError(status: 0, message: "Couldn't start the voice connection.")
        }
        self.peer = peer
        let source = Self.factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let mic = Self.factory.audioTrack(with: source, trackId: "mic")
        peer.add(mic, streamIds: ["voice"])
        self.mic = mic
        // The data channel comes before the offer, or it isn't in the SDP.
        let channel = peer.dataChannel(forLabel: "oai-events", configuration: RTCDataChannelConfiguration())
        channel?.delegate = self
        self.channel = channel
        let offer = try await peer.offer(for: RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true"], optionalConstraints: nil))
        try await peer.setLocalDescription(offer)
        if peer.iceGatheringState != .complete {
            await withCheckedContinuation { continuation in
                gathered = continuation
                Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .seconds(2))
                    self?.finishGathering()
                }
            }
        }
        return peer.localDescription?.sdp ?? offer.sdp
    }

    func setAnswer(_ sdp: String) async throws {
        try await peer?.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp))
        startMeter()
    }

    /// The mic's and the voice's levels every 50 ms, from WebRTC's stats (`audioLevel`, linear 0–1):
    /// media-source is the mic after echo cancellation, inbound-rtp the voice as played.
    private func startMeter() {
        meter?.cancel()
        meter = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                guard let self, let peer = self.peer else { return }
                let levels: (Float, Float) = await withCheckedContinuation { continuation in
                    peer.statistics { report in
                        var mic: Float = 0, voice: Float = 0
                        for stats in report.statistics.values where (stats.values["kind"] as? String) == "audio" {
                            let level = (stats.values["audioLevel"] as? NSNumber)?.floatValue ?? 0
                            if stats.type == "media-source" { mic = level }
                            if stats.type == "inbound-rtp" { voice = level }
                        }
                        continuation.resume(returning: (mic, voice))
                    }
                }
                self.onLevels?([levels.0], self.agentAudio ? levels.1 : 0)
            }
        }
    }

    /// Realtime: post the offer to OpenAI with the client secret; returns the answer.
    static func exchange(offer: String, url: URL, secret: String) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(offer.utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) else {
            throw BBError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: "OpenAI refused the voice connection.")
        }
        return String(decoding: data, as: UTF8.self)
    }

    private func finishGathering() {
        gathered?.resume()
        gathered = nil
    }

    func send(_ data: Data) {
        guard let channel, channel.readyState == .open else { queued.append(data); return }
        channel.sendData(RTCDataBuffer(data: data, isBinary: false))
    }

    func setAgentAudio(enabled: Bool) {
        agentAudio = enabled
        remote?.isEnabled = enabled
    }

    func setMicMuted(_ muted: Bool) {
        mic?.isEnabled = !muted
    }

    func close() {
        meter?.cancel()
        channel?.close()
        peer?.close()
        peer = nil
        channel = nil
        mic = nil
        remote = nil
        // WebRTC's audio (and its voice-processing unit) is VoiceLiveAudio's to turn off.
    }

    fileprivate func opened() {
        guard let channel else { return }
        for data in queued { channel.sendData(RTCDataBuffer(data: data, isBinary: false)) }
        queued = []
    }

    fileprivate func received(track: RTCMediaStreamTrack) {
        guard let audio = track as? RTCAudioTrack else { return }
        remote = audio
        audio.isEnabled = agentAudio
    }
}

extension WebRTCLiveTransport: RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        guard newState == .failed || newState == .closed else { return }
        Task { @MainActor in self.onClosed?(newState == .failed ? "The connection was lost." : nil) }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        guard newState == .complete else { return }
        Task { @MainActor in self.finishGathering() }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams mediaStreams: [RTCMediaStream]) {
        guard let track = rtpReceiver.track else { return }
        Task { @MainActor in self.received(track: track) }
    }

    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let state = dataChannel.readyState
        Task { @MainActor in
            if state == .open { self.opened() }
            if state == .closed { self.onClosed?(nil) }
        }
    }

    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        let data = buffer.data
        Task { @MainActor in self.onMessage?(data) }
    }
}

// MARK: - The scripted mock (staged BBs and simulators)

/// A WebSocket to `scripts/voice-mock`: GPT-Live's events, plus the voice's
/// audio as 24 kHz PCM16 chunks (`mock.audio.delta`) played here. No mic:
/// the script plays the user's side too. Barge-in stops the player at once.
@MainActor
final class MockLiveTransport: LiveTransport {
    var onMessage: ((Data) -> Void)?
    var onClosed: ((String?) -> Void)?
    var onLevels: (([Float], Float) -> Void)?

    private let socket: URLSessionWebSocketTask
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24_000, channels: 1, interleaved: false)!
    private var agentAudio = true

    init(url: URL) {
        socket = URLSession.shared.webSocketTask(with: url)
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    func connect() {
        try? engine.start()
        player.play()
        socket.resume()
        receive()
    }

    private func receive() {
        socket.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .failure(let error):
                    self.onClosed?(error.localizedDescription)
                case .success(let message):
                    switch message {
                    case .string(let text): self.handle(Data(text.utf8))
                    case .data(let data): self.handle(data)
                    @unknown default: break
                    }
                    self.receive()
                }
            }
        }
    }

    private func handle(_ data: Data) {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if object["type"] as? String == "mock.audio.delta", let base64 = object["audio"] as? String, let pcm = Data(base64Encoded: base64) {
                if agentAudio { play(pcm) }
                return
            }
            // The phone's mic as the bridge hears it (the script's speech plus the voice's echo).
            if object["type"] as? String == "mock.levels", let mic = object["mic"] as? [NSNumber] {
                onLevels?(mic.map(\.floatValue), agentAudio ? ((object["playback"] as? NSNumber)?.floatValue ?? 0) : 0)
                return
            }
        }
        onMessage?(data)
    }

    private func play(_ pcm: Data) {
        let count = pcm.count / 2
        guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)) else { return }
        buffer.frameLength = AVAudioFrameCount(count)
        let out = buffer.floatChannelData![0]
        pcm.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for index in 0..<count { out[index] = Float(Int16(littleEndian: samples[index])) / 32768 }
        }
        player.scheduleBuffer(buffer)
    }

    func send(_ data: Data) {
        socket.send(.string(String(decoding: data, as: UTF8.self))) { error in
            if let error { log.error("mock send failed: \(error.localizedDescription, privacy: .public)") }
        }
    }

    func setAgentAudio(enabled: Bool) {
        guard enabled != agentAudio else { return }
        agentAudio = enabled
        if enabled { player.play() } else { player.stop() }
        // So the bridge can time the mute (and drop the voice from its recording meanwhile).
        send(Data(#"{"type":"\#(enabled ? "mock.unmuted" : "mock.muted")"}"#.utf8))
    }

    func setMicMuted(_ muted: Bool) {}

    func close() {
        socket.cancel(with: .normalClosure, reason: nil)
        player.stop()
        engine.stop()
    }
}
