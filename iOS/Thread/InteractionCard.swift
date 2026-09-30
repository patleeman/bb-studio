import SwiftUI

/// Answers a pending approval or question in place. Plugin forms fall back to the web app.
struct InteractionCard: View {
    let interaction: PendingInteraction
    let resolve: (JSONValue) async -> Bool
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
        interaction.payload.kind == "user_question" ? "BB has a question" : "Waiting for your approval"
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
        let questions = interaction.payload.questions ?? []
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
        Button("Send answer") { submit(PendingInteraction.answerResolution(answers)) }
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

    private func submit(_ resolution: JSONValue) {
        working = true
        Task {
            _ = await resolve(resolution)
            working = false
        }
    }
}
