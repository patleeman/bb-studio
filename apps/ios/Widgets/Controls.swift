import AppIntents
import SwiftUI
import WidgetKit

/// Control Center, lock screen, and Action button controls that jump straight into BB Studio.
struct CaptureControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "nyc.plee.bbgo.capture") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "bbstudio://capture")!)) {
                Label("Capture to BB", systemImage: "square.and.arrow.down")
            }
        }
        .displayName("Capture to BB")
    }
}

struct BotTalkControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "nyc.plee.bbgo.chief-talk") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "bbstudio://bot-talk")!)) {
                Label("Talk to Bot", systemImage: "person.crop.circle.badge.checkmark")
            }
        }
        .displayName("Talk to Bot")
        .description("Press to start talking, press again to send.")
    }
}

struct DictateControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "nyc.plee.bbgo.dictate") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "bbstudio://dictate")!)) {
                Label("Dictate to BB", systemImage: "mic.fill")
            }
        }
        .displayName("Dictate to BB")
    }
}

struct VoiceControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "nyc.plee.bbgo.voice") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "bbstudio://voice")!)) {
                Label("New voice chat", systemImage: Symbols.voiceChat)
            }
        }
        .displayName("New voice chat with BB")
    }
}

struct NewThreadControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "nyc.plee.bbgo.new") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "bbstudio://new")!)) {
                Label("New BB thread", systemImage: "square.and.pencil")
            }
        }
        .displayName("New BB thread")
    }
}
