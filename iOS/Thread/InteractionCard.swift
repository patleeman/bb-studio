import SwiftUI

/// Answers a pending approval, question, or secret request in place. Other
/// plugin forms fall back to the web app.
struct InteractionCard: View {
    let interaction: PendingInteraction
    let resolve: (JSONValue) async -> Bool
    var cancel: () async -> Void = {}
    let openWeb: () -> Void

    @State private var answers: [String: InteractionAnswer] = [:]
    @State private var working = false
    @State private var showingPlan = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(header, systemImage: "hand.raised.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.orange)
            switch interaction.payload.kind {
            case "approval": approval
            case "user_question": questions
            case "plugin" where interaction.pluginQuestions != nil:
                if let title = interaction.payload.title { Text(title).font(.subheadline.weight(.semibold)) }
                questions
                Button("Skip", role: .cancel) { decline() }.font(.footnote)
            case "plugin" where interaction.secretRequest != nil:
                if let request = interaction.secretRequest {
                    SecretRequestForm(request: request, submit: submit, decline: decline)
                }
            default:
                Text(interaction.summary).font(.subheadline)
                Button("Open in web", action: openWeb).buttonStyle(.bordered)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.12), in: .rect(cornerRadius: 14))
        .disabled(working)
        .overlay { if working { ProgressView() } }
        .sheet(isPresented: $showingPlan) {
            NavigationStack {
                ScrollView { MarkdownText(interaction.payload.subject?.plan ?? "").padding() }
                    .navigationTitle("Plan")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { showingPlan = false } }
            }
        }
    }

    private var header: String {
        if interaction.secretRequest != nil { return "An agent needs credentials" }
        return interaction.allQuestions != nil ? "BB has a question" : "Waiting for your approval"
    }

    // MARK: Approval

    @ViewBuilder private var approval: some View {
        let subject = interaction.payload.subject
        switch subject?.kind {
        case "command":
            Text(subject?.command ?? "")
                .font(.caption.monospaced())
                .lineLimit(8)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.fill.tertiary, in: .rect(cornerRadius: 8))
            if let cwd = subject?.cwd { Text(cwd).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
        case "plan":
            Text(subject?.plan ?? "").font(.subheadline).lineLimit(6)
            Button("Read the full plan") { showingPlan = true }.font(.footnote)
        default:
            Text(interaction.summary).font(.subheadline)
        }
        if let reason = interaction.payload.reason, !reason.isEmpty {
            Text(reason).font(.footnote).foregroundStyle(.secondary)
        }
        HStack {
            ForEach(interaction.decisions, id: \.self) { decision in
                Button(approvalLabel(decision, subjectKind: subject?.kind)) {
                    submit(interaction.approvalResolution(decision))
                }
                .buttonStyle(.borderedProminent)
                .tint(decision == "deny" ? .red : decision == "allow_once" ? .green : .blue)
            }
        }
        .controlSize(.small)
    }

    // MARK: Questions

    @ViewBuilder private var questions: some View {
        let questions = interaction.allQuestions ?? []
        ForEach(questions) { question in
            VStack(alignment: .leading, spacing: 6) {
                Text(question.prompt).font(.subheadline.weight(.medium))
                ForEach(question.options ?? [], id: \.value) { option in
                    let selected = answers[question.id]?.selected.contains(option.value) == true
                    Button { toggle(option.value, in: question) } label: {
                        HStack(alignment: .top) {
                            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            VStack(alignment: .leading) {
                                Text(option.label)
                                if let description = option.description {
                                    Text(description).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
                if question.allowFreeText {
                    TextField(
                        question.options?.isEmpty == false ? "Or type an answer" : "Your answer",
                        text: binding(question.id), axis: .vertical
                    )
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                }
            }
        }
        Button("Send answer") { submit(interaction.answer(answers)) }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(questions.contains { answers[$0.id]?.isEmpty ?? true })
    }

    private func toggle(_ value: String, in question: InteractionQuestion) {
        var answer = answers[question.id] ?? InteractionAnswer()
        if answer.selected.contains(value) {
            answer.selected.removeAll { $0 == value }
        } else if question.multiSelect {
            if answer.selected.count < 4 { answer.selected.append(value) }
        } else {
            answer.selected = [value]
        }
        answers[question.id] = answer
    }

    private func binding(_ id: String) -> Binding<String> {
        Binding(
            get: { answers[id]?.freeText ?? "" },
            set: { answers[id, default: InteractionAnswer()].freeText = $0 })
    }

    private func decline() {
        working = true
        Task {
            await cancel()
            working = false
        }
    }

    private func submit(_ resolution: JSONValue) {
        working = true
        Task {
            _ = await resolve(resolution)
            working = false
        }
    }
}

/// Masked fields for the secrets plugin. Values go straight to BB, which
/// writes them to the named dotenv file; nothing is kept on the phone.
private struct SecretRequestForm: View {
    let request: SecretRequest
    let submit: (JSONValue) -> Void
    let decline: () -> Void
    @State private var values: [String: String] = [:]
    @State private var revealed: Set<String> = []

    var body: some View {
        if let purpose = request.purpose { Text(purpose).font(.subheadline) }
        Label(request.destination.path, systemImage: "doc.badge.gearshape")
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.head)
        ForEach(request.fields, id: \.name) { field in
            VStack(alignment: .leading, spacing: 4) {
                Text(field.name).font(.caption.monospaced().weight(.semibold))
                if let description = field.description {
                    Text(description).font(.caption).foregroundStyle(.secondary)
                }
                HStack {
                    Group {
                        if revealed.contains(field.name) {
                            TextField("Value", text: binding(field.name))
                        } else {
                            SecureField("Value", text: binding(field.name))
                        }
                    }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.password)
                    .textFieldStyle(.roundedBorder)
                    Button {
                        if revealed.contains(field.name) { revealed.remove(field.name) } else { revealed.insert(field.name) }
                    } label: {
                        Image(systemName: revealed.contains(field.name) ? "eye.slash" : "eye")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(revealed.contains(field.name) ? "Hide value" : "Show value")
                }
            }
        }
        HStack {
            Button("Save") {
                let trimmed = values.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                submit(["values": .object(trimmed.mapValues(JSONValue.string))])
                values = [:]
            }
            .buttonStyle(.borderedProminent)
            .disabled(!complete)
            Button("Decline", role: .destructive, action: decline)
                .buttonStyle(.bordered)
        }
        .controlSize(.small)
    }

    /// Every field, single-line, as the plugin requires.
    private var complete: Bool {
        request.fields.allSatisfy { field in
            let value = values[field.name]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return !value.isEmpty && !value.contains(where: \.isNewline)
        }
    }

    private func binding(_ name: String) -> Binding<String> {
        Binding(get: { values[name] ?? "" }, set: { values[name] = $0 })
    }
}
