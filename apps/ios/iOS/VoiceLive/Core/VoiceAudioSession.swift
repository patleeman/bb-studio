import AVFAudio

/// The audio session for talking: hands-free voice holds one from start to
/// hang-up, and Talk dictation uses the same Bluetooth rules.
///
/// - `.playAndRecord` the whole time, never switched between turns, so the
///   route doesn't flap.
/// - Bluetooth HFP is allowed, so a car or headset mic is used; A2DP too, and
///   iOS prefers HFP on a device that has both. `bluetoothHighQualityRecording`
///   asks for wide-band where the route supports it, and far-field input
///   (iOS 26.2, needs HFP) where the device offers it.
/// - `.voiceChat` cancels the voice's own echo, which barge-in depends on.
struct VoiceAudioConfig: Equatable, Sendable {
    var category: AVAudioSession.Category
    var mode: AVAudioSession.Mode
    var options: AVAudioSession.CategoryOptions
    var prefersEchoCancelledInput: Bool

    /// A hands-free voice session: echo cancelled, speaker by default, other audio ducked.
    static let handsFree = VoiceAudioConfig(
        category: .playAndRecord, mode: .voiceChat,
        options: [.allowBluetoothHFP, .allowBluetoothA2DP, .bluetoothHighQualityRecording, .defaultToSpeaker, .duckOthers],
        prefersEchoCancelledInput: true)

    /// Talk dictation. HFP is allowed now so a headset or car mic records; it's
    /// chosen before the engine starts, and a later route change restarts the
    /// capture engine (SegmentCapture.restart) instead of stalling it.
    static func dictation(echoCancelling: Bool) -> VoiceAudioConfig {
        VoiceAudioConfig(
            category: .playAndRecord, mode: echoCancelling ? .voiceChat : .default,
            options: [.allowBluetoothHFP, .allowBluetoothA2DP, .bluetoothHighQualityRecording, .defaultToSpeaker],
            prefersEchoCancelledInput: echoCancelling)
    }

    /// The options to set on this OS: far-field input where it exists (it requires HFP).
    func resolvedOptions(farFieldAvailable: Bool) -> AVAudioSession.CategoryOptions {
        var resolved = options
        if farFieldAvailable, options.contains(.allowBluetoothHFP) {
            if #available(iOS 26.2, *) { resolved.insert(.farFieldInput) }
        }
        return resolved
    }

    func apply(to session: AudioSessionControl) throws {
        var farField = false
        if #available(iOS 26.2, *) { farField = true }
        try session.setCategory(category, mode: mode, options: resolvedOptions(farFieldAvailable: farField))
        if prefersEchoCancelledInput, session.isEchoCancelledInputAvailable {
            try? session.setPrefersEchoCancelledInput(true)
        }
        try? Self.preferBluetoothInput(session)
    }

    /// Whether the session still has this config. Options count too: WebRTC's own default
    /// (voiceChat without `.defaultToSpeaker`) has the same category and mode, and plays on
    /// the earpiece. Options a route can't take (far-field, high-quality recording) don't count.
    func isApplied(category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) -> Bool {
        let routing = self.options.intersection([.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP, .duckOthers])
        return category == self.category && mode == self.mode && options.isSuperset(of: routing)
    }

    func isApplied(to session: AudioSessionControl) -> Bool {
        isApplied(category: session.category, mode: session.mode, options: session.categoryOptions)
    }

    /// The car's or headset's mic when one is connected, else the system's choice. Only when it
    /// changes something: setting the same input again is itself a route change, and the
    /// route-change handler calls this.
    static func preferBluetoothInput(_ session: AudioSessionControl) throws {
        guard let preferred = preferredInput(among: session.availableInputPorts),
              session.preferredInputPort != preferred, session.routeInputs.first != preferred else { return }
        try session.setPreferredInput(port: preferred)
    }

    /// Car audio first, then Bluetooth HFP, then a wired headset; nil leaves the built-in mic.
    static func preferredInput(among ports: [AVAudioSession.Port]) -> AVAudioSession.Port? {
        [.carAudio, .bluetoothHFP, .headsetMic].first { ports.contains($0) }
    }
}

/// The audio session as voice and Talk drive it: AVAudioSession in the app, a fake in tests.
protocol AudioSessionControl: AnyObject {
    var category: AVAudioSession.Category { get }
    var mode: AVAudioSession.Mode { get }
    var categoryOptions: AVAudioSession.CategoryOptions { get }
    var isEchoCancelledInputAvailable: Bool { get }
    func setCategory(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions) throws
    func setPrefersEchoCancelledInput(_ value: Bool) throws
    func setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws
    func overrideOutputAudioPort(_ portOverride: AVAudioSession.PortOverride) throws
    var availableInputPorts: [AVAudioSession.Port] { get }
    var preferredInputPort: AVAudioSession.Port? { get }
    func setPreferredInput(port: AVAudioSession.Port) throws
    var routeInputs: [AVAudioSession.Port] { get }
    var routeOutputs: [AVAudioSession.Port] { get }
    /// "MicrophoneBuiltIn (iPhone Microphone)", for the logs.
    var routeInputName: String { get }
    var routeOutputName: String { get }
}

extension AVAudioSession: AudioSessionControl {
    var availableInputPorts: [AVAudioSession.Port] { (availableInputs ?? []).map(\.portType) }
    var preferredInputPort: AVAudioSession.Port? { preferredInput?.portType }
    func setPreferredInput(port: AVAudioSession.Port) throws {
        guard let found = availableInputs?.first(where: { $0.portType == port }) else { return }
        try setPreferredInput(found)
    }
    var routeInputs: [AVAudioSession.Port] { currentRoute.inputs.map(\.portType) }
    var routeOutputs: [AVAudioSession.Port] { currentRoute.outputs.map(\.portType) }
    var routeInputName: String { currentRoute.inputs.map { "\($0.portType.rawValue) (\($0.portName))" }.joined(separator: ", ") }
    var routeOutputName: String { currentRoute.outputs.map { "\($0.portType.rawValue) (\($0.portName))" }.joined(separator: ", ") }
}

/// Where the voice plays: the loudspeaker, unless AirPods, Bluetooth, a wired headset or
/// the car is connected. `.voiceChat` alone plays on the earpiece; `.defaultToSpeaker`
/// avoids that until something (WebRTC's own config, a category set without it) drops it,
/// so the voice checks after every activation and route change.
enum VoiceSpeakerRoute {
    /// Outputs that aren't the phone's own.
    static func isExternal(_ port: AVAudioSession.Port) -> Bool {
        [.headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .carAudio, .usbAudio, .airPlay, .HDMI, .lineOut].contains(port)
    }

    /// Inputs that come with their own speaker or earpiece.
    static func isExternalInput(_ port: AVAudioSession.Port) -> Bool {
        [.bluetoothHFP, .carAudio, .headsetMic, .usbAudio].contains(port)
    }

    /// The override the route wants: the loudspeaker on the phone alone, none otherwise.
    static func wanted(outputs: [AVAudioSession.Port], inputs: [AVAudioSession.Port]) -> AVAudioSession.PortOverride {
        outputs.contains(where: isExternal) || inputs.contains(where: isExternalInput) ? .none : .speaker
    }

    /// The override to set now, or nil for none. Only when it changes something, since setting
    /// one is a route change too: `.speaker` when the voice is on the earpiece, `.none` to clear
    /// ours once a headset, Bluetooth or the car shows up.
    static func change(outputs: [AVAudioSession.Port], inputs: [AVAudioSession.Port], overridden: Bool) -> AVAudioSession.PortOverride? {
        switch wanted(outputs: outputs, inputs: inputs) {
        case .speaker: outputs.contains(.builtInReceiver) ? .speaker : nil
        default: overridden ? AVAudioSession.PortOverride.none : nil
        }
    }
}

/// What a route change means for a session that's talking.
enum VoiceRouteAction: Equatable, Sendable {
    /// Nothing to do.
    case keep
    /// A device came or went (the car, AirPods): pick the input again and carry on.
    case reroute
    /// Someone else changed the category: set ours again.
    case reapply

    static func forReason(_ reason: AVAudioSession.RouteChangeReason) -> VoiceRouteAction {
        switch reason {
        case .newDeviceAvailable, .oldDeviceUnavailable, .override, .routeConfigurationChange, .wakeFromSleep: .reroute
        case .categoryChange: .reapply
        default: .keep
        }
    }

    /// The reason in a word, for the logs Studio keeps.
    static func name(_ reason: AVAudioSession.RouteChangeReason) -> String {
        switch reason {
        case .newDeviceAvailable: "new_device"
        case .oldDeviceUnavailable: "old_device_gone"
        case .categoryChange: "category_change"
        case .override: "override"
        case .wakeFromSleep: "wake_from_sleep"
        case .noSuitableRouteForCategory: "no_suitable_route"
        case .routeConfigurationChange: "route_configuration"
        default: "unknown"
        }
    }
}
