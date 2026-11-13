import SwiftUI

struct ServerGate: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if model.serverURL == ServerScope.unconfiguredURL {
            ServerSetupView()
        } else {
            RootView()
        }
    }
}

struct ServerSetupView: View {
    @EnvironmentObject private var model: AppModel
    @State private var serverURL = ""
    @State private var status: String?
    @State private var checking = false
    /// The address that didn't answer, offered with Use Anyway.
    @State private var unreachable: URL?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("studio.tailnet.ts.net", text: $serverURL, axis: .vertical)
                        .accessibilityLabel("BB Studio server address")
                        .accessibilityIdentifier("setupServerURL")
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onSubmit(connect)
                    Button(action: connect) {
                        if checking { ProgressView() } else { Text("Connect") }
                    }
                    .accessibilityIdentifier("setupConnect")
                    .disabled(checking || serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if let status { Text(status).font(.footnote).foregroundStyle(.red) }
                    if let unreachable {
                        Button("Use Anyway") { model.setServerURL(unreachable) }
                            .accessibilityIdentifier("setupUseAnyway")
                    }
                } header: {
                    Text("BB Studio server").foregroundStyle(Color.primary.opacity(0.75))
                } footer: {
                    Text("BB Studio's Tailscale Serve address, such as studio.tailnet.ts.net (https:// is added). BB has no client auth, so the tailnet is the boundary. You can change it later in Settings.")
                        .foregroundStyle(Color.primary.opacity(0.75))
                }
            }
            .navigationTitle("BB Studio")
        }
    }

    private func connect() {
        guard let url = ServerAddress.parse(serverURL) else {
            status = "Not a valid address"
            unreachable = nil
            return
        }
        serverURL = url.absoluteString
        checking = true
        status = nil
        unreachable = nil
        Task {
            let problem = await ServerAddress.check(url)
            checking = false
            if let problem {
                status = problem
                unreachable = url
            } else {
                model.setServerURL(url)
            }
        }
    }
}
