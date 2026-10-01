import SwiftUI

struct PluginStatusView: View {
    @EnvironmentObject private var app: AppModel
    @State private var plugins: [InstalledPlugin] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            ForEach(plugins) { plugin in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: !plugin.enabled ? "minus.circle.fill" : plugin.status == "running" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                        .foregroundStyle(!plugin.enabled ? Color.secondary : plugin.status == "running" ? Color.green : Color.orange)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(plugin.name ?? plugin.id)
                        Text(plugin.enabled ? plugin.status.capitalized : "Disabled")
                            .font(.caption).foregroundStyle(.secondary)
                        if let detail = plugin.statusDetail, !detail.isEmpty, plugin.status != "running" {
                            Text(detail).font(.footnote).foregroundStyle(.red).textSelection(.enabled)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .overlay { if !loaded { ProgressView() } }
        .navigationTitle("Plugins")
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        do {
            plugins = try await app.client.installedPlugins()
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }
}
