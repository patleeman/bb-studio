// Local speech to text with WhisperKit.
import Foundation

public enum WhisperKitLoader {
    public static func load(model: String, modelDir: String, language: String?, into scheduler: TranscriptionScheduler, sink: EventSink) async {
        sink.emit(.error(code: .model, message: "WhisperKit isn't built yet"))
        scheduler.markUnavailable()
    }
}
