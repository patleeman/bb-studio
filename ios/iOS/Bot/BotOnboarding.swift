import SwiftUI

/// Before there is a Bot (and the Bots list's +): a welcome with one question,
/// what it should help with, as on desktop. Create makes it with that as its
/// setup (`bot_create`'s `setup`); its chat then opens, where it introduces
/// itself, asks a couple of questions and picks its own name and look.
struct BotOnboardingView: View {
    var first = true
    var create: (String) async throws -> Void
    @State private var goal = ""
    @State private var creating = false
    @State private var error: String?
    @State private var appeared = false
    @State private var creates = 0
    @FocusState private var focused: Bool

    private var look: BotLook { BotSetup.look(first: first) }
    private var tint: Color { BotPalette.color(look.color) }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                BotAvatar(look, size: 88, working: creating)
                    .shadow(color: tint.opacity(0.35), radius: 22, y: 10)
                    .scaleEffect(appeared ? 1 : 0.9)
                    .opacity(appeared ? 1 : 0)
                    .padding(.bottom, 20)
                Text(first ? "Meet your Bot" : "Make another Bot")
                    .font(.title.weight(.bold))
                    .multilineTextAlignment(.center)
                Text(first
                     ? "An always-on agent with its own chat. It sees every project, checks in on a schedule and tells you what needs you."
                     : "Each Bot has its own chat, memory, skills and check-ins, and sees every project.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
                    .padding(.horizontal, 12)

                VStack(alignment: .leading, spacing: 10) {
                    Text("What should your Bot help with?")
                        .font(.subheadline.weight(.semibold))
                        .padding(.leading, 4)
                    TextField("e.g. Keep an eye on my projects and tell me each morning what needs me.", text: $goal, axis: .vertical)
                        .lineLimit(3...6)
                        .focused($focused)
                        .disabled(creating)
                        .padding(14)
                        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 18, style: .continuous))
                        .accessibilityLabel("What should your Bot help with?")
                    FlowLayout(spacing: 8) {
                        ForEach(BotSetup.ideas, id: \.self) { idea in
                            let picked = goal == idea.text
                            Button { goal = idea.text } label: {
                                Text(idea.label)
                                    .font(.subheadline)
                                    .foregroundStyle(picked ? tint : .primary)
                                    .padding(.horizontal, 12).padding(.vertical, 7)
                                    .background(picked ? tint.opacity(0.12) : Color.clear, in: .capsule)
                                    .overlay(Capsule().strokeBorder(picked ? tint.opacity(0.6) : Color(uiColor: .separator), lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .disabled(creating)
                            .accessibilityAddTraits(picked ? .isSelected : [])
                        }
                    }
                }
                .padding(.top, 32)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 12)

                Text("It introduces itself, asks a couple of questions, then picks its own name and look. You can change anything later.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 28)
                    .padding(.horizontal, 16)
            }
            .padding(.horizontal, 20)
            .padding(.top, 36)
            .padding(.bottom, 16)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
                }
                Button(action: submit) {
                    HStack(spacing: 8) {
                        if creating { ProgressView().tint(.white) }
                        Text(creating ? "Creating…" : "Create Bot").font(.body.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.glassProminent)
                .tint(tint)
                .disabled(creating)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: creates)
        .onAppear { withAnimation(.smooth(duration: 0.6).delay(0.05)) { appeared = true } }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        guard !creating else { return }
        let text = BotSetup.goal(goal)
        creates += 1
        creating = true
        focused = false
        error = nil
        Task {
            do {
                try await create(text)
            } catch {
                self.error = BBClient.describe(error)
                creating = false
            }
        }
    }
}
