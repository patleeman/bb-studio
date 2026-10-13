import XCTest
@testable import BBStudio

/// Studio Dashboards on the phone: order, data readers, times and the viewer heartbeat.
final class DashboardTests: XCTestCase {
    private func json(_ text: String) throws -> OrderedJSON { try OrderedJSON.parse(Data(text.utf8)) }
    private let en = Locale(identifier: "en_US")

    // MARK: JSON

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

    // MARK: Decoding and order

    private let sample = #"""
        {"id":"dsh_0123456789abcdef","name":"Ops","projectId":null,"createdAt":1,"updatedAt":2,"widgetCount":4,"archived":false,
         "widgets":[
           {"id":"a","type":"stat","title":null,"options":{"label":"Signups"},"source":{"kind":"static","data":5},"customType":null,"html":null,"script":null},
           {"id":"b","type":"line","title":"Trend","options":{},"source":{"kind":"url","url":"https://x.test"},"customType":null,"html":null,"script":null},
           {"id":"c","type":"custom","title":"Mine","options":{"color":"red"},"source":{"kind":"script","command":"ls"},"customType":"t1","html":null,"script":{"sha256":"00","approved":false}},
           {"id":"d","type":"note","title":"Readme","options":{"markdown":"Hi"},"source":{"kind":"none"},"customType":null,"html":null,"script":null}],
         "layouts":{"lg":[{"i":"a","x":0,"y":0,"w":3,"h":3},{"i":"b","x":3,"y":0,"w":6,"h":6},{"i":"c","x":9,"y":0,"w":3,"h":3},{"i":"d","x":0,"y":3,"w":3,"h":3}],
                    "md":[],
                    "sm":[{"i":"b","x":0,"y":0,"w":4,"h":6},{"i":"d","x":2,"y":6,"w":2,"h":3},{"i":"a","x":0,"y":6,"w":2,"h":3}]},
         "data":[{"widgetId":"a","value":5,"fetchedAt":null,"error":null,"errorAt":null,"status":"static"},
                 {"widgetId":"b","value":[{"day":"Mon","n":1}],"fetchedAt":1000,"error":null,"errorAt":null,"status":"ok"},
                 {"widgetId":"c","value":null,"fetchedAt":null,"error":null,"errorAt":null,"status":"approval"}],
         "widgetTypes":[{"id":"t1","name":"T","description":"","html":"<p>lib</p>","defaultOptions":{"color":"blue","size":2},"sampleData":null,"createdAt":1,"updatedAt":1}]}
        """#

    func testDashboardDecodesWidgetsLayoutsDataAndTypes() throws {
        let dashboard = try XCTUnwrap(Dashboard(try json(sample)))
        XCTAssertEqual(dashboard.displayName, "Ops")
        XCTAssertEqual(dashboard.widgets.map(\.id), ["a", "b", "c", "d"])
        XCTAssertEqual(dashboard.widgets[0].heading, "Signups")
        XCTAssertEqual(dashboard.widgets[2].scriptApproved, false)
        XCTAssertFalse(dashboard.widgets[2].fetchable)
        XCTAssertTrue(dashboard.widgets[1].fetchable)
        XCTAssertEqual(dashboard.data["b"]?.status, "ok")
        XCTAssertEqual(dashboard.data["b"]?.value.array?.first?.fields?.map(\.key), ["day", "n"])
        XCTAssertEqual(dashboard.customHTML(dashboard.widgets[2]), "<p>lib</p>")
        XCTAssertEqual(dashboard.customOptions(dashboard.widgets[2]).jsonText, #"{"color":"red","size":2}"#)
        XCTAssertNil(Dashboard(try json(#"{"name":"no id"}"#)))
    }

    func testStackFollowsTheNarrowestLayoutByRowThenColumn() throws {
        let dashboard = try XCTUnwrap(Dashboard(try json(sample)))
        // sm places b, then a (x 0) and d (x 2) on row 6; c isn't in sm, so it comes last.
        XCTAssertEqual(dashboard.stacked.map(\.id), ["b", "a", "d", "c"])
        XCTAssertEqual(dashboard.gridHeight(dashboard.widgets[1]), 36 * 6 + 12 * 5 - 34)

        var lgOnly = dashboard
        lgOnly.layouts = ["lg": dashboard.layouts["lg"]!, "md": [], "sm": []]
        XCTAssertEqual(lgOnly.stacked.map(\.id), ["a", "b", "c", "d"])

        var none = dashboard
        none.layouts = [:]
        XCTAssertEqual(none.stacked.map(\.id), ["a", "b", "c", "d"])
    }

    // MARK: Readers

    func testStatReadsNumbersSeriesRowsAndObjects() throws {
        let options = try json(#"{"unit":"%","prefix":"~"}"#)
        XCTAssertEqual(DashboardRead.stat(.number(42), options: options).value, .number(42))
        XCTAssertEqual(DashboardRead.stat(.string("OK"), options: options).value, .text("OK"))

        let series = DashboardRead.stat(try json("[10, 12]"), options: .object([]))
        XCTAssertEqual(series.value, .number(12))
        XCTAssertEqual(series.delta, "+20%")
        XCTAssertEqual(series.trend, "up")
        XCTAssertEqual(series.series, [10, 12])

        let small = DashboardRead.stat(try json("[100, 95]"), options: .object([]))
        XCTAssertEqual(small.delta, "-5.0%")
        XCTAssertEqual(small.trend, "down")

        let fromZero = DashboardRead.stat(try json("[0, 3]"), options: .object([]))
        XCTAssertEqual(fromZero.delta, "+3")

        let rows = DashboardRead.stat(try json(#"[{"day":"Mon","n":1},{"day":"Tue","n":"4"}]"#), options: try json(#"{"field":"n"}"#))
        XCTAssertEqual(rows.series, [1, 4])

        let object = DashboardRead.stat(try json(#"{"value":1200,"delta":-3,"caption":"vs last week"}"#), options: .object([]))
        XCTAssertEqual(object.value, .number(1200))
        XCTAssertEqual(object.delta, "-3")
        XCTAssertEqual(object.trend, "down")
        XCTAssertEqual(object.caption, "vs last week")

        let seriesOnly = DashboardRead.stat(try json(#"{"series":[1,2,4]}"#), options: .object([]))
        XCTAssertEqual(seriesOnly.value, .number(4))
        XCTAssertEqual(seriesOnly.delta, "+100%")

        XCTAssertNil(DashboardRead.stat(.bool(true), options: .object([])).value)

        XCTAssertEqual(DashboardRead.format(.number(1234.5678), options: options, locale: en), "~1,235%")
        XCTAssertEqual(DashboardRead.format(.number(3.14159), options: .object([]), locale: en), "3.14")
        XCTAssertEqual(DashboardRead.format(.number(3), options: try json(#"{"decimals":2}"#), locale: en), "3.00")
        XCTAssertEqual(DashboardRead.format(nil, options: options), "—")
    }

    func testChartsResolveTheirAxisAndSeriesInKeyOrder() throws {
        let rows = try json(#"[{"signups":4,"day":"Mon","churn":1,"note":"x"},{"signups":6,"day":"Tue","churn":"2"}]"#)
        let chart = try XCTUnwrap(DashboardRead.chart(rows, options: .object([])))
        XCTAssertEqual(chart.x, "day")
        XCTAssertEqual(chart.series, ["signups", "churn"])
        // A numeric string still plots.
        XCTAssertEqual(chart.points.map(\.value), [4, 1, 6, 2])
        XCTAssertEqual(chart.points.map(\.x), ["Mon", "Mon", "Tue", "Tue"])

        let picked = try XCTUnwrap(DashboardRead.chart(rows, options: try json(#"{"x":"day","series":["churn"]}"#)))
        XCTAssertEqual(picked.series, ["churn"])

        XCTAssertNotNil(DashboardRead.chart(try json(#"{"data":[{"label":"Web","value":60}]}"#), options: .object([])))
        XCTAssertNotNil(DashboardRead.chartRows(try json(#"{"rows":[{"a":1}]}"#)))
        XCTAssertNil(DashboardRead.chart(try json("[1,2,3]"), options: .object([])))
        XCTAssertNil(DashboardRead.chart(.null, options: .object([])))
    }

    func testTablesReadRowsOrColumnsAndRows() throws {
        let rows = try XCTUnwrap(DashboardRead.table(try json(#"[{"name":"a","n":1},{"name":"b","extra":true}]"#), options: .object([])))
        XCTAssertEqual(rows.columns, ["name", "n", "extra"])
        XCTAssertEqual(rows.rows[1], [.string("b"), .null, .bool(true)])

        let explicit = try XCTUnwrap(DashboardRead.table(try json(#"{"columns":["x","y"],"rows":[[1,2],{"y":3,"x":4},"z"]}"#), options: .object([])))
        XCTAssertEqual(explicit.rows, [[.number(1), .number(2)], [.number(4), .number(3)], [.string("z")]])

        let chosen = try XCTUnwrap(DashboardRead.table(try json(#"[{"a":1,"b":2},{"a":3,"b":4}]"#), options: try json(#"{"columns":["b"],"maxRows":1}"#)))
        XCTAssertEqual(chosen.columns, ["b"])
        XCTAssertEqual(chosen.rows, [[.number(2)]])

        XCTAssertEqual(DashboardRead.cellText(.number(12345.5), locale: en), "12,345.5")
        XCTAssertEqual(DashboardRead.cellText(try json(#"{"k":[1]}"#)), #"{"k":[1]}"#)
        XCTAssertEqual(DashboardRead.cellText(.null), "")
        XCTAssertNil(DashboardRead.table(.string("nope"), options: .object([])))
    }

    func testListsReadEntriesStringsAndFeeds() throws {
        let items = try XCTUnwrap(DashboardRead.list(try json(#"""
            {"items":[{"title":"Post","link":"https://b.test/p","summary":"Short","date":"2026-10-01T00:00:00Z"},
                      {"name":"Named","url":"javascript:alert(1)"},
                      "Plain", 7, {"nothing":true}]}
            """#)))
        XCTAssertEqual(items.map(\.title), ["Post", "Named", "Plain", "7"])
        XCTAssertEqual(items[0].link?.absoluteString, "https://b.test/p")
        XCTAssertEqual(items[0].summary, "Short")
        XCTAssertNil(items[1].link, "Only http(s) links open.")
        XCTAssertEqual(try XCTUnwrap(DashboardRead.list(try json("[]"))).count, 0)
        XCTAssertNil(DashboardRead.list(.number(3)))
    }

    func testTickerReadsEntriesAndStrings() throws {
        let entries = DashboardRead.ticker(try json(#"[{"symbol":"AAPL","price":190.5,"change":"-1.2%"},"BTC",{"value":""}]"#))
        XCTAssertEqual(entries, [
            DashboardRead.TickerEntry(label: "AAPL", value: "190.5", delta: "-1.2%"),
            DashboardRead.TickerEntry(label: "BTC", value: "", delta: ""),
        ])
        XCTAssertEqual(DashboardRead.ticker(.null), [])
    }

    func testProgressReadsNumbersAndObjects() throws {
        let plain = try XCTUnwrap(DashboardRead.progress(.number(40), options: try json(#"{"max":80,"label":"Goal"}"#)))
        XCTAssertEqual(plain.fraction, 0.5)
        XCTAssertEqual(plain.label, "Goal")
        let object = try XCTUnwrap(DashboardRead.progress(try json(#"{"value":"15","min":10,"max":10,"label":"Odd"}"#), options: .object([])))
        XCTAssertEqual(object.max, 11, "A max at or below min becomes min + 1.")
        XCTAssertEqual(object.fraction, 1)
        XCTAssertEqual(object.label, "Odd")
        XCTAssertNil(DashboardRead.progress(.string("lots"), options: .object([])))
    }

    func testImagesEmbedsAndNotesReadTheirOptions() throws {
        let server = URL(string: "https://bb.invalid")!
        XCTAssertEqual(DashboardRead.image(.null, options: try json(#"{"url":"https://img.test/a.png"}"#), server: server)?.absoluteString, "https://img.test/a.png")
        XCTAssertEqual(DashboardRead.image(.string("/api/v1/files/x.png"), options: .object([]), server: server)?.absoluteString, "https://bb.invalid/api/v1/files/x.png")
        XCTAssertNotNil(DashboardRead.image(.string("data:image/png;base64,AAAA"), options: .object([]), server: server))
        XCTAssertNil(DashboardRead.image(.string("file:///etc/passwd"), options: .object([]), server: server))

        XCTAssertEqual(DashboardRead.embed(try json(#"{"href":"/plugins/studio/studio/pages/pg_1","url":"https://x.test"}"#)), .item("/plugins/studio/studio/pages/pg_1"))
        XCTAssertEqual(DashboardRead.embed(try json(#"{"threadId":"thr_1"}"#)), .thread("thr_1"))
        XCTAssertEqual(DashboardRead.embed(try json(#"{"url":"https://x.test/a"}"#)), .web(URL(string: "https://x.test/a")!))
        XCTAssertEqual(DashboardRead.embed(try json(#"{"url":"ftp://x.test"}"#)), .none)
    }

    func testCustomWidgetsGetTheDesktopsSandboxedDocument() throws {
        let doc = DashboardCustomFrame.document("<p>hi</p>")
        XCTAssertTrue(doc.contains("connect-src 'none'"))
        XCTAssertTrue(doc.contains("default-src 'none'"))
        XCTAssertLessThan(doc.range(of: "Content-Security-Policy")!.lowerBound, doc.range(of: "<script>")!.lowerBound)
        XCTAssertTrue(doc.hasSuffix("<body><p>hi</p></body></html>"))
        let script = DashboardCustomFrame.stateScript(data: try json(#"{"b":1,"a":2}"#), options: .object([]), dark: true, width: 300.4, height: 120)
        XCTAssertTrue(script.hasPrefix(#"window.postMessage({"type":"bb-widget-state","data":{"b":1,"a":2},"options":{},"theme":{"mode":"dark""#))
        XCTAssertTrue(script.contains(#""size":{"width":300,"height":120}"#))
        XCTAssertEqual(DashboardCustomFrame.askedHeight(["height": 120.2]), 121)
        XCTAssertEqual(DashboardCustomFrame.askedHeight(["height": 99_999]), 4000)
        XCTAssertNil(DashboardCustomFrame.askedHeight(["height": "tall"]))
    }

    // MARK: Times

    func testRelativeTimesMatchTheDesktop() {
        let now = 10_000_000_000.0
        XCTAssertEqual(DashboardTime.ago(now - 10_000, now: now), "just now")
        XCTAssertEqual(DashboardTime.ago(now + 60_000, now: now), "just now")
        XCTAssertEqual(DashboardTime.ago(now - 4 * 60_000, now: now), "4m ago")
        XCTAssertEqual(DashboardTime.ago(now - 3 * 3_600_000, now: now), "3h ago")
        XCTAssertEqual(DashboardTime.ago(now - 47 * 3_600_000, now: now), "47h ago")
        XCTAssertEqual(DashboardTime.ago(now - 72 * 3_600_000, now: now), "3d ago")
    }

    func testFreshnessSaysWhenDataCameInOrWhatWentWrong() {
        let now = 10_000_000_000.0
        func view(_ status: String, fetchedAt: Double? = nil, error: String? = nil, errorAt: Double? = nil) -> Dashboard.DataView {
            Dashboard.DataView(value: .null, fetchedAt: fetchedAt, error: error, errorAt: errorAt, status: status)
        }
        XCTAssertNil(DashboardTime.freshness(nil, now: now))
        XCTAssertNil(DashboardTime.freshness(view("static"), now: now))
        XCTAssertNil(DashboardTime.freshness(view("none"), now: now))
        XCTAssertTrue(DashboardTime.freshness(view("ok", fetchedAt: now - 120_000), now: now)! == ("Updated 2m ago", .normal))
        XCTAssertTrue(DashboardTime.freshness(view("error", fetchedAt: now - 3_600_000, error: "boom", errorAt: now - 60_000), now: now)! == ("Failed 1m ago; showing 1h ago", .error))
        XCTAssertTrue(DashboardTime.freshness(view("error", error: "boom"), now: now)! == ("Couldn't load", .error))
        XCTAssertTrue(DashboardTime.freshness(view("approval"), now: now)! == ("Needs approval on desktop", .warning))
        XCTAssertTrue(DashboardTime.freshness(view("pending"), now: now)! == ("Waiting for data", .normal))
    }

    func testCountdownsAndTargetTimes() throws {
        XCTAssertEqual(DashboardTime.countdown(0, now: 5), "Now")
        XCTAssertEqual(DashboardTime.countdown(65_000, now: 0), "1m 5s")
        XCTAssertEqual(DashboardTime.countdown(3_725_000, now: 0), "1h 2m 5s")
        XCTAssertEqual(DashboardTime.countdown(90_061_000, now: 0), "1d 1h 1m")
        XCTAssertEqual(DashboardTime.parse("2026-10-01T00:00:00Z")?.timeIntervalSince1970, 1_790_812_800)
        XCTAssertEqual(DashboardTime.parse("2026-10-01T00:00:00.500Z")?.timeIntervalSince1970, 1_790_812_800.5)
        XCTAssertEqual(DashboardTime.parse("Thu, 01 Oct 2026 00:00:00 GMT")?.timeIntervalSince1970, 1_790_812_800)
        XCTAssertNotNil(DashboardTime.parse("2026-10-01"))
        XCTAssertNil(DashboardTime.parse("soon"))
    }

    // MARK: Heartbeat

    func testHeartbeatRunsOnlyWhileVisibleAndActive() {
        let hidden = DashboardViewing(visible: false, active: true)
        let shown = DashboardViewing(visible: true, active: true)
        let background = DashboardViewing(visible: true, active: false)
        XCTAssertFalse(hidden.watching)
        XCTAssertTrue(shown.watching)
        XCTAssertFalse(background.watching)
        XCTAssertEqual(DashboardViewing.action(from: hidden, to: shown), .beat)
        XCTAssertEqual(DashboardViewing.action(from: shown, to: background), .leave)
        XCTAssertEqual(DashboardViewing.action(from: background, to: shown), .beat)
        XCTAssertEqual(DashboardViewing.action(from: shown, to: hidden), .leave)
        XCTAssertNil(DashboardViewing.action(from: hidden, to: background), "Nothing to send when it wasn't watching either way.")
        XCTAssertNil(DashboardViewing.action(from: shown, to: shown))
    }

    func testHeartbeatKeepsWellInsideTheServersViewerWindow() {
        // shared.ts LIMITS.viewerMs: a viewer counts for 75 s after its last beat.
        XCTAssertEqual(DashboardViewing.interval, .seconds(30))
        XCTAssertLessThan(DashboardViewing.interval * 2, .seconds(75))
        XCTAssertTrue(DashboardViewing.clientId.hasPrefix("ios_"))
        XCTAssertEqual(DashboardViewing.clientId, DashboardViewing.clientId)
    }

    // MARK: Routes

    @MainActor
    func testDashboardLinksOpenTheDashboard() {
        XCTAssertEqual(Route(href: "/plugins/studio/studio/dashboards/dsh_0123456789abcdef"), .dashboard(id: "dsh_0123456789abcdef"))
        XCTAssertTrue(BBClient.isDashboardId("dsh_0123456789abcdef"))
        XCTAssertFalse(BBClient.isDashboardId("dsh_nothex"))
        XCTAssertEqual(StudioKind.of("dashboard").plural, "Dashboards")
    }

    // MARK: Transport

    func testDashboardRPCsUseTheGeneratedMethodsAndKeepKeyOrder() async throws {
        let client = BBClient(baseURL: URL(string: "https://bb.invalid")!)
        let sample = self.sample
        let calls = CallLog()
        client.transport = { method, path, body in
            await calls.add(path, body.flatMap { String(data: $0, encoding: .utf8) } ?? "")
            if path.hasSuffix("/dashboards.get") { return (200, Data(#"{"ok":true,"result":{"dashboard":\#(sample)}}"#.utf8)) }
            if path.hasSuffix("/dashboards.refresh") { return (200, Data(#"{"ok":true,"result":{"refreshed":["b"],"data":[]}}"#.utf8)) }
            return (200, Data(#"{"ok":true,"result":{"ok":true}}"#.utf8))
        }
        let dashboard = try await client.dashboard("dsh_0123456789abcdef")
        XCTAssertEqual(dashboard?.data["b"]?.value.array?.first?.fields?.map(\.key), ["day", "n"])
        try await client.viewDashboard("dsh_0123456789abcdef")
        try await client.viewDashboard("dsh_0123456789abcdef", leave: true)
        let refreshed = try await client.refreshDashboard("dsh_0123456789abcdef")
        XCTAssertEqual(refreshed, ["b"])
        let log = await calls.entries
        XCTAssertEqual(log.map(\.0), [
            "/api/v1/plugins/studio/rpc/dashboards.get", "/api/v1/plugins/studio/rpc/dashboards.view",
            "/api/v1/plugins/studio/rpc/dashboards.view", "/api/v1/plugins/studio/rpc/dashboards.refresh",
        ])
        XCTAssertTrue(log[1].1.contains(DashboardViewing.clientId))
        XCTAssertFalse(log[1].1.contains("leave"))
        XCTAssertTrue(log[2].1.contains(#""leave":true"#))

        client.transport = { _, _, _ in (200, Data(#"{"ok":true,"result":{"dashboard":null}}"#.utf8)) }
        let gone = try await client.dashboard("dsh_0123456789abcdef")
        XCTAssertNil(gone)
        client.transport = { _, _, _ in (404, Data(#"{"ok":false,"error":{"message":"Nope"}}"#.utf8)) }
        do {
            _ = try await client.dashboard("dsh_0123456789abcdef")
            XCTFail("Expected an error")
        } catch {
            XCTAssertTrue(String(describing: error).contains("Nope") || (error as? BBError)?.message == "Nope")
        }
    }
}

private actor CallLog {
    var entries: [(String, String)] = []
    func add(_ path: String, _ body: String) { entries.append((path, body)) }
}
