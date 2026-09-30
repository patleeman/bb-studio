import SwiftUI

/// Which reply's files to offer: the one ending at `seq`, or the latest.
struct SaveToStudioRequest: Identifiable, Hashable {
    var threadId: String
    var seq: Int?
    var id: String { "\(threadId):\(seq ?? -1)" }
}

/// Picks files a reply produced, or from thread storage, and saves them to Studio as artifacts.
struct SaveToStudioSheet: View {
    let request: SaveToStudioRequest
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var candidates: ArtifactCandidates?
    @State private var saved: [Artifact] = []
    @State private var selected: Set<String> = []
    @State private var error: String?
    @State private var saving = false
    @State private var result: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                if let result { Label(result, systemImage: "checkmark.circle").foregroundStyle(.green) }
                if let candidates {
                    fileSection(request.seq == nil ? "Latest reply" : "This reply", candidates.reply)
                    fileSection("Thread storage", candidates.storage)
                    if let storageError = candidates.storageError {
                        Text("Can't read thread storage: \(storageError.replacingOccurrences(of: #"^HTTP \d+: "#, with: "", options: .regularExpression))")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if candidates.reply.isEmpty && candidates.storage.isEmpty {
                        Text("This reply didn't create or change any files that Studio can read.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity)
                }
                if !saved.isEmpty {
                    Section("In Studio from this thread") {
                        ForEach(saved) { artifact in
                            Button {
                                dismiss()
                                app.push(.artifact(id: artifact.id))
                            } label: {
                                Label(artifact.displayTitle, systemImage: artifact.version.symbol)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Save to Studio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(selected.count > 1 ? "Save \(selected.count)" : "Save") { Task { await save() } }
                        .disabled(selected.isEmpty || saving)
                }
            }
            .task { await load() }
        }
    }

    @ViewBuilder
    private func fileSection(_ title: String, _ files: [ArtifactCandidates.File]) -> some View {
        if !files.isEmpty {
            Section(title) {
                ForEach(files) { file in
                    Button {
                        if selected.contains(file.path) { selected.remove(file.path) } else { selected.insert(file.path) }
                    } label: {
                        HStack {
                            Image(systemName: selected.contains(file.path) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(selected.contains(file.path) ? Color.accentColor : .secondary)
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(file.display).foregroundStyle(.primary).lineLimit(2)
                                    if file.artifactId != nil {
                                        Text("In Studio; saving adds a version").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            } icon: {
                                Image(systemName: file.symbol).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .accessibilityIdentifier("saveCandidate")
                }
            }
        }
    }

    private func load() async {
        do {
            async let candidates = app.client.artifactCandidates(threadId: request.threadId, seq: request.seq)
            async let saved = app.client.threadArtifacts(request.threadId)
            let loaded = try await candidates
            self.candidates = loaded
            // A reply's new files are what you most likely want.
            selected = Set(loaded.reply.filter { $0.artifactId == nil }.map(\.path))
            self.saved = (try? await saved) ?? []
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let result = try await app.client.saveFilesToStudio(threadId: request.threadId, paths: Array(selected))
            let created = result.saved.filter { $0.outcome == "created" }.count
            let versioned = result.saved.filter { $0.outcome == "versioned" }.count
            var parts: [String] = []
            if created > 0 { parts.append("\(created) saved") }
            if versioned > 0 { parts.append("\(versioned) updated") }
            if result.saved.count - created - versioned > 0 { parts.append("\(result.saved.count - created - versioned) unchanged") }
            self.result = parts.isEmpty ? nil : parts.joined(separator: ", ")
            error = result.failed.first.map { "\(($0.path as NSString).lastPathComponent): \($0.error)" }
            selected = []
            await load()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
