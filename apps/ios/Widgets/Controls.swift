import AppIntents
import SwiftUI
import WidgetKit

/// Control Center, lock screen, and Action button controls that jump straight into BB Studio.
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
                Label("Voice chat", systemImage: "waveform")
            }
        }
        .displayName("Voice chat with BB")
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
