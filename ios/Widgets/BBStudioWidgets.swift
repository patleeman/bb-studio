import ActivityKit
import SwiftUI
import WidgetKit

@main
struct BBStudioWidgets: WidgetBundle {
    var body: some Widget {
        RecordingLiveActivity()
        BotLiveActivity()
        StatusWidget()
        BotWidget()
        WorkWidget()
        CaptureControl()
        BotTalkControl()
        DictateControl()
        NewThreadControl()
    }
}
