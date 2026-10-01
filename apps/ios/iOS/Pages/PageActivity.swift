import SwiftUI

struct PageActivity: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let pageId: String
    let refresh: PageRefresh?
    @State private var requests: [PageRequest] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Keep updated") {
                    if let refresh {
                        LabeledContent("Schedule", value: refresh.cron)
                        if !refresh.instructions.isEmpty { Text(refresh.instructions) }
                        if let lastAt = refresh.lastAt {
                            LabeledContent("Last run") {
                                Text(Date(timeIntervalSince1970: lastAt / 1000), format: .dateTime)
                            }
                        }
                        if let nextAt = refresh.nextAt {
                            LabeledContent("Next run") {
                                Text(Date(timeIntervalSince1970: nextAt / 1000), format: .dateTime)
                            }
                        }
                    } else {
                        Text("Off").foregroundStyle(.secondary)
                    }
                }
                Section("Activity") {
                    if let error { Text(error).foregroundStyle(.red) }
                    if requests.isEmpty && error == nil { Text("No activity yet").foregroundStyle(.secondary) }
                    ForEach(requests) { request in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(request.summary).font(.headline)
                                Spacer()
                                Text(request.status.capitalized).font(.caption).foregroundStyle(.secondary)
                            }
                            Text(request.botName).font(.caption).foregroundStyle(.secondary)
                            if let result = request.result { Text(result) }
                            if let failure = request.error { Text(failure).foregroundStyle(.red) }
                            Text(Date(timeIntervalSince1970: request.updatedAt / 1000), format: .dateTime)
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Activity")
            .toolbar { Button("Done") { dismiss() } }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        do { requests = try await app.client.pageRequests(pageId); error = nil }
        catch { self.error = BBClient.describe(error, server: app.client.baseURL) }
    }
}
