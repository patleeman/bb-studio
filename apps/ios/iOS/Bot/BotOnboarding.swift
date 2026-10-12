import SwiftUI

/// Before there is a Bot: it says hello in chat with a few starters. The first
/// message makes it (`bot_create` with that prompt).
struct BotOnboardingView: View {
    var create: (String) async throws -> Void
    var customize: () -> Void
    @State private var draft = ""
    @State private var sending: String?
    @State private var error: String?
    @State private var appeared = false
    @State private var sends = 0
    @FocusState private var focused: Bool

    static let starters = ["What needs me today?", "Plan my week", "Set up a morning brief", "Customize me"]
    private let look = BotLook(shape: BotShape.default.rawValue, color: BotPalette.hex(forName: BotInfo.defaultName), emoji: BotInfo.defaultAvatar)
    private var bot: BotInfo { BotInfo(name: BotInfo.defaultName, avatar: look.emoji, state: .active, lead: ThreadLead(threadId: nil), shape: look.shape?.rawValue, color: look.color) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                BotHero(bot: bot, status: "Your always-on agent", working: sending != nil)
                    .scaleEffect(appeared ? 1 : 0.92)
                    .opacity(appeared ? 1 : 0)
                greeting("Hi! I'm your Bot. I see every project, start threads for you, and check in on my own.", first: true, last: false)
                    .opacity(appeared ? 1 : 0).offset(y: appeared ? 0 : 12)
                greeting("What should I take off your plate first?", first: false, last: true)
                    .opacity(appeared ? 1 : 0).offset(y: appeared ? 0 : 12)
                if let sending {
                    Text(sending)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(BotPalette.color(look.color), in: .rect(cornerRadius: 20, style: .continuous))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.leading, 56)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    BotTypingRow(bot: bot, thinking: nil)
                }
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
                }
                if sending == nil {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Self.starters, id: \.self) { starter in
                                Button { pick(starter) } label: {
                                    Text(starter).font(.subheadline.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 8)
                                }
                                .buttonStyle(.glass)
                            }
                        }
                        .padding(2)
                    }
                    .scrollClipDisabled()
                }
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Message your Bot", text: $draft, axis: .vertical)
                        .lineLimit(1...6)
                        .focused($focused)
                        .submitLabel(.send)
                        .onSubmit { send(draft) }
                        .padding(.leading, 16).padding(.vertical, 12)
                    Button { send(draft) } label: {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(canSend ? BotPalette.color(look.color) : Color.secondary.opacity(0.35), in: .circle)
                    }
                    .disabled(!canSend)
                    .padding(6)
                    .accessibilityLabel("Send")
                }
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: sends)
        .animation(.smooth(duration: 0.3), value: sending)
        .onAppear { withAnimation(.smooth(duration: 0.6).delay(0.05)) { appeared = true } }
        .navigationBarTitleDisplayMode(.inline)
    }

    private var canSend: Bool { sending == nil && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func greeting(_ text: String, first: Bool, last: Bool) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            Group { if last { BotAvatar(look, size: 28) } else { Color.clear } }.frame(width: 28, height: 28)
            Text(text)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Color(uiColor: .secondarySystemBackground),
                            in: UnevenRoundedRectangle(topLeadingRadius: first ? 20 : 6, bottomLeadingRadius: 6, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous))
            Spacer(minLength: 24)
        }
    }

    private func pick(_ starter: String) {
        if starter == "Customize me" { customize() } else { send(starter) }
    }

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, sending == nil else { return }
        sends += 1
        sending = text
        draft = ""
        error = nil
        Task {
            do {
                try await create(text)
            } catch {
                self.error = BBClient.describe(error)
                draft = text
                sending = nil
            }
        }
    }
}
