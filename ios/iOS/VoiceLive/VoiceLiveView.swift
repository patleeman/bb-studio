import SwiftUI

/// Hands-free voice: a talking icon that moves while either side speaks, the
/// words streaming under it like subtitles (not chat bubbles), and one big
/// button to start and end. The whole transcript is in the voice thread.
struct VoiceLiveView: View {
    @StateObject private var controller: VoiceLiveController
    @Environment(\.dismiss) private var dismiss
    /// Talk to Bot: start as soon as the sheet shows, with no tap on Start.
    private let autoStart: Bool

    init(controller: @autoclosure @escaping () -> VoiceLiveController, autoStart: Bool = false) {
        _controller = StateObject(wrappedValue: controller())
        self.autoStart = autoStart
    }

    var body: some View {
        VStack(spacing: 0) {
            VoiceLiveHeader(model: controller.model, costUsd: controller.costUsd, route: controller.route, identity: controller.identity, live: controller.isLive) {
                if controller.isLive { controller.stop() }
                dismiss()
            }
            Spacer(minLength: 12)
            TalkingIcon(speaker: controller.machine.speaking, phase: controller.phase)
                .frame(width: 168, height: 168)
            VoiceLiveStatus(phase: controller.phase)
                .padding(.top, 18)
            SubtitleView(subtitle: controller.machine.subtitle)
                .padding(.top, 14)
                .padding(.horizontal, 28)
            RelayLine(card: controller.machine.card)
            Spacer(minLength: 12)
            VoiceLiveCards(confirmation: controller.machine.confirmation, card: controller.machine.card)
                .padding(.horizontal, 20)
            StartEndButton(live: controller.isLive, connecting: controller.phase == .connecting) {
                controller.isLive ? controller.stop() : controller.start()
            }
            .padding(.vertical, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(VoiceLiveBackground(speaker: controller.machine.speaking))
        .interactiveDismissDisabled(controller.isLive)
        .onAppear { if autoStart, controller.phase == .idle { controller.start() } }
        .onDisappear { if controller.isLive { controller.stop(reason: .dismissed) } }
    }
}

private struct VoiceLiveHeader: View {
    let model: String
    let costUsd: Double?
    let route: String
    /// Who the session speaks as: "Chief of Staff" or the thread's title, like the desktop pill.
    let identity: VoiceLiveIdentity?
    let live: Bool
    let close: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("Hands-free").font(.headline).layoutPriority(1)
                    if let label = identity?.label, !label.isEmpty {
                        Text(label)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.tint)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .accessibilityLabel("Talking with \(identity?.name ?? label)")
                            .accessibilityIdentifier("voiceLive.identity")
                    }
                }
                Text(detail).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer()
            Button(action: close) {
                Image(systemName: "xmark").font(.body.weight(.semibold)).frame(width: 36, height: 36)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.circle)
            .accessibilityLabel(live ? "End and close" : "Close")
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    private var detail: String {
        var parts = [model]
        if let costUsd { parts.append(costUsd > 0 && costUsd < 0.01 ? "<$0.01" : String(format: "$%.2f", costUsd)) }
        if !route.isEmpty { parts.append(route) }
        return parts.joined(separator: " · ")
    }
}

/// Rings and bars that move while someone talks: teal for you, the accent for the voice.
struct TalkingIcon: View {
    let speaker: LiveSpeaker?
    let phase: LivePhase

    private var tint: Color {
        switch speaker {
        case .user: .teal
        case .agent: .accentColor
        case nil: phase == .thinking ? .purple : .secondary
        }
    }

    var body: some View {
        TimelineView(.animation(paused: speaker == nil && phase != .thinking)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            ZStack {
                IconRings(time: time, active: speaker != nil, tint: tint)
                Circle().fill(tint.gradient).frame(width: 104, height: 104)
                    .scaleEffect(phase == .thinking ? 1 + 0.04 * sin(time * 3) : 1)
                IconBars(time: time, active: speaker != nil)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(speaker == .user ? "You're talking" : speaker == .agent ? "The voice is talking" : "Quiet")
    }
}

private struct IconRings: View {
    let time: TimeInterval
    let active: Bool
    let tint: Color

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { ring in
                let phase = (time * 0.8 + Double(ring) / 3).truncatingRemainder(dividingBy: 1)
                Circle()
                    .stroke(tint.opacity(active ? 0.5 * (1 - phase) : 0.12), lineWidth: 3)
                    .scaleEffect(active ? 0.62 + 0.38 * phase : 0.7 + 0.1 * Double(ring))
            }
        }
    }
}

private struct IconBars: View {
    let time: TimeInterval
    let active: Bool

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<5, id: \.self) { bar in
                let wave = active ? (sin(time * 9 + Double(bar) * 1.3) + 1) / 2 : 0
                Capsule().fill(.white).frame(width: 7, height: 12 + 34 * wave * (bar == 2 ? 1 : 0.75))
            }
        }
        .frame(height: 48)
    }
}

private struct VoiceLiveStatus: View {
    let phase: LivePhase

    var body: some View {
        Text(label).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
    }

    private var label: String {
        switch phase {
        case .idle: "Tap Start, then just talk"
        case .connecting: "Connecting…"
        case .listening: "Listening"
        case .userSpeaking: "You"
        case .thinking: "Thinking…"
        case .agentSpeaking: "Voice"
        case .paused(let why): why
        case .ended(let why): why ?? "Ended"
        case .failed(let why): why
        }
    }
}

/// The current line, streaming. Long lines keep their newest words in view.
private struct SubtitleView: View {
    let subtitle: LiveSubtitle?

    var body: some View {
        Text(text)
            .font(.title2.weight(subtitle?.speaker == .user ? .regular : .medium))
            .foregroundStyle(subtitle?.speaker == .user ? .secondary : .primary)
            .multilineTextAlignment(.center)
            .lineLimit(4)
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .top)
            .animation(.easeOut(duration: 0.15), value: subtitle)
            .accessibilityLabel(subtitle.map { "\($0.speaker == .user ? "You" : "Voice"): \($0.text)" } ?? "")
    }

    /// The last ~160 characters, from a word boundary.
    private var text: String {
        guard let words = subtitle?.text, words.count > 160 else { return subtitle?.text ?? "" }
        let tail = words.suffix(160)
        return "…" + (tail.drop { $0 != " " })
    }
}

private struct VoiceLiveCards: View {
    let confirmation: String?
    let card: LiveToolCard?

    var body: some View {
        VStack(spacing: 10) {
            if let confirmation { ConfirmCard(readBack: confirmation).transition(.move(edge: .bottom).combined(with: .opacity)) }
            // A relay's "Sent to …" is a line under the subtitles (RelayLine), not a card.
            if let card, card.kind != .sent { ToolCardView(card: card).transition(.opacity) }
        }
        .animation(.snappy, value: confirmation)
        .animation(.snappy, value: card)
    }
}

/// Relays go at once: "✓ Sent to the Larkspur lead" under the subtitles.
private struct RelayLine: View {
    let card: LiveToolCard?

    var body: some View {
        Group {
            if let card, card.kind == .sent {
                Label(card.title, systemImage: "checkmark")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                    .transition(.opacity)
            }
        }
        .padding(.top, 6)
        .animation(.snappy, value: card)
    }
}

/// Only for what's destructive or hard to undo: the question, and how to answer.
private struct ConfirmCard: View {
    let readBack: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Waiting for your yes", systemImage: "exclamationmark.triangle")
                .font(.caption.weight(.semibold)).foregroundStyle(.tint)
            Text(readBack).font(.body.weight(.medium))
            Text("Say “yes”, or “no”.").font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.tint.opacity(0.12), in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(.tint.opacity(0.35), lineWidth: 1))
    }
}

private struct ToolCardView: View {
    let card: LiveToolCard

    private var icon: String {
        switch card.kind {
        case .waiting: "tray.full"
        case .sent: "checkmark.circle.fill"
        case .loop: "arrow.uturn.backward.circle"
        case .reply: "text.bubble"
        case .notice: "info.circle"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(card.kind == .sent ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.title).font(.subheadline.weight(.semibold))
                if !card.detail.isEmpty { Text(card.detail).font(.footnote).foregroundStyle(.secondary).lineLimit(3) }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(.regularMaterial, in: .rect(cornerRadius: 16))
    }
}

private struct StartEndButton: View {
    let live: Bool
    let connecting: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: live ? "phone.down.fill" : "mic.fill").font(.system(size: 30, weight: .semibold))
                Text(live ? "End" : "Start").font(.footnote.weight(.semibold))
            }
            .foregroundStyle(.white)
            .frame(width: 96, height: 96)
            .background(live ? Color.red : Color.accentColor, in: .circle)
        }
        .buttonStyle(.plain)
        .disabled(connecting)
        .opacity(connecting ? 0.6 : 1)
        .accessibilityLabel(live ? "End hands-free" : "Start hands-free")
    }
}

private struct VoiceLiveBackground: View {
    let speaker: LiveSpeaker?

    var body: some View {
        LinearGradient(colors: [tint.opacity(0.10), Color(.systemBackground)], startPoint: .top, endPoint: .center)
            .ignoresSafeArea()
            .animation(.easeInOut(duration: 0.3), value: speaker)
    }

    private var tint: Color {
        switch speaker {
        case .user: .teal
        case .agent: .accentColor
        case nil: .clear
        }
    }
}
