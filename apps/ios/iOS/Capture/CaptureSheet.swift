import SwiftUI

enum CaptureOption: String, CaseIterable, Identifiable {
    case voice, dictate, note, task, file, thread

    var id: String { rawValue }

    var title: String {
        switch self {
        case .voice: "Record voice"
        case .dictate: "Dictate"
        case .note: "Note"
        case .task: "Task"
        case .file: "Photo or file"
        case .thread: "New thread"
        }
    }

    var symbol: String {
        switch self {
        case .voice: "record.circle"
        case .dictate: "mic.fill"
        case .note: "note.text"
        case .task: "checkmark.circle"
        case .file: "photo.on.rectangle.angled"
        case .thread: "bubble.left.and.text.bubble.right"
        }
    }

    static func ordered(last: CaptureOption?) -> [CaptureOption] {
        guard let last else { return allCases }
        return [last] + allCases.filter { $0 != last }
    }
}

enum CaptureNote {
    static func title(from text: String) -> String {
        let first = text.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let title = first.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? "Untitled" : String(title.prefix(200))
    }
}

struct CaptureSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("captureLastOption") private var lastOption = ""
    @State private var writingNote = false
    @State private var choosingFile = false
    @State private var files: [PendingAttachment] = []
    @State private var destination: Sheet?
    @State private var note = ""
    @State private var saving = false
    @State private var savedPageId: String?
    @State private var savedArtifactId: String?
    @State private var error: String?

    private var ordered: [CaptureOption] { CaptureOption.ordered(last: CaptureOption(rawValue: lastOption)) }

    var body: some View {
        NavigationStack {
            Group {
                if writingNote { noteForm }
                else if choosingFile { fileForm }
                else { options }
            }
            .navigationTitle(writingNote ? "Note" : choosingFile ? "Photo or file" : "Capture to BB")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(writingNote || choosingFile ? "Back" : "Close") {
                        if writingNote { writingNote = false }
                        else if choosingFile { choosingFile = false }
                        else { dismiss() }
                    }
                }
            }
        }
        .presentationDetents([.height(620), .large])
        .sheet(item: $destination) { sheet in
            switch sheet {
            case .recording:
                DictationView(threadId: nil, autoStart: true, kind: "recording")
            case .dictation:
                DictationView(threadId: nil, autoStart: true)
            case .newTasks:
                QuickTaskView()
            default:
                EmptyView()
            }
        }
    }

    private var options: some View {
        ScrollView {
            VStack(spacing: 10) {
                ForEach(ordered) { option in
                    Button { choose(option) } label: {
                        HStack(spacing: 16) {
                            Image(systemName: option.symbol)
                                .font(.title2)
                                .frame(width: 32)
                                .accessibilityHidden(true)
                            Text(option.title).font(.title3.weight(.semibold))
                            Spacer()
                            if option.rawValue == lastOption {
                                Image(systemName: "clock.arrow.circlepath")
                                    .font(.subheadline)
                                    .accessibilityHidden(true)
                            }
                        }
                        .frame(minHeight: 64)
                        .padding(.horizontal, 18)
                        .background(option.rawValue == lastOption ? Color.accentColor.opacity(0.12) : Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("capture-\(option.rawValue)")
                    .accessibilityHint(option.rawValue == lastOption ? "Last used" : "")
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }

    private var noteForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            TextField("Write a note", text: $note, axis: .vertical)
                .lineLimit(5...12)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("captureNoteText")
            Button {
                Task { await saveNote() }
            } label: {
                if saving { ProgressView().frame(maxWidth: .infinity) }
                else { Text("Save note").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
            .accessibilityIdentifier("captureNoteSave")
            if let savedPageId {
                HStack {
                    Label("Saved", systemImage: "checkmark.circle.fill")
                    Spacer()
                    Button("Open") {
                        dismiss()
                        app.openPage(savedPageId)
                    }
                }
                .foregroundStyle(.green)
                .accessibilityIdentifier("captureNoteSaved")
            }
            if let error { Text(error).foregroundStyle(.red) }
            Spacer()
        }
        .padding()
    }

    private var fileForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Choose a photo or file")
                    .font(.headline)
                Spacer()
                AttachmentMenu(items: $files)
                    .accessibilityLabel("Choose a photo or file")
            }
            AttachmentStrip(items: $files)
            Button {
                Task { await saveFiles() }
            } label: {
                if saving { ProgressView().frame(maxWidth: .infinity) }
                else { Text("Save to Studio").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(files.isEmpty || saving)
            .accessibilityIdentifier("captureFileSave")
            if let savedArtifactId {
                HStack {
                    Label("Saved", systemImage: "checkmark.circle.fill")
                    Spacer()
                    Button("Open") {
                        dismiss()
                        app.openStudio(kind: nil, .artifact(id: savedArtifactId))
                    }
                }
                .foregroundStyle(.green)
            }
            if let error { Text(error).foregroundStyle(.red) }
            Spacer()
        }
        .padding()
    }

    private func choose(_ option: CaptureOption) {
        lastOption = option.rawValue
        switch option {
        case .note: writingNote = true
        case .voice: destination = .recording
        case .dictate: destination = .dictation(threadId: nil, autoStart: true)
        case .task: destination = .newTasks
        case .file: choosingFile = true
        case .thread:
            dismiss()
            DispatchQueue.main.async { app.newThread() }
        }
    }

    private func saveNote() async {
        let content = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        saving = true
        defer { saving = false }
        do {
            savedPageId = try await createNote(content)
            note = ""
            error = nil
            Task { await StudioStore.shared.load(app.client) }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    /// Keep the destination in one place for a future Inbox quick-capture API.
    private func createNote(_ text: String) async throws -> String {
        let projects = try await app.client.projects()
        let saved = AppGroup.defaults.string(forKey: "newThreadProjectId")
        let project = projects.first { $0.id == saved }?.id ?? projects.first?.id
        struct Envelope: Decodable { var page: PageMeta }
        let result: Envelope = try await app.client.rpc("pages", "create", [
            "projectId": project.map { .string($0) } ?? .null,
            "parentId": .null,
            "title": .string(CaptureNote.title(from: text)),
            "markdown": .string(String(text.prefix(200_000))),
        ])
        return result.page.id
    }

    private func saveFiles() async {
        guard !files.isEmpty else { return }
        savedArtifactId = nil
        error = nil
        saving = true
        defer { saving = false }
        do {
            let projects = try await app.client.projects()
            let saved = AppGroup.defaults.string(forKey: "newThreadProjectId")
            let project = projects.first { $0.id == saved }?.id ?? projects.first?.id
            for file in files {
                guard file.data.count <= 25 * 1024 * 1024 else {
                    throw BBError(status: 413, message: "\(file.name) is over 25 MB.")
                }
                let result: Artifacts.ImportFileOutput = try await app.client.rpc("artifacts", Artifacts.Method.importFile, [
                    "name": .string(file.name),
                    "mime": .string(file.mimeType),
                    "bytes": .string(file.data.base64EncodedString()),
                    "projectId": project.map { .string($0) } ?? .null,
                ])
                guard let id = result.id else { throw BBError(status: 500, message: "Unexpected artifact response.") }
                savedArtifactId = id
                files.removeAll { $0.id == file.id }
            }
            error = nil
            Task { await StudioStore.shared.load(app.client) }
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
            if savedArtifactId != nil { Task { await StudioStore.shared.load(app.client) } }
        }
    }
}
