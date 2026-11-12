import XCTest

/// Crash 3 (TestFlight 1421, the Duo): the keyboard crashed while attaching
/// to the window, in its split-keyboard transition, removing a constraint
/// Auto Layout had already broken. A phone keyboard has no split; it got
/// there because the window was told it was regular width. Each step folds,
/// unfolds, splits or resizes the window with the keyboard up or coming up,
/// and fails on any "Unable to simultaneously satisfy constraints" report.
@MainActor
final class KeyboardFoldUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    func testFoldingWithTheKeyboardUpBreaksNoConstraints() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        command("outer")
        Thread.sleep(forTimeInterval: 1)
        command("constraints?clear")
        command("counts?reset")
        var steps: [String] = []
        for cycle in 0..<3 {
            for size in ["landscape", "outer", "portrait", "outer", "split-right", "landscape", "outer"] {
                // The keyboard up, then the window changing under it.
                if !app.keyboards.firstMatch.exists { focus(composer) }
                command(size)
                Thread.sleep(forTimeInterval: 1.2)
                // The keyboard coming up in the same moment as a change.
                command("dismiss")
                focus(composer)
                command(size == "outer" ? "landscape" : "outer")
                Thread.sleep(forTimeInterval: 1.2)
                steps.append("c\(cycle) \(size): \(report().count) \(counts())")
            }
            command("pane?narrow")
            command("pane?even")
            XCUIDevice.shared.press(.home)
            Thread.sleep(forTimeInterval: 1)
            app.activate()
            Thread.sleep(forTimeInterval: 1.5)
            command("outer")
        }
        let final = report()
        print("KEYBOARD-FOLD " + steps.joined(separator: ", "))
        print("KEYBOARD-FOLD samples:\n" + final.samples.joined(separator: "\n"))
        XCTAssertEqual(final.count, 0, "Unsatisfiable constraints while folding with the keyboard:\n" + final.samples.joined(separator: "\n"))
        // No focus change of ours reloads the keyboard while the window
        // resizes under it, and the size class is set only when it changes
        // (it was set on every resize, from inside the resize's layout pass).
        let totals = rawCounts()
        XCTAssertEqual(totals["keyboard.reloadDuringResize"] ?? 0, 0, "Keyboard reloaded mid-resize: \(totals)")
        XCTAssertLessThan(totals["window.traitOverride"] ?? 0, totals["write.window"] ?? 0,
            "The size class was set on every window change: \(totals)")
    }

    /// The window can be wider than the simulator's screen: focus through
    /// the field's accessibility action, as VoiceOver would, when it's off it.
    private func focus(_ composer: XCUIElement) {
        if composer.isHittable { composer.tap() } else { command("activate?composerField") }
    }

    private func rawCounts() -> [String: Int] {
        command("counts")
        let value = app.windows.firstMatch.value as? String ?? ""
        return (try? JSONDecoder().decode([String: Int].self, from: Data(value.utf8))) ?? [:]
    }

    private func counts() -> String {
        rawCounts().filter { $0.key.hasPrefix("composer.") || $0.key.hasPrefix("window.") || $0.key.hasPrefix("keyboard.") || $0.key == "write.window" }
            .sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " ")
    }

    private struct Report: Decodable { let count: Int; let samples: [String] }

    private func report() -> Report {
        command("constraints")
        let value = app.windows.firstMatch.value as? String ?? ""
        return (try? JSONDecoder().decode(Report.self, from: Data(value.utf8))) ?? Report(count: -1, samples: ["no report: \(value.prefix(200))"])
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
}
