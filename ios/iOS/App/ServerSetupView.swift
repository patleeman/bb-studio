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

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://machine.tailnet.ts.net", text: $serverURL, axis: .vertical)
                        .accessibilityLabel("BB server URL")
                        .accessibilityIdentifier("setupServerURL")
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onSubmit(connect)
                    Button("Connect", action: connect)
                        .accessibilityIdentifier("setupConnect")
                        .disabled(serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if let status { Text(status).font(.footnote).foregroundStyle(.red) }
                } header: {
                    Text("BB server").foregroundStyle(Color.primary.opacity(0.75))
                } footer: {
                    Text("Reached over Tailscale Serve. BB has no client auth, so the tailnet is the boundary. You can change it later in Settings.")
                        .foregroundStyle(Color.primary.opacity(0.75))
                }
            }
            .navigationTitle("BB Studio")
        }
    }

    private func connect() {
        let text = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host() != nil else {
            status = "Not a valid URL"
            return
        }
        model.setServerURL(url)
    }
}
