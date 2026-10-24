import Charts
import SwiftUI
import WebKit

/// A Studio dashboard, read-only, as one column in the phone layout's order.
/// Built-in widgets are native; custom ones run their HTML in the same sandbox
/// as on the desktop. While the screen is on top and the app active, the phone
/// sends the viewer heartbeat, so the server keeps url and script widgets fresh;
/// realtime signals bring the new data. Editing and script approval are desktop-only.
struct DashboardView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let id: String
    @State private var dashboard: Dashboard?
    @State private var missing = false
    @State private var error: String?
    @State private var viewing = DashboardViewing()
    /// Moves with each heartbeat, for "updated 2m ago"; no timer of its own.
    @State private var now = Date.now
    @State private var listener: UUID?
    @State private var showingWeb = false
    @State private var showingRelated = false
    @State private var loads = 0
    @State private var reloading = false
    @State private var reloadAgain = false

    var body: some View {
        Group {
            if let dashboard {
                content(dashboard)
            } else if missing {
                ContentUnavailableView("Dashboard not found", systemImage: StudioKind.of("dashboard").symbol,
                    description: Text("It may have been deleted."))
            } else if let error {
                ContentUnavailableView("Couldn't open dashboard", systemImage: StudioKind.of("dashboard").symbol, description: Text(error))
            } else {
                ProgressView()
            }
        }
        .modifier(RegularScrollingSurface())
        .navigationTitle(dashboard?.displayName ?? "Dashboard")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Menu {
                Button { showingWeb = true } label: { Label("Edit on Desktop or BB Web", systemImage: "safari") }
                Button { showingRelated = true } label: { Label("Related", systemImage: "link") }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("Dashboard options")
        }
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "dashboards", itemId: id) }
        .sheet(isPresented: $showingWeb) {
            NavigationStack {
                WebView(url: client.baseURL.appending(path: "plugins/studio/studio/dashboards/\(id)"))
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle(dashboard?.displayName ?? "Dashboard")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { showingWeb = false } }
            }
        }
        .refreshable { await refresh() }
        .task(id: id) {
            if let listener { app.realtime.removeListener(listener) }
            listener = app.realtime.listen { event in
                switch event {
                // Studio publishes edits and fresh widget data on its `dashboards` channel.
                case .pluginSignal("studio", "dashboards", let payload) where payload["dashboardId"]?.stringValue == id:
                    if viewing.watching { Task { await reload() } }
                case .connected:
                    if viewing.watching { Task { await reload() } }
                default: break
                }
            }
            await reload()
        }
        // The heartbeat runs only while this screen is on top and the app active.
        .task(id: viewing.watching) {
            guard viewing.watching else { return }
            while !Task.isCancelled {
                now = .now
                try? await client.viewDashboard(id)
                try? await Task.sleep(for: DashboardViewing.interval)
            }
        }
        .onAppear { setViewing(visible: true, active: scenePhase == .active) }
        .onDisappear {
            setViewing(visible: false, active: viewing.active)
            if let listener { app.realtime.removeListener(listener) }
            listener = nil
        }
        .onChange(of: scenePhase) { _, phase in setViewing(visible: viewing.visible, active: phase == .active) }
        .accessibilityIdentifier("dashboardView")
    }

    private func setViewing(visible: Bool, active: Bool) {
        let next = DashboardViewing(visible: visible, active: active)
        let action = DashboardViewing.action(from: viewing, to: next)
        viewing = next
        switch action {
        case .leave?:
            let client = client, id = id
            Task { try? await client.viewDashboard(id, leave: true) }
        case .beat?:
            // Back on screen: data may have changed while nobody watched.
            if dashboard != nil { Task { await reload() } }
        case nil: break
        }
    }

    private func content(_ dashboard: Dashboard) -> some View {
        // One column on a phone; on an iPad, as many as fit, still in the phone layout's order.
        let columns = sizeClass == .regular
            ? [GridItem(.adaptive(minimum: 320), spacing: 16, alignment: .top)]
            : [GridItem(.flexible(), alignment: .top)]
        return ScrollView {
            if dashboard.widgets.isEmpty {
                ContentUnavailableView("No widgets yet", systemImage: StudioKind.of("dashboard").symbol,
                    description: Text("Add widgets in BB on the desktop, or ask an agent to."))
                    .padding(.top, 48)
            } else {
                LazyVGrid(columns: columns, spacing: sizeClass == .regular ? 16 : 12) {
                    ForEach(dashboard.stacked) { widget in
                        DashboardTile(dashboard: dashboard, widget: widget, data: dashboard.data[widget.id], now: now)
                    }
                }
                .padding(.horizontal, sizeClass == .regular ? 20 : 16)
                .padding(.vertical, 12)
            }
        }
        .background(Color(.systemGroupedBackground))
    }

    /// Asks the server to fetch url and approved script widgets, then shows what it has.
    private func refresh() async {
        let refreshed = try? await client.refreshDashboard(id)
        await load()
        if refreshed?.isEmpty == true, dashboard?.widgets.contains(where: \.fetchable) == true {
            app.flash("Refreshed less than 10 seconds ago.")
        }
    }

    /// Loads, coalescing signals that arrive while a load is running.
    private func reload() async {
        if reloading {
            reloadAgain = true
            return
        }
        reloading = true
        repeat {
            reloadAgain = false
            await load()
        } while reloadAgain
        reloading = false
    }

    private func load() async {
        loads += 1
        let load = loads
        #if DEBUG
        if let demo = DashboardDemo.dashboard(id) {
            now = .now
            if demo != dashboard { dashboard = demo }
            return
        }
        #endif
        do {
            let found = try await client.dashboard(id)
            guard load == loads else { return }
            now = .now
            if let found {
                if found != dashboard { dashboard = found }
                missing = false
                error = nil
            } else {
                missing = true
            }
        } catch {
            guard load == loads else { return }
            if dashboard == nil { self.error = BBClient.describe(error, server: client.baseURL) }
        }
    }
}

// MARK: Tile

/// One widget: its title, when its data came in, and its body. A widget that
/// can't show data yet says why in its body instead.
private struct DashboardTile: View {
    let dashboard: Dashboard
    let widget: Dashboard.Widget
    let data: Dashboard.DataView?
    let now: Date
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let freshness = DashboardTime.freshness(data, now: now.timeIntervalSince1970 * 1000)
        let state = DashboardTileState(data: data, widget: widget)
        VStack(alignment: .leading, spacing: 10) {
            header(freshness: state == .data && freshness?.tone == .normal ? freshness?.text : nil)
            switch state {
            case .approval:
                DashboardNotice(
                    symbol: "desktopcomputer", tint: StudioKind.of("dashboard").tint, title: "Approve on desktop",
                    detail: "This widget runs a script on your computer. Approve it once in BB on the desktop and its data shows here.")
            case .error:
                DashboardNotice(
                    symbol: "exclamationmark.triangle.fill", tint: .orange, title: "Couldn't load",
                    detail: [data?.error, "Pull down to try again."].compactMap { $0 }.joined(separator: "\n"))
            case .waiting:
                DashboardEmpty(
                    text: widget.sourceKind == "push" ? "No data yet. An agent sends it." : "Loading…",
                    symbol: widget.sourceKind == "push" ? "tray" : nil)
            case .data:
                DashboardWidgetBody(dashboard: dashboard, widget: widget, value: data?.value ?? .null)
                // Older data shown while the source fails, or waits for approval again.
                if let freshness, freshness.tone != .normal {
                    Label(freshness.text, systemImage: freshness.tone == .error ? "exclamationmark.circle" : "desktopcomputer")
                        .font(.caption)
                        .foregroundStyle(freshness.tone == .error ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(widget.heading ?? widget.type.capitalized)
    }

    /// The title on the left and "2m ago" on the right; stacked at accessibility sizes.
    @ViewBuilder
    private func header(freshness: String?) -> some View {
        let heading = widget.heading
        if heading != nil || freshness != nil {
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
            layout {
                if let heading {
                    Text(heading)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                }
                if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
                if let freshness {
                    Text(freshness.replacingOccurrences(of: "Updated ", with: ""))
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .fixedSize()
                        .accessibilityLabel(freshness)
                }
            }
        }
    }
}

/// What a tile's body shows.
private enum DashboardTileState: Equatable {
    case data, approval, error, waiting

    init(data: Dashboard.DataView?, widget: Dashboard.Widget) {
        let empty = (data?.value ?? .null).isNull
        switch data?.status {
        case "approval"? where empty: self = .approval
        case "error"? where empty: self = .error
        case "pending"? where widget.usesData: self = .waiting
        default: self = .data
        }
    }
}

/// A calm, tinted box for a widget that needs something before it can show data.
private struct DashboardNotice: View {
    let symbol: String
    let tint: Color
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(tint.opacity(0.1), in: .rect(cornerRadius: 10))
        .accessibilityElement(children: .combine)
    }
}

/// A widget with nothing to show: a quiet, centered line.
private struct DashboardEmpty: View {
    let text: String
    var symbol: String?

    var body: some View {
        VStack(spacing: 6) {
            if let symbol { Image(systemName: symbol).font(.title3).foregroundStyle(.tertiary) }
            Text(text).font(.footnote).foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, minHeight: 64)
    }
}

// MARK: Widget bodies

private struct DashboardWidgetBody: View {
    let dashboard: Dashboard
    let widget: Dashboard.Widget
    let value: OrderedJSON

    var body: some View {
        switch widget.type {
        case "stat": StatWidget(widget: widget, value: value)
        case "line", "bar", "area", "pie": ChartWidget(widget: widget, value: value)
        case "table": TableWidget(widget: widget, value: value)
        case "list": ListWidget(widget: widget, value: value)
        case "ticker": TickerWidget(value: value)
        case "note": NoteWidget(widget: widget, value: value)
        case "embed": EmbedWidget(widget: widget)
        case "clock": ClockWidget(widget: widget)
        case "image": ImageWidget(widget: widget, value: value)
        case "progress": ProgressWidget(widget: widget, value: value)
        case "custom": CustomWidget(dashboard: dashboard, widget: widget, value: value)
        default: DashboardEmpty(text: "The phone can't show \(widget.type) widgets yet.")
        }
    }
}

private func seriesColor(_ index: Int) -> Color {
    Color(hex: dashboardSeriesColors[index % dashboardSeriesColors.count])
}

private struct StatWidget: View {
    let widget: Dashboard.Widget
    let value: OrderedJSON

    var body: some View {
        let stat = DashboardRead.stat(value, options: widget.options)
        let invert = widget.options["invert"]?.bool == true
        let good = invert ? stat.trend == "down" : stat.trend == "up"
        let bad = invert ? stat.trend == "up" : stat.trend == "down"
        let tint: Color = good ? .green : bad ? .red : .secondary
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(DashboardRead.format(stat.value, options: widget.options))
                    .font(.largeTitle.weight(.semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if let delta = stat.delta {
                    HStack(spacing: 3) {
                        if stat.trend == "up" || stat.trend == "down" {
                            Image(systemName: stat.trend == "up" ? "arrow.up.right" : "arrow.down.right")
                                .font(.caption.weight(.bold))
                        }
                        Text(delta).monospacedDigit().lineLimit(1)
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(tint)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(tint.opacity(0.12), in: .capsule)
                    .fixedSize()
                }
            }
            if let caption = stat.caption {
                Text(caption).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            if widget.options["sparkline"]?.bool != false, stat.series.count > 1 {
                Chart(Array(stat.series.enumerated()), id: \.offset) { point in
                    LineMark(x: .value("Index", point.offset), y: .value("Value", point.element))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
                        .foregroundStyle(good ? Color.green : bad ? Color.red : Color.accentColor.opacity(0.7))
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: .automatic(includesZero: false))
                .frame(height: 36)
                .padding(.top, 2)
                .accessibilityLabel("Trend: \(stat.series.map { OrderedJSON.jsNumber($0) }.joined(separator: ", "))")
            }
        }
    }
}

private struct ChartWidget: View {
    let widget: Dashboard.Widget
    let value: OrderedJSON

    var body: some View {
        if let chart = DashboardRead.chart(value, options: widget.options) {
            let unit = widget.options["unit"]?.text ?? ""
            let stacked = widget.options["stacked"]?.bool == true
            let colors = widget.type == "pie"
                ? Array(Set(chart.points.map(\.x))).count
                : chart.series.count
            Chart(chart.points) { point in
                switch widget.type {
                case "line":
                    LineMark(x: .value(chart.x, point.x), y: .value("Value", point.value))
                        .foregroundStyle(by: .value("Series", point.series))
                        .lineStyle(StrokeStyle(lineWidth: 2.25, lineCap: .round, lineJoin: .round))
                case "area":
                    AreaMark(x: .value(chart.x, point.x), y: .value("Value", point.value), stacking: stacked ? .standard : .unstacked)
                        .foregroundStyle(by: .value("Series", point.series))
                        .opacity(stacked ? 0.75 : 0.35)
                case "pie":
                    SectorMark(angle: .value("Value", point.value), innerRadius: .ratio(0.58), angularInset: 1.5)
                        .cornerRadius(3)
                        .foregroundStyle(by: .value(chart.x, point.x))
                default:
                    if stacked {
                        BarMark(x: .value(chart.x, point.x), y: .value("Value", point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                    } else {
                        BarMark(x: .value(chart.x, point.x), y: .value("Value", point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                            .position(by: .value("Series", point.series))
                            .cornerRadius(3)
                    }
                }
            }
            .chartForegroundStyleScale(range: (0..<max(1, colors)).map(seriesColor))
            .chartLegend(chart.series.count > 1 || widget.type == "pie" ? .visible : .hidden)
            .chartLegend(position: .top, alignment: .leading, spacing: 12)
            // Categories along the bottom without grid lines; a few quiet value lines.
            .chartXAxis {
                AxisMarks { _ in
                    AxisValueLabel(collisionResolution: .greedy).font(.caption2)
                }
            }
            .chartYAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(Color.secondary.opacity(0.35))
                    AxisValueLabel().font(.caption2)
                }
            }
            .chartYAxisLabel(unit)
            // Axis labels stop growing before they crowd out the plot.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .frame(height: widget.type == "pie" ? 200 : 190)
            .accessibilityLabel("\(widget.type) chart of \(chart.series.joined(separator: ", ")) by \(chart.x), \(chart.rows) rows")
        } else {
            DashboardEmpty(text: "No rows to chart yet.")
        }
    }
}

private struct TableWidget: View {
    let widget: Dashboard.Widget
    let value: OrderedJSON
    /// The phone draws every cell; past this, the desktop shows the rest.
    private static let phoneRows = 50

    var body: some View {
        if let table = DashboardRead.table(value, options: widget.options) {
            VStack(alignment: .leading, spacing: 6) {
                ScrollView(.horizontal) {
                    Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 7) {
                        GridRow {
                            ForEach(Array(table.columns.enumerated()), id: \.offset) { _, column in
                                Text(column).font(.caption.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        Divider()
                        ForEach(Array(table.rows.prefix(Self.phoneRows).enumerated()), id: \.offset) { index, row in
                            if index > 0 { Divider().opacity(0.5) }
                            GridRow {
                                ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                    Text(DashboardRead.cellText(cell))
                                        .font(.footnote)
                                        .monospacedDigit()
                                        .lineLimit(2)
                                        .frame(maxWidth: 240, alignment: .leading)
                                        .gridColumnAlignment(.leading)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                if table.rows.count > Self.phoneRows {
                    Text("\(table.rows.count - Self.phoneRows) more rows on the desktop").font(.caption2).foregroundStyle(.secondary)
                }
            }
        } else {
            DashboardEmpty(text: "No rows yet.")
        }
    }
}

private struct ListWidget: View {
    let widget: Dashboard.Widget
    let value: OrderedJSON
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let items = DashboardRead.list(value) {
            if items.isEmpty {
                DashboardEmpty(text: "The list is empty.")
            } else {
                let max = Swift.max(1, Int(widget.options["maxItems"]?.number ?? 50))
                let dates = widget.options["showDates"]?.bool != false
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(items.prefix(max).enumerated()), id: \.offset) { index, item in
                        if index > 0 { Divider() }
                        Button {
                            if let link = item.link { openURL(link) }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(item.title)
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(item.link != nil ? Color.accentColor : Color.primary)
                                        .lineLimit(2)
                                    Spacer(minLength: 8)
                                    if dates, let date = item.date {
                                        Text(Self.shortDate(date)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                                    }
                                }
                                if let summary = item.summary {
                                    Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .allowsHitTesting(item.link != nil)
                    }
                }
            }
        } else {
            DashboardEmpty(text: "Nothing here yet.")
        }
    }

    /// Today's times as a time, other days as a date.
    static func shortDate(_ text: String) -> String {
        guard let date = DashboardTime.parse(text) else { return text }
        return Calendar.current.isDateInToday(date)
            ? date.formatted(date: .omitted, time: .shortened)
            : date.formatted(.dateTime.month(.abbreviated).day())
    }
}

/// A strip of values the user scrolls; no marquee, so nothing animates on its own.
private struct TickerWidget: View {
    let value: OrderedJSON

    var body: some View {
        let entries = DashboardRead.ticker(value)
        if entries.isEmpty {
            DashboardEmpty(text: "Nothing to show yet.")
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 22) {
                    ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(entry.label).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                            if !entry.value.isEmpty { Text(entry.value).font(.subheadline.weight(.medium)).monospacedDigit() }
                            if !entry.delta.isEmpty {
                                let down = entry.delta.hasPrefix("-") || entry.delta.hasPrefix("−")
                                Text(entry.delta).font(.footnote.weight(.medium)).monospacedDigit()
                                    .foregroundStyle(down ? .red : .green)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.vertical, 4)
                .padding(.trailing, 24)
            }
            // Fades at the trailing edge, so it reads as a strip that scrolls.
            .mask {
                HStack(spacing: 0) {
                    Rectangle()
                    LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: 24)
                }
            }
        }
    }
}

private struct NoteWidget: View {
    let widget: Dashboard.Widget
    let value: OrderedJSON

    var body: some View {
        let source = value.string ?? widget.options["markdown"]?.text ?? ""
        if source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            DashboardEmpty(text: "This note is empty.")
        } else {
            MarkdownText(source)
        }
    }
}

private struct EmbedWidget: View {
    let widget: Dashboard.Widget
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var studio = StudioStore.shared
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch DashboardRead.embed(widget.options) {
        case .item(let href):
            let item = studio.items.first { $0.href == href }
            row(title: item?.displayTitle ?? widget.title ?? "Studio item", detail: item?.preview, symbol: item.map { StudioKind.of($0.kind).symbol } ?? "square.stack") {
                if let route = Route(href: href) {
                    app.push(route)
                } else if let url = URL(string: href, relativeTo: app.client.baseURL) {
                    openURL(url)
                }
            }
        case .thread(let threadId):
            row(title: "Open thread", detail: nil, symbol: Symbols.thread) { app.push(.thread(id: threadId)) }
        case .web(let url):
            let host = url.host() ?? url.absoluteString
            let rest = url.absoluteString.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression)
            row(title: host, detail: rest.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == host ? nil : rest, symbol: "safari") { openURL(url) }
        case .none:
            DashboardEmpty(text: "This embed has nothing to show yet.")
        }
    }

    private func row(title: String, detail: String?, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.tint)
                    .frame(width: 36, height: 36)
                    .background(Color.accentColor.opacity(0.12), in: .rect(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(2)
                    if let detail, !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// The time somewhere, redrawn each minute, or a countdown the system ticks.
private struct ClockWidget: View {
    let widget: Dashboard.Widget

    var body: some View {
        let options = widget.options
        let label = options["label"]?.text ?? ""
        Group {
            if options["mode"]?.string == "countdown" {
                if let target = DashboardTime.parse(options["target"]?.text ?? "") {
                    TimelineView(.everyMinute) { context in
                        VStack(spacing: 2) {
                            Group {
                                // Under an hour the system counts the seconds; above, minutes are enough.
                                if target.timeIntervalSince(context.date) < 3600, target > context.date {
                                    Text(timerInterval: context.date...target, countsDown: true)
                                } else {
                                    Text(DashboardTime.countdown(target.timeIntervalSince1970 * 1000, now: context.date.timeIntervalSince1970 * 1000))
                                }
                            }
                            .font(.largeTitle.weight(.semibold))
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            Text(label.isEmpty ? target.formatted(date: .abbreviated, time: .shortened) : label)
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    DashboardEmpty(text: "Set a target time")
                }
            } else {
                let zoneName = options["timeZone"]?.text ?? ""
                if let zone = zoneName.isEmpty ? TimeZone.current : TimeZone(identifier: zoneName) {
                    TimelineView(.everyMinute) { context in
                        VStack(spacing: 2) {
                            Text(Self.time(context.date, zone: zone, hour12: options["hour12"]?.bool))
                                .font(.largeTitle.weight(.semibold))
                                .monospacedDigit()
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                            let place = label.isEmpty ? (zoneName.split(separator: "/").last.map { $0.replacingOccurrences(of: "_", with: " ") } ?? "") : label
                            Text([place, Self.day(context.date, zone: zone)].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    DashboardEmpty(text: "Unknown time zone \(zoneName).")
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }

    static func time(_ date: Date, zone: TimeZone, hour12: Bool?) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = zone
        switch hour12 {
        case true?: formatter.setLocalizedDateFormatFromTemplate("hmm")
        case false?: formatter.setLocalizedDateFormatFromTemplate("Hmm")
        case nil: formatter.timeStyle = .short
        }
        return formatter.string(from: date)
    }

    static func day(_ date: Date, zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = zone
        formatter.setLocalizedDateFormatFromTemplate("EEEMMMd")
        return formatter.string(from: date)
    }
}

private struct ImageWidget: View {
    let widget: Dashboard.Widget
    let value: OrderedJSON
    @EnvironmentObject private var app: AppModel

    var body: some View {
        if let url = DashboardRead.image(value, options: widget.options, server: app.client.baseURL) {
            let contain = widget.options["fit"]?.string == "contain"
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: contain ? .fit : .fill)
                case .failure:
                    DashboardEmpty(text: "Couldn't load the image.", symbol: "photo")
                default:
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 200)
            .clipShape(.rect(cornerRadius: 8))
            .accessibilityLabel(widget.options["alt"]?.text.isEmpty == false ? widget.options["alt"]!.text : widget.title ?? "Image")
        } else {
            DashboardEmpty(text: "This image has no address.")
        }
    }
}

private struct ProgressWidget: View {
    let widget: Dashboard.Widget
    let value: OrderedJSON
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if let progress = DashboardRead.progress(value, options: widget.options) {
            let unit = widget.options["unit"]?.text ?? ""
            let text = DashboardRead.cellText(.number(progress.value)) + unit
            let max = DashboardRead.cellText(.number(progress.max)) + unit
            Group {
                if widget.options["style"]?.string == "gauge" {
                    VStack(spacing: 6) {
                        // The value sits inside the arc, the label under it.
                        ZStack(alignment: .bottom) {
                            GaugeArc(fraction: 1).stroke(Color.primary.opacity(0.1), style: StrokeStyle(lineWidth: 12, lineCap: .round))
                            if progress.fraction > 0 {
                                GaugeArc(fraction: progress.fraction).stroke(seriesColor(0), style: StrokeStyle(lineWidth: 12, lineCap: .round))
                            }
                            Text(text)
                                .font(.title.weight(.semibold))
                                .monospacedDigit()
                                .lineLimit(1)
                                .minimumScaleFactor(0.5)
                                .frame(maxWidth: 130)
                        }
                        .frame(width: 200, height: 106)
                        if !progress.label.isEmpty { Text(progress.label).font(.footnote).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        let row = typeSize.isAccessibilitySize
                            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
                            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
                        row {
                            if !progress.label.isEmpty {
                                Text(progress.label).font(.subheadline).foregroundStyle(.secondary).lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
                            }
                            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
                            HStack(spacing: 0) {
                                Text(text).font(.subheadline.weight(.semibold)).monospacedDigit()
                                Text(" / \(max)").font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                            }
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .layoutPriority(1)
                        }
                        Capsule().fill(Color.primary.opacity(0.1))
                            .frame(height: 8)
                            .overlay(alignment: .leading) {
                                GeometryReader { proxy in
                                    Capsule().fill(seriesColor(0)).frame(width: proxy.size.width * progress.fraction)
                                }
                            }
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(progress.label.isEmpty ? widget.title ?? "Progress" : progress.label)
            .accessibilityValue("\(text) of \(max)")
        } else {
            DashboardEmpty(text: "No value yet.")
        }
    }
}

/// The top half of a circle, filled from the left.
private struct GaugeArc: Shape {
    var fraction: Double

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let radius = min(rect.width / 2, rect.height) - 6
        path.addArc(center: CGPoint(x: rect.midX, y: rect.maxY - 1), radius: radius,
                    startAngle: .degrees(180), endAngle: .degrees(180 + 180 * fraction), clockwise: false)
        return path
    }
}

// MARK: Custom widgets

private struct CustomWidget: View {
    let dashboard: Dashboard
    let widget: Dashboard.Widget
    let value: OrderedJSON
    @Environment(\.colorScheme) private var colorScheme
    @State private var asked: Double?
    @State private var width: Double = 0

    var body: some View {
        if let html = dashboard.customHTML(widget) {
            let base = dashboard.gridHeight(widget)
            let height = max(base, asked ?? 0)
            DashboardCustomFrameView(
                html: html,
                state: DashboardCustomFrame.stateScript(
                    data: value, options: dashboard.customOptions(widget), dark: colorScheme == .dark, width: width, height: base),
                asked: $asked)
                .frame(height: height)
                .frame(maxWidth: .infinity)
                .onGeometryChange(for: Double.self) { $0.size.width } action: { width = $0 }
                .accessibilityLabel(widget.title ?? "Custom widget")
        } else {
            DashboardEmpty(text: widget.customType != nil ? "This widget's library type is gone." : "This widget has no HTML yet.")
        }
    }
}

/// A custom widget's HTML in a WKWebView sandboxed like the desktop's iframe: the
/// CSP blocks every network request, nothing persists, it can't navigate or open
/// windows, and the only thing it can tell the app is the height it wants.
private struct DashboardCustomFrameView: UIViewRepresentable {
    let html: String
    /// The script that hands the widget {data, options, theme, size}.
    let state: String
    @Binding var asked: Double?

    private static let bridge = """
        addEventListener("message", function (event) {
          var d = event.data;
          if (!d || typeof d !== "object") return;
          if (d.type === "\(DashboardCustomFrame.readyMessage)") webkit.messageHandlers.bbWidget.postMessage({ ready: true });
          else if ((d.type === "\(DashboardCustomFrame.heightMessage)" || d.type === undefined) && typeof d.height === "number")
            webkit.messageHandlers.bbWidget.postMessage({ height: d.height });
        });
        """

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        // The bridge runs in the app's own content world, so the widget's scripts
        // can't reach the message handler directly; they see only window messages.
        let world = WKContentWorld.defaultClient
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: world))
        configuration.userContentController.add(context.coordinator, contentWorld: world, name: "bbWidget")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        context.coordinator.view = view
        context.coordinator.load(html: html, state: state)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.asked = $asked
        context.coordinator.load(html: html, state: state)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeAllScriptMessageHandlers()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        view.stopLoading()
    }

    func makeCoordinator() -> Coordinator { Coordinator(asked: $asked) }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var view: WKWebView?
        var asked: Binding<Double?>
        private var html: String?
        private var state: String?
        private var ready = false
        private var sent: String?

        init(asked: Binding<Double?>) { self.asked = asked }

        func load(html: String, state: String) {
            self.state = state
            if html != self.html {
                self.html = html
                ready = false
                sent = nil
                view?.loadHTMLString(DashboardCustomFrame.document(html), baseURL: nil)
            } else {
                send()
            }
        }

        /// Hands the widget its state once it's ready, and again only when it changes.
        private func send() {
            guard ready, let state, state != sent, let view else { return }
            sent = state
            view.evaluateJavaScript(state, completionHandler: nil)
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "bbWidget" else { return }
            if (message.body as? [String: Any])?["ready"] != nil {
                ready = true
                send()
            } else if let height = DashboardCustomFrame.askedHeight(message.body), asked.wrappedValue != height {
                asked.wrappedValue = height
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // A widget whose load event fired before the bridge heard it still gets its state.
            ready = true
            send()
        }

        /// Only the widget's own document loads; links and redirects go nowhere, as in the desktop's sandbox.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = action.request.url?.absoluteString ?? ""
            decisionHandler(url == "about:blank" || url.isEmpty ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            guard let html else { return }
            ready = false
            sent = nil
            webView.loadHTMLString(DashboardCustomFrame.document(html), baseURL: nil)
        }
    }
}
