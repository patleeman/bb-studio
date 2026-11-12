import SwiftUI

/// Answers a pending approval, question, design brief, or secret request in place. Other
/// plugin forms fall back to the web app.
struct InteractionCard: View {
    let interaction: PendingInteraction
    let resolve: (JSONValue) async -> Bool
    var cancel: () async -> Void = {}
    let openWeb: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

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
            case "plugin" where interaction.designQuestions != nil:
                if let form = interaction.designQuestions {
                    DesignQuestionsForm(form: form, submit: submit, decline: decline)
                }
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
        if interaction.designQuestions != nil { return "Before designing" }
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
        approvalActionLayout {
            ForEach(interaction.decisions, id: \.self) { decision in
                Button {
                    submit(interaction.approvalResolution(decision))
                } label: {
                    Text(approvalLabel(decision, subjectKind: subject?.kind))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(minWidth: 44,
                               maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil,
                               minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderedProminent)
                .tint(.accentColor)
                .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
            }
        }
        .controlSize(.small)
    }

    private var approvalActionLayout: AnyLayout {
        if dynamicTypeSize.isAccessibilitySize {
            return AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
        }
        return AnyLayout(HStackLayout())
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

/// Studio Design's questions before a design: picks, toggles, a short answer
/// or a 1–5 scale, each with Decide for Me. Unanswered questions go to the
/// agent to decide, as on the web.
private struct DesignQuestionsForm: View {
    let form: DesignQuestionForm
    let submit: (JSONValue) -> Void
    let decline: () -> Void
    @State private var answers: [String: JSONValue] = [:]
    @State private var others: [String: String] = [:]

    var body: some View {
        Text(form.title ?? "A few questions").font(.subheadline.weight(.semibold))
        if let intro = form.intro, !intro.isEmpty { Text(intro).font(.footnote).foregroundStyle(.secondary) }
        ForEach(Array(form.questions.enumerated()), id: \.element.id) { index, question in
            VStack(alignment: .leading, spacing: 6) {
                Text("\(index + 1). \(question.question)").font(.subheadline.weight(.medium))
                if let help = question.help, !help.isEmpty { Text(help).font(.caption).foregroundStyle(.secondary) }
                field(question)
            }
            .padding(.top, 4)
        }
        HStack {
            Button("Send Answers") { submit(final()) }
                .buttonStyle(.borderedProminent)
            Button("Skip All") { submit(form.allDecided) }
                .buttonStyle(.bordered)
            Spacer()
            Button("Close", role: .cancel, action: decline).font(.footnote)
        }
        .controlSize(.small)
    }

    @ViewBuilder
    private func field(_ question: DesignQuestionForm.Question) -> some View {
        switch question.kind {
        case "choice", "multi":
            let labels = (question.options ?? []).map(\.label) + (question.other == true ? ["Other"] : [])
            ForEach(labels, id: \.self) { label in
                let picked = isPicked(label, in: question)
                Button { pick(label, in: question) } label: {
                    HStack(alignment: .top) {
                        Image(systemName: question.kind == "multi"
                            ? (picked ? "checkmark.square.fill" : "square")
                            : (picked ? "checkmark.circle.fill" : "circle"))
                        VStack(alignment: .leading) {
                            Text(label)
                            if let description = question.options?.first(where: { $0.label == label })?.description {
                                Text(description).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(picked ? .isSelected : [])
            }
            if isPicked("Other", in: question) {
                TextField("Your answer", text: Binding(get: { others[question.id] ?? "" }, set: { others[question.id] = $0 }))
                    .textFieldStyle(.roundedBorder)
            }
            decideButton(question)
        case "text":
            TextField(question.placeholder ?? "Your answer", text: Binding(
                get: { if case .string(let text) = answers[question.id] { text } else { "" } },
                set: { answers[question.id] = $0.isEmpty ? nil : .string($0) }), axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.roundedBorder)
            decideButton(question)
        case "scale":
            HStack(spacing: 6) {
                ForEach(1...5, id: \.self) { value in
                    let picked = answers[question.id] == .number(Double(value))
                    Button { answers[question.id] = picked ? nil : .number(Double(value)) } label: {
                        Text("\(value)").frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.bordered)
                    .tint(picked ? .accentColor : .secondary)
                    .accessibilityAddTraits(picked ? .isSelected : [])
                }
            }
            HStack {
                Text(question.minLabel ?? "")
                Spacer()
                Text(question.maxLabel ?? "")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            decideButton(question)
        default:
            EmptyView()
        }
    }

    private func decideButton(_ question: DesignQuestionForm.Question) -> some View {
        let decided = answers[question.id] == DesignQuestionForm.decide
        return Button {
            answers[question.id] = decided ? nil : DesignQuestionForm.decide
        } label: {
            Label("Decide for Me", systemImage: decided ? "checkmark.circle.fill" : "sparkles")
        }
        .font(.caption)
        .buttonStyle(.borderless)
        .accessibilityAddTraits(decided ? .isSelected : [])
    }

    private func isPicked(_ label: String, in question: DesignQuestionForm.Question) -> Bool {
        switch answers[question.id] {
        case .string(let picked): picked == label
        case .array(let picked): picked.contains(.string(label))
        default: false
        }
    }

    private func pick(_ label: String, in question: DesignQuestionForm.Question) {
        let picked = isPicked(label, in: question)
        if question.kind == "choice" {
            answers[question.id] = picked ? nil : .string(label)
            return
        }
        var current: [JSONValue] = if case .array(let list) = answers[question.id] { list } else { [] }
        if picked { current.removeAll { $0 == .string(label) } } else if current.count < 8 { current.append(.string(label)) }
        answers[question.id] = .array(current)
    }

    /// Unanswered questions, and Other picks, resolved to what the agent should get.
    private func final() -> JSONValue {
        var out: [String: JSONValue] = [:]
        for question in form.questions {
            let other = others[question.id]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            var answer = answers[question.id]
            if case .array(let list) = answer {
                answer = .array(list.map { $0 == .string("Other") ? .string(other.isEmpty ? "Other" : other) : $0 })
            }
            if answer == .string("Other") { answer = other.isEmpty ? nil : .string(other) }
            if case .string(let text) = answer, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { answer = nil }
            out[question.id] = answer ?? DesignQuestionForm.decide
        }
        return .object(out)
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
