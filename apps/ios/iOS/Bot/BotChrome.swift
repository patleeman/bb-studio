import SwiftUI

/// What a thread needs to draw itself as the Bot's chat (the Bot tab).
struct BotChrome {
    var bot: BotInfo
    /// The Bot's handoff chain, oldest first, ending at its thread.
    var chain: [String] = []
    /// Threads the Bot started, from BB's thread metadata, with live status.
    var started: [BotStartedThread] = []
    /// Opens a thread inside the Bot tab.
    var openThread: (String) -> Void
    /// The chat started or stopped running, or something came to need the user.
    var runningChanged: (Bool) -> Void = { _ in }
    /// The chat moved to a new thread (a handoff to another provider).
    var followThread: (String) -> Void = { _ in }
    /// Its prompt cache, shown small beside the status while it's idle.
    var cache: BotCacheState? = nil
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
                            HStack(spacing: 4) {
                                Text(status)
                                    .foregroundStyle(working ? AnyShapeStyle(BotPalette.color(chrome.bot.color)) : AnyShapeStyle(.secondary))
                                    .contentTransition(.opacity)
                                if !working, let cache = chrome.cache {
                                    // Minutes left, counted down between loads.
                                    TimelineView(.periodic(from: .now, by: 30)) { context in
                                        if let line = cache.line(now: context.date) {
                                            Text("· \(line)").foregroundStyle(.tertiary)
                                        }
                                    }
                                }
                            }
                            .font(.caption2)
                            .lineLimit(1)
                        }
                    }
                    .animation(.smooth, value: status)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(chrome.bot.name), \(status)")
                }
            }
            // A frosted bar, so earlier messages blur under the Bot's name
            // instead of reading through it.
            .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            .toolbarBackgroundVisibility(.visible, for: .navigationBar)
        } else {
            content
        }
    }
}

/// The Bot's composer floats on Liquid Glass. Not `.interactive()`: that
/// glass takes the touches meant for the mic's hold-to-talk gesture, so a tap
/// on the mic focused the field instead.
struct BotComposerGlass: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.glassEffect(.regular, in: .rect(cornerRadius: 24))
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
