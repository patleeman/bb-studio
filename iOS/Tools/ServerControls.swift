import SwiftUI

/// Host settings from the keep-awake and concurrency-limit plugins.
struct ServerControls: View {
    @EnvironmentObject private var app: AppModel
    @AppStorage("runningPlugins") private var runningPlugins = ""
    @State private var keepAwake: KeepAwakeConfig?
    @State private var concurrency: ConcurrencyConfig?
    @State private var error: String?

    var body: some View {
        let plugins = Set(runningPlugins.split(separator: ",").map(String.init))
        if plugins.contains("keep-awake") || plugins.contains("concurrency-limit") {
            Section {
                if let keepAwake {
                    Toggle("Keep Mac awake", isOn: Binding(get: { keepAwake.enabled }, set: { enabled in
                        var config = keepAwake
                        config.enabled = enabled
                        Task { await save { self.keepAwake = try await app.client.setKeepAwake(config) } }
                    }))
                }
                if let concurrency {
                    Stepper(value: Binding(get: { concurrency.globalLimit ?? 0 }, set: { limit in
                        Task {
                            await save { self.concurrency = try await app.client.setConcurrency(globalLimit: limit > 0 ? limit : nil, keeping: concurrency) }
                        }
                    }), in: 0...32) {
                        LabeledContent("Threads at once", value: concurrency.globalLimit.map(String.init) ?? "Automatic")
                    }
                    ForEach(concurrency.hosts) { host in
                        LabeledContent(host.name, value: host.effectiveLimit.map { "\($0) at once" } ?? "—")
                            .font(.footnote)
                            .foregroundStyle(host.status == "connected" ? .primary : .secondary)
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            } header: {
                Text("Hosts")
            } footer: {
                Text("Keep awake stops the machines idle-sleeping while BB works. Threads at once caps how many run in parallel; Automatic uses each host's core count.")
            }
            .task(id: app.serverURL) { await load(plugins) }
        }
    }

    private func load(_ plugins: Set<String>) async {
        if plugins.contains("keep-awake") { keepAwake = try? await app.client.keepAwake() }
        if plugins.contains("concurrency-limit") { concurrency = try? await app.client.concurrency() }
    }

    private func save(_ change: () async throws -> Void) async {
        do {
            try await change()
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
