import ActivityKit
import SwiftUI
import WidgetKit

@main
struct BBStudioWidgets: WidgetBundle {
    var body: some Widget {
        RecordingLiveActivity()
        StatusWidget()
        BotWidget()
        WorkWidget()
        CaptureControl()
        BotTalkControl()
        DictateControl()
        NewThreadControl()
    }
}
