import SwiftUI
import UIKit

/// A bot's MISSION.md or MEMORY.md: read it, or edit and save. A save only
/// lands if nobody (the bot included) changed the file since it was loaded.
struct BotDocumentView: View {
    @EnvironmentObject private var app: AppModel
    let bot: Bot
    let file: String
    @State private var document: BotDocument?
    @State private var text = ""
    @State private var editing = false
    @State private var saving = false
    @State private var conflict = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private static let limit = 64000
    private var title: String { file == "MISSION.md" ? "Mission" : "Memory" }
    private var dirty: Bool { text != document?.text }

    var body: some View {
        Group {
            if editing {
                TextEditor(text: $text)
                    .font(.callout.monospaced())
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .accessibilityIdentifier("botDocumentEditor")
                    .safeAreaInset(edge: .bottom) {
                        if text.count > Self.limit {
                            Text("\(text.count - Self.limit) characters over the limit")
                                .font(.caption)
                                .foregroundStyle(.red)
                                .padding(8)
                        }
                    }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(file == "MISSION.md"
                            ? "The standing direction \(bot.name) reads at the start of every turn."
                            : "Facts and decisions \(bot.name) keeps across conversations. \(bot.name) can update this file too.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if let document {
                            if document.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Text("Empty").foregroundStyle(.secondary)
                            } else {
                                MarkdownText(document.text).textSelection(.enabled)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .refreshable { await load() }
            }
        }
        .overlay { if document == nil, error == nil { ProgressView() } }
        .overlay(alignment: .top) {
            if let error { Text(error).font(.caption).padding(8).background(.red.opacity(0.15), in: .capsule).padding(.horizontal) }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(editing)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            if editing {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        text = document?.text ?? ""
                        editing = false
                        error = nil
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(!dirty || saving || text.count > Self.limit)
                }
            } else if document != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button("Edit") {
                        text = document?.text ?? ""
                        editing = true
                        focused = true
                    }
                }
            }
        }
        .alert("\(file) changed", isPresented: $conflict) {
            Button("Copy My Edits and Reload") {
                UIPasteboard.general.string = text
                editing = false
                Task { await load() }
            }
            Button("Keep Editing", role: .cancel) {}
        } message: {
            Text("It was changed since you opened it, maybe by \(bot.name). Reload to see the latest; your edits go to the clipboard.")
        }
        .task { await load() }
    }

    private func load() async {
        do {
            document = try await app.client.botDocument(bot.id, file: file)
            if !editing { text = document?.text ?? "" }
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func save() async {
        guard let document else { return }
        saving = true
        defer { saving = false }
        do {
            self.document = try await app.client.saveBotDocument(bot.id, file: file, text: text, version: document.version)
            editing = false
            error = nil
        } catch {
            let message = BBClient.describe(error, server: app.client.baseURL)
            if message.contains("document changed") { conflict = true } else { self.error = message }
        }
    }
}
