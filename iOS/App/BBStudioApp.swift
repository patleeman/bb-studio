import CoreSpotlight
import SwiftUI
import UIKit
import UserNotifications

@main
struct BBStudioApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .onOpenURL { model.handle($0) }
                .onChange(of: scenePhase, initial: true) { _, phase in model.scenePhaseChanged(phase) }
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String { model.openThread(id) }
                }
                .task {
                    // `-openURL bbstudio://…` drives headless simulator runs.
                    if let url = UserDefaults.standard.string(forKey: "openURL").flatMap(URL.init(string:)) {
                        model.handle(url)
                    }
                }
        }
        .commands { BBStudioCommands() }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        PhoneRelay.shared.activate()
        // Also runs when iOS wakes the app to hand over a push-started activity's token.
        Task { @MainActor in LiveStatus.shared.start() }
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        NotificationActions.register()
        // `-skipPushPrompt YES` keeps the permission alert out of headless simulator runs.
        guard !UserDefaults.standard.bool(forKey: "skipPushPrompt") else { return true }
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        let label = "BB Studio · \(UIDevice.current.name)"
        Task { try? await BBClient().registerPush(apnsToken: token, label: label) }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        Task {
            if await !NotificationActions.handle(response),
                let threadId = response.notification.request.content.userInfo["threadId"] as? String
            {
                await MainActor.run { AppModel.shared.openThread(threadId) }
            }
            completionHandler()
        }
    }
}
