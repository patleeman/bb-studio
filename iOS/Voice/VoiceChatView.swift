import SwiftUI

struct VoiceChatView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var engine: VoiceChatEngine

    init(threadId: String) {
        _engine = StateObject(
            wrappedValue: VoiceChatEngine(
                threadId: threadId, client: AppModel.shared.client, realtime: AppModel.shared.realtime))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(engine.turns) { turn in
                                Text(turn.fromUser ? turn.text : VoiceChatEngine.speakable(turn.text))
                                    .foregroundStyle(turn.fromUser ? .primary : .secondary)
                                    .frame(maxWidth: .infinity, alignment: turn.fromUser ? .trailing : .leading)
                                    .id(turn.id)
                            }
                            if engine.state == .listening, !engine.partial.isEmpty {
                                Text(engine.partial)
                                    .italic()
                                    .frame(maxWidth: .infinity, alignment: .trailing)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: engine.turns.count) {
                        if let last = engine.turns.last { withAnimation { proxy.scrollTo(last.id) } }
                    }
                }

                Button { engine.tap() } label: { orb }
                    .buttonStyle(.plain)
                Text(caption).font(.footnote).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal)
                if engine.needsSettings, let url = URL(string: UIApplication.openSettingsURLString) {
                    Link("Open Settings", destination: url).font(.footnote.weight(.semibold))
                }
                if let input = engine.silentInput, engine.state == .listening {
                    Label("No sound from \(input)", systemImage: "mic.slash")
                        .font(.footnote).foregroundStyle(.orange)
                }

                HStack(spacing: 40) {
                    Button { engine.togglePause() } label: {
                        Label(engine.paused ? "Resume" : "Pause", systemImage: engine.paused ? "play.fill" : "pause.fill")
                    }
                    Button(role: .destructive) {
                        engine.end()
                        dismiss()
                    } label: { Label("End", systemImage: "xmark") }
                }
                .padding(.bottom)
            }
            .navigationTitle(engine.threadTitle)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await engine.start() }
        .onDisappear { engine.end() }
    }

    private var orb: some View {
        Circle()
            .fill(color.gradient)
            .frame(width: 120, height: 120)
            .overlay {
                Image(systemName: symbol).font(.system(size: 40, weight: .semibold)).foregroundStyle(.white)
            }
            .symbolEffect(.pulse, isActive: engine.state == .waiting || engine.state == .speaking)
    }

    private var color: Color {
        switch engine.state {
        case .listening: .red
        case .sending, .waiting: .orange
        case .speaking: .blue
        case .idle: .gray
        case .failed: .gray
        }
    }

    private var symbol: String {
        switch engine.state {
        case .listening: "mic.fill"
        case .sending, .waiting: "ellipsis"
        case .speaking: "speaker.wave.2.fill"
        case .idle, .failed: "mic.slash.fill"
        }
    }

    private var caption: String {
        switch engine.state {
        case .listening: "Listening — pause to send, tap to send now"
        case .sending: "Sending…"
        case .waiting: "Waiting for the thread…"
        case .speaking: "Talk or tap to interrupt"
        case .idle: engine.paused ? "Paused" : "Tap to talk"
        case .failed(let message): message
        }
    }
}
