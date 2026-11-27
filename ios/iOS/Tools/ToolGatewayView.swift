import SwiftUI

extension BBClient {
    public func toolGatewayOverview() async throws -> Studio.ToolGatewayOverviewOutput {
        try await rpc("studio", Studio.Method.toolGateway_overview, .null)
    }
}

/// Studio's Tool Gateway, view-only (`toolGateway.overview`): the MCP servers
/// it runs for every agent, with their status and tool count, and the
/// requests waiting for approval. Adding, approving and changing happen on the
/// desktop: those methods only answer the app window.
struct ToolGatewayView: View {
    @Environment(\.look) private var look
    @EnvironmentObject private var app: AppModel
    @State private var overview: Studio.ToolGatewayOverviewOutput?
    @State private var error: String?

    var body: some View {
        List {
            if let error {
                Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary) }
            }
            if let requests = overview?.requests, !requests.isEmpty {
                Section {
                    ForEach(requests, id: \.id) { request in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(request.label ?? "A tool").font(.body.weight(.semibold))
                            if let why = request.why, !why.isEmpty { Text(why).font(.footnote).foregroundStyle(.secondary) }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("gatewayRequest")
                    }
                } header: {
                    Text("Waiting for approval")
                } footer: {
                    Text("Approve or decline on the desktop.")
                }
            }
            Section("Servers") {
                if let servers = overview?.servers, !servers.isEmpty {
                    ForEach(servers, id: \.id) { server in
                        HStack(spacing: 10) {
                            Circle().fill(Self.color(server.status, enabled: server.enabled ?? true, needsYou: look.needsYou)).frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(server.label ?? server.id ?? "Server")
                                Text(Self.status(server)).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 4)
                            if let tools = server.tools { Text("\(tools) tool\(tools == 1 ? "" : "s")").font(.footnote).foregroundStyle(.secondary) }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("gatewayServer")
                    }
                } else if overview != nil {
                    Text("No servers yet. Add them on the desktop.").foregroundStyle(.secondary)
                } else if error == nil {
                    ProgressView()
                }
            }
        }
        .navigationTitle("Tool Gateway")
        .refreshable { await load() }
        .task { await load() }
        .accessibilityIdentifier("toolGateway")
    }

    private func load() async {
        do {
            overview = try await app.client.toolGatewayOverview()
            error = nil
        } catch {
            self.error = BBClient.describe(error, plugin: "Studio", server: app.client.baseURL)
        }
    }

    static func status(_ server: Studio.ToolGatewayOverviewOutputServersItem) -> String {
        if server.enabled == false { return "Off" }
        switch server.status {
        case .running: return "Running"
        case .starting: return "Starting"
        case .needs_approval: return "Waiting for approval"
        case .needs_sign_in: return "Needs sign-in on the desktop"
        case .error: return "Error"
        case .stopped: return "Stopped"
        case .off: return "Off"
        case .unknown(let value): return value
        case nil: return ""
        }
    }

    static func color(_ status: Studio.ToolGatewayOverviewOutputServersItemStatus?, enabled: Bool, needsYou: Color) -> Color {
        guard enabled else { return .gray }
        switch status {
        case .running: return .green
        case .needs_approval, .needs_sign_in, .starting: return needsYou
        case .error: return .red
        default: return .gray
        }
    }
}
