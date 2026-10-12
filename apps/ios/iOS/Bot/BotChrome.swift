import SwiftUI

/// What a thread needs to draw itself as the Bot's chat (the Bot tab).
struct BotChrome {
    var bot: BotInfo
    /// Threads the Bot started, by id, from its Activity.
    var started: [String: BotActivity.Thread] = [:]
    /// Opens a thread inside the Bot tab.
    var openThread: (String) -> Void
    /// The chat started or stopped running, or something came to need the user.
    var runningChanged: (Bool) -> Void = { _ in }
}

/// The Bot's name and live status in the middle of the navigation bar.
struct BotChromeToolbar: ViewModifier {
    let chrome: BotChrome?
    let status: String
    let working: Bool

    func body(content: Content) -> some View {
        if let chrome {
            content.toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        BotAvatar(chrome.bot.look, size: 26, working: working)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(chrome.bot.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(status)
                                .font(.caption2)
                                .foregroundStyle(working ? AnyShapeStyle(BotPalette.color(chrome.bot.color)) : AnyShapeStyle(.secondary))
                                .lineLimit(1)
                                .contentTransition(.opacity)
                        }
                    }
                    .animation(.smooth, value: status)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(chrome.bot.name), \(status)")
                }
            }
        } else {
            content
        }
    }
}

/// The Bot's composer floats on Liquid Glass.
struct BotComposerGlass: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
        } else {
            content
        }
    }
}

/// A send haptic, and word to the Bot tab when the chat starts or stops
/// running or something comes to need the user.
struct BotThreadHooks: ViewModifier {
    let chrome: BotChrome?
    let sends: Int
    let running: Bool
    let interactions: Int

    func body(content: Content) -> some View {
        content
            .sensoryFeedback(.impact(weight: .medium), trigger: sends)
            .onChange(of: running) { _, running in chrome?.runningChanged(running) }
            .onChange(of: interactions) { _, _ in chrome?.runningChanged(running) }
    }
}
