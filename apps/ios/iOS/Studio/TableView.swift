import SwiftUI

struct StudioTableView: View {
    @EnvironmentObject private var app: AppModel
    let id: String
    @State private var table: Tables.GetOutputTable?
    @State private var error: String?
    @State private var grid = false
    @State private var showingRelated = false

    var body: some View {
        Group {
            if let table {
                VStack(spacing: 0) {
                    Picker("View", selection: $grid) {
                        Text("List").tag(false)
                        Text("Table").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .padding()
                    if grid { gridView(table) } else { listView(table) }
                }
            } else if let error {
                ContentUnavailableView("Couldn't open table", systemImage: "tablecells", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(table?.title ?? "Table")
        .toolbar { Button { showingRelated = true } label: { Label("Related", systemImage: "link") } }
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "studio-tables", itemId: id) }
        .accessibilityIdentifier("studioTable")
        .refreshable { await load() }
        .task(id: id) { await load() }
    }

    private func listView(_ table: Tables.GetOutputTable) -> some View {
        List {
            ForEach(Array((table.rows ?? []).enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array((table.columns ?? []).enumerated()), id: \.offset) { _, column in
                        if let columnId = column.id, let value = row.values?[columnId] {
                            LabeledContent(column.name ?? "Column", value: display(value))
                        }
                    }
                }
            }
        }
    }

    private func gridView(_ table: Tables.GetOutputTable) -> some View {
        ScrollView([.horizontal, .vertical]) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array((table.columns ?? []).enumerated()), id: \.offset) { _, column in
                        cell(column.name ?? "Column", heading: true)
                    }
                }
                ForEach(Array((table.rows ?? []).enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array((table.columns ?? []).enumerated()), id: \.offset) { _, column in
                            cell(column.id.flatMap { row.values?[$0] }.map(display) ?? "")
                        }
                    }
                }
            }
            .padding()
        }
    }

    private func cell(_ text: String, heading: Bool = false) -> some View {
        Text(text)
            .font(heading ? .subheadline.weight(.semibold) : .subheadline)
            .frame(width: 150, alignment: .leading)
            .padding(8)
            .background(heading ? Color.secondary.opacity(0.12) : Color.clear)
            .border(Color.secondary.opacity(0.2))
    }

    private func display(_ value: StudioJSONValue) -> String { Self.text(value) }

    /// A cell's value as text, here and in reply cards.
    static func text(_ value: StudioJSONValue) -> String {
        switch value {
        case .null: ""
        case .bool(let value): value ? "Yes" : "No"
        case .number(let value): value.formatted()
        case .string(let value): value
        case .array(let values): values.map(text).joined(separator: ", ")
        case .object(let values): values.values.map(text).joined(separator: ", ")
        }
    }

    private func load() async {
        do {
            table = try await app.client.studioTable(id)
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
