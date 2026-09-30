import SwiftUI

/// Records into Talk and hands back the transcript. With `onInsert` the text
/// goes into the caller's composer; otherwise it can be sent, turned into a
/// thread, or copied. The recording stays in Talk either way.
struct DictationView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var recorder = TalkRecorder(client: AppModel.shared.client)
    @ObservedObject private var outbox = TalkOutbox.shared
    let threadId: String?
    let autoStart: Bool
    var kind = "dictation"
    var onInsert: ((String) -> Void)?

    @State private var text = ""
    @State private var creatingThread = false

    init(threadId: String?, autoStart: Bool, kind: String = "dictation", onInsert: ((String) -> Void)? = nil) {
        self.threadId = threadId
        self.autoStart = autoStart
        self.kind = kind
        self.onInsert = onInsert
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                switch recorder.phase {
                case .idle:
                    Spacer()
                    recordButton
                    Spacer()
                case .recording:
                    Spacer()
                    if let startedAt = recorder.startedAt {
                        Text(startedAt, style: .timer).font(.system(size: 48, weight: .light).monospacedDigit())
                    }
                    LevelMeter(level: recorder.level).frame(height: 60)
                    if outbox.pending > 0 { Text("\(outbox.pending) segment(s) uploading").font(.caption) }
                    Spacer()
                    HStack(spacing: 40) {
                        Button(role: .cancel) {
                            recorder.cancel()
                            dismiss()
                        } label: { circle("xmark", .gray) }
                        Button { Task { text = await recorder.finish() ?? "" } } label: { circle("checkmark", .green) }
                    }
                case .finishing:
                    Spacer()
                    ProgressView("Transcribing…")
                    if !recorder.transcript.isEmpty { Text(recorder.transcript).foregroundStyle(.secondary) }
                    Spacer()
                case .done:
                    TextEditor(text: $text)
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .background(.fill.tertiary, in: .rect(cornerRadius: 12))
                    actions
                case .failed(let message):
                    Spacer()
                    Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    recordButton
                    Spacer()
                }
            }
            .padding()
            .navigationTitle(kind == "recording" ? "Recording" : "Dictation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        recorder.cancel()
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $creatingThread) { NewThreadView(text: text) }
        }
        .interactiveDismissDisabled(recorder.phase == .recording)
        .task {
            if autoStart { await recorder.start(kind: kind, threadId: threadId) }
        }
    }

    private var recordButton: some View {
        Button { Task { await recorder.start(kind: kind, threadId: threadId) } } label: { circle("mic.fill", .red) }
    }

    @ViewBuilder
    private var actions: some View {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        VStack(spacing: 12) {
            if let onInsert {
                Button {
                    onInsert(trimmed)
                    dismiss()
                } label: { wide("Insert", "text.insert") }
                .buttonStyle(.borderedProminent)
            } else if let threadId {
                Button {
                    Task {
                        _ = try? await app.client.send(threadId, text: trimmed)
                        dismiss()
                    }
                } label: { wide("Send to thread", "paperplane.fill") }
                .buttonStyle(.borderedProminent)
            }
            HStack {
                Button { creatingThread = true } label: { wide("New thread", "square.and.pencil") }
                Button {
                    UIPasteboard.general.string = trimmed
                    dismiss()
                } label: { wide("Copy", "doc.on.doc") }
            }
            .buttonStyle(.bordered)
        }
        .disabled(trimmed.isEmpty)
    }

    private func circle(_ symbol: String, _ color: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 32, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 84, height: 84)
            .background(color, in: .circle)
    }

    private func wide(_ title: String, _ symbol: String) -> some View {
        Label(title, systemImage: symbol).frame(maxWidth: .infinity)
    }
}

struct LevelMeter: View {
    let level: Float
    @State private var history: [Float] = Array(repeating: 0, count: 40)

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(Array(history.enumerated()), id: \.offset) { _, value in
                Capsule()
                    .fill(.red.opacity(0.8))
                    .frame(width: 4, height: max(4, CGFloat(value) * 60))
            }
        }
        .onChange(of: level) { _, value in
            history.removeFirst()
            history.append(value)
        }
    }
}
