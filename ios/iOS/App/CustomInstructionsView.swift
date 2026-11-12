import SwiftUI

/// The custom-instructions plugin's one setting: text BB adds to every
/// agent's system prompt.
struct CustomInstructionsView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var saved = ""
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool
    static let limit = 4096

    var body: some View {
        Form {
            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(.red) }
            }
            Section {
                TextField("Always write tests first…", text: $text, axis: .vertical)
                    .lineLimit(8...)
                    .focused($focused)
                    .disabled(!loaded)
                    .accessibilityIdentifier("customInstructions.text")
            } footer: {
                HStack {
                    Text("Added to every agent's system prompt, in new turns on every thread.")
                    Spacer()
                    Text("\(text.count)/\(Self.limit)")
                        .monospacedDigit()
                        .foregroundStyle(text.count > Self.limit ? .red : .secondary)
                }
            }
        }
        .overlay { if !loaded, error == nil { ProgressView() } }
        .navigationTitle("Custom Instructions")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if saving {
                    ProgressView()
                } else {
                    Button("Save") { Task { await save() } }
                        .disabled(!loaded || text == saved || text.count > Self.limit)
                }
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = false }
            }
        }
        .task {
            do {
                text = try await client.customInstructions()
                saved = text
                loaded = true
            } catch {
                self.error = BBClient.describe(error, server: client.baseURL)
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await client.setCustomInstructions(text)
            saved = text
            error = nil
            operation.complete(on: app) { dismiss() }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}
