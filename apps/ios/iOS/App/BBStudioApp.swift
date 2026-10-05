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
                .id(model.serverURL)
                .environmentObject(model)
                .onOpenURL { model.handle($0) }
                .onChange(of: scenePhase, initial: true) { _, phase in model.scenePhaseChanged(phase) }
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
                        let id = Spotlight.currentIdentifier(identifier) {
                        let parts = id.split(separator: ":", maxSplits: 1).map(String.init)
                        if parts.count == 2 {
                            let host = ["pages": "page", "talk": "recording", "excalidraw": "drawing", "artifacts": "artifact"][parts[0]]
                            if let host, let url = URL(string: "bbstudio://\(host)/\(parts[1])") { model.handle(url) }
                        } else { model.openThread(id) }
                    }
                }
                .task {
                    TalkOutbox.shared.kick()
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
        // Also runs when iOS wakes the app for a silent push.
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        NotificationActions.register()
        #if targetEnvironment(simulator)
        return true
        #else
        guard !UserDefaults.standard.bool(forKey: "skipPushPrompt"),
            PushRegistration.allowed(arguments: ProcessInfo.processInfo.arguments,
            environment: ProcessInfo.processInfo.environment) else { return true }
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
        return true
        #endif
    }

    func application(
        _ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }

    /// The relay's silent push when threads were read or answered elsewhere.
    func application(
        _ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let threadIds = userInfo["clearThreadIds"] as? [String],
              let serverId = userInfo["serverId"] as? String, !serverId.isEmpty
        else { return completionHandler(.noData) }
        Task {
            // Match both origin and thread locally. A clear for server A can
            // arrive while B is selected or Tailscale is offline.
            await NotificationActions.clear(threadIds: Set(threadIds), serverId: serverId)
            completionHandler(.newData)
        }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        #if !targetEnvironment(simulator)
        guard !UserDefaults.standard.bool(forKey: "skipPushPrompt"),
            PushRegistration.allowed(arguments: ProcessInfo.processInfo.arguments,
            environment: ProcessInfo.processInfo.environment) else { return }
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        let label = "BB Studio · \(UIDevice.current.name)"
        Task { try? await PushRegistration.shared.register(apnsToken: token, label: label, client: BBClient()) }
        #endif
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
            let userInfo = response.notification.request.content.userInfo
            if await !NotificationActions.handle(response) {
                let client = BBClient()
                do {
                    try await client.validateNotificationOrigin(userInfo["serverId"] as? String)
                    guard client.baseURL == BBClient.storedServerURL else { completionHandler(); return }
                } catch {
                    await MainActor.run { AppModel.shared.notificationError = error.localizedDescription }
                    completionHandler()
                    return
                }
                if let threadId = userInfo["threadId"] as? String {
                    await MainActor.run { AppModel.shared.openThread(threadId) }
                }
            }
            completionHandler()
        }
    }
}

/// Home Screen quick actions. Each one's type is the app link it opens.
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    static let shortcuts: [UIApplicationShortcutItem] = [
        .init(type: "bbstudio://dictate", localizedTitle: "Dictate", localizedSubtitle: nil, icon: .init(systemImageName: "mic.fill")),
        .init(type: "bbstudio://write", localizedTitle: "Write", localizedSubtitle: nil, icon: .init(systemImageName: "square.and.pencil")),
        .init(type: "bbstudio://new", localizedTitle: "New Thread", localizedSubtitle: nil, icon: .init(systemImageName: Symbols.newThread)),
    ]

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        UIApplication.shared.shortcutItems = Self.shortcuts
        if let item = connectionOptions.shortcutItem { open(item) }
    }

    func windowScene(
        _ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(open(shortcutItem))
    }

    @discardableResult
    private func open(_ item: UIApplicationShortcutItem) -> Bool {
        guard let url = URL(string: item.type) else { return false }
        Task { @MainActor in AppModel.shared.handle(url) }
        return true
    }
}
