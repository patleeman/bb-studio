import ActivityKit
import SwiftUI
import WidgetKit

@main
struct BBStudioWidgets: WidgetBundle {
    var body: some Widget {
        RecordingLiveActivity()
        StatusWidget()
        ChiefWidget()
        WorkWidget()
        CaptureControl()
        ChiefTalkControl()
        DictateControl()
        VoiceControl()
        NewThreadControl()
    }
}
