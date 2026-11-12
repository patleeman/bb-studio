import UIKit
import UniformTypeIdentifiers

@main final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Share fixture", sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = FixtureViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}
final class FixtureViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let stack = UIStackView()
        stack.axis = .vertical; stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        let title = UILabel(); title.text = "Private Share runtime fixtures"; stack.addArrangedSubview(title)
        for (index, label) in ["Share URL and text", "Share image", "Share file", "Share failed item"].enumerated() {
            let button = UIButton(type: .system)
            button.setTitle(label, for: .normal); button.tag = index
            button.addTarget(self, action: #selector(share(_:)), for: .touchUpInside)
            stack.addArrangedSubview(button)
        }
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    }
    @objc private func share(_ sender: UIButton) {
        let items: [Any]
        switch sender.tag {
        case 0: items = ["BB Share runtime URL and text fixture", URL(string: "https://example.com/bb-share-runtime")!]
        case 1:
            let image = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 400)).image { context in
                UIColor.systemBlue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 800, height: 400))
                ("BB private image fixture" as NSString).draw(at: CGPoint(x: 50, y: 180), withAttributes: [.font: UIFont.systemFont(ofSize: 42), .foregroundColor: UIColor.white])
            }
            items = [image]
        case 2:
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("bb-share-runtime-fixture.txt")
            try! Data("BB Share runtime immutable file fixture\n".utf8).write(to: url)
            items = [url]
        default:
            let provider = NSItemProvider()
            provider.suggestedName = "bb-share-runtime-failed.pdf"
            provider.registerFileRepresentation(forTypeIdentifier: UTType.pdf.identifier, fileOptions: [], visibility: .all) { completion in
                completion(nil, false, NSError(domain: "BBShareRuntimeFixture", code: 42, userInfo: [NSLocalizedDescriptionKey: "Intentional unavailable item fixture"]))
                return nil
            }
            items = ["BB Share runtime mixed valid and failed fixture", provider]
        }
        let activity: UIActivityViewController
        if sender.tag == 3 {
            let text = NSItemProvider(object: "BB Share runtime mixed valid and failed fixture" as NSString)
            let config = UIActivityItemsConfiguration(itemProviders: [text, items[1] as! NSItemProvider])
            activity = UIActivityViewController(activityItemsConfiguration: config)
        } else {
            activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
        }
        activity.popoverPresentationController?.sourceView = sender
        present(activity, animated: true)
    }
}
