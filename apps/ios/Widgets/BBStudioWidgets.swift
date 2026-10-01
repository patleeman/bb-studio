import ActivityKit
import SwiftUI
import WidgetKit

@main
struct BBStudioWidgets: WidgetBundle {
    var body: some Widget {
        RecordingLiveActivity()
        StatusWidget()
        WorkWidget()
        CaptureControl()
        DictateControl()
        VoiceControl()
        NewThreadControl()
    }
}
