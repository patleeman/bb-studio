import SwiftUI

/// How much of each Claude and Codex account's limits are used, from the
/// account pool. Refreshes every minute while open.
struct UsageView: View {
    @EnvironmentObject private var app: AppModel
    @State private var accounts: [PoolAccount] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        List {
            if let error {
                Section { ConnectionBanner(message: error) { await load() } }
            }
            ForEach(providers, id: \.self) { provider in
                Section(Self.providerName(provider)) {
                    ForEach(accounts.filter { $0.provider == provider }) { account in
                        AccountUsage(account: account)
                    }
                }
            }
        }
        .overlay {
            if !loaded {
                ProgressView()
            } else if accounts.isEmpty, error == nil {
                ContentUnavailableView("No pooled accounts", systemImage: "gauge.with.dots.needle.33percent",
                    description: Text("Add Claude or Codex accounts with bb pool on the server."))
            }
        }
        .navigationTitle("Usage")
        .refreshable { await load() }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    private var providers: [String] {
        var seen = Set<String>()
        return accounts.map(\.provider).filter { seen.insert($0).inserted }
    }

    private static func providerName(_ id: String) -> String {
        switch id {
        case "claude": "Claude"
        case "codex": "Codex"
        default: id.capitalized
        }
    }

    private func load() async {
        do {
            accounts = try await app.client.poolAccounts()
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }
}

struct AccountUsage: View {
    let account: PoolAccount

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.label ?? account.id).lineLimit(1)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(statusText)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(statusColor.opacity(0.15), in: .capsule)
                    .foregroundStyle(statusColor)
            }
            ForEach(account.gauges, id: \.label) { gauge in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(gauge.label)
                        Spacer()
                        Text(gauge.used, format: .percent.precision(.fractionLength(0)))
                            .monospacedDigit()
                    }
                    .font(.footnote)
                    ProgressView(value: min(max(gauge.used, 0), 1))
                        .tint(Self.color(gauge.used))
                    if let reset = gauge.resetAt, reset / 1000 > Date.now.timeIntervalSince1970 {
                        Text("Resets \(Date(timeIntervalSince1970: reset / 1000), format: .relative(presentation: .named))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            if let error = account.error, !error.isEmpty {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        var parts: [String] = []
        if let plan = account.subscriptionType { parts.append(plan.capitalized) }
        if let inFlight = account.inFlight, inFlight > 0 { parts.append("\(inFlight) running") }
        if let held = account.heldUntil, held / 1000 > Date.now.timeIntervalSince1970 {
            parts.append("held until " + Date(timeIntervalSince1970: held / 1000).formatted(date: .omitted, time: .shortened))
        }
        return parts.isEmpty ? " " : parts.joined(separator: " · ")
    }

    private var statusText: String {
        account.enabled ? account.status.capitalized : "Disabled"
    }

    private var statusColor: Color {
        guard account.enabled else { return .secondary }
        switch account.status {
        case "ready": return .green
        case "held": return .orange
        case "exhausted", "error": return .red
        default: return .secondary
        }
    }

    static func color(_ used: Double) -> Color {
        used >= 0.9 ? .red : used >= 0.7 ? .orange : .accentColor
    }
}
