import SwiftUI
import UIKit

@MainActor
enum KeyboardWarmer {
    private(set) static var warmed = false

    static func warm() {
        guard !warmed, UIApplication.shared.applicationState == .active,
              let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows).first(where: \.isKeyWindow)
        else { return }
        warmed = true
        RoomPerf.mark("warm")
        let field = UITextField(frame: CGRect(x: -1000, y: -1000, width: 10, height: 10))
        field.isAccessibilityElement = false
        field.accessibilityElementsHidden = true
        window.addSubview(field)
        UIView.performWithoutAnimation {
            field.becomeFirstResponder()
            field.resignFirstResponder()
        }
        field.removeFromSuperview()
    }
}

struct KeyboardWarmup: ViewModifier {
    let phase: ScenePhase
    let atRest: () -> Bool

    func body(content: Content) -> some View {
        content.task(id: phase) {
            guard phase == .active, !KeyboardWarmer.warmed else { return }
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled, atRest() else { return }
            KeyboardWarmer.warm()
        }
    }
}
