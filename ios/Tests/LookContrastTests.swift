import XCTest
@testable import BBStudio

/// Round 5, change 5: every theme's text steps read on its canvas, and its
/// needs-you amber stands out as a mark.
final class LookContrastTests: XCTestCase {
    func testKnownRatios() throws {
        XCTAssertEqual(try XCTUnwrap(LookContrast.ratio("#ffffff", "#000000")), 21, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(LookContrast.ratio("#777777", "#777777")), 1, accuracy: 0.01)
        XCTAssertNil(LookContrast.ratio("not a colour", "#000000"))
    }

    func testEveryThemesTextStepsAndAmberRead() throws {
        let themes = LookCatalog.shared.themes
        XCTAssertGreaterThan(themes.count, 1, "the bundled catalog")
        for theme in themes {
            for (mode, tokens) in theme.modes {
                let name = "\(theme.id) \(mode)"
                for (step, color) in [("ink", tokens.ink), ("muted", tokens.muted), ("subtle", tokens.subtle)] {
                    let ratio = try XCTUnwrap(LookContrast.ratio(color, tokens.canvas), name)
                    XCTAssertGreaterThanOrEqual(ratio, 4.5, "\(name): \(step) on canvas")
                }
                let shown = LookContrast.legible(tokens.needsYou, on: tokens.canvas, minimum: 3)
                let amber = try XCTUnwrap(LookContrast.ratio(shown, tokens.canvas), name)
                XCTAssertGreaterThanOrEqual(amber, 3, "\(name): needs-you on canvas, as shown")
                if let raw = LookContrast.ratio(tokens.needsYou, tokens.canvas), raw >= 3 {
                    XCTAssertEqual(shown, tokens.needsYou, "\(name): an amber that passes keeps its colour")
                }
            }
        }
    }
}
