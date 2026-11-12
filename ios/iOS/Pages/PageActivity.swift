import SwiftUI

struct PageActivity: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let pageId: String
    @State private var requests: [PageRequest] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
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
