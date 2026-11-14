import XCTest
@testable import BBStudio

final class OrderedJSONTests: XCTestCase {
    private func json(_ text: String) throws -> OrderedJSON { try OrderedJSON.parse(Data(text.utf8)) }

    func testParsingKeepsKeyOrderAndEscapes() throws {
        let value = try json(#"{"zeta":1,"day":"Mon","alpha":[true,null,-2.5e1],"s":"a\"b\\c\u00e9\ud83d\ude00\n"}"#)
        XCTAssertEqual(value.fields?.map(\.key), ["zeta", "day", "alpha", "s"])
        XCTAssertEqual(value["alpha"], .array([.bool(true), .null, .number(-25)]))
        XCTAssertEqual(value["s"]?.string, "a\"b\\cé😀\n")
        XCTAssertEqual(try json(#"{"a":1,"b":2,"a":3}"#).fields?.map(\.key), ["a", "b"])
        XCTAssertEqual(try json(#"{"a":1,"b":2,"a":3}"#)["a"], .number(3))
        XCTAssertThrowsError(try json(#"{"a":1"#))
        XCTAssertThrowsError(try json("[1] x"))
    }

    func testJSONTextRoundTripsAndIsSafeInAScript() throws {
        let value = try json(#"{"b":1,"a":[1.5,"</script>","\u2028"],"c":null}"#)
        XCTAssertEqual(value.jsonText, #"{"b":1,"a":[1.5,"\u003c/script>","\u2028"],"c":null}"#)
        XCTAssertEqual(try json(value.jsonText), value)
        XCTAssertEqual(OrderedJSON.jsNumber(4), "4")
        XCTAssertEqual(OrderedJSON.jsNumber(-0.25), "-0.25")
    }

    func testRelativeTimesMatchTheDesktop() {
        let now = 10_000_000_000.0
        XCTAssertEqual(RelativeTime.ago(now - 10_000, now: now), "just now")
        XCTAssertEqual(RelativeTime.ago(now + 60_000, now: now), "just now")
        XCTAssertEqual(RelativeTime.ago(now - 4 * 60_000, now: now), "4m ago")
        XCTAssertEqual(RelativeTime.ago(now - 3 * 3_600_000, now: now), "3h ago")
        XCTAssertEqual(RelativeTime.ago(now - 47 * 3_600_000, now: now), "47h ago")
        XCTAssertEqual(RelativeTime.ago(now - 72 * 3_600_000, now: now), "3d ago")
    }
}
