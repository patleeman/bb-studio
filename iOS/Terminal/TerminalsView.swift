import SwiftUI

/// The terminals in one scope: a thread's workspace or a machine.
struct TerminalsView: View {
    let scope: TerminalScope
    var title = "Terminals"
    @EnvironmentObject private var app: AppModel
    @State private var sessions: [TerminalSession]?
    @State private var error: String?
    @State private var askingCommand = false
    @State private var command = ""
    @State private var opening: String?

    var body: some View {
        List {
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            Section {
                Button { Task { await create(command: nil) } } label: {
                    Label("New Terminal", systemImage: "plus.rectangle")
                }
                .accessibilityIdentifier("newTerminal")
                Button { askingCommand = true } label: { Label("Run a Command…", systemImage: "play.rectangle") }
            }
            if let sessions {
                let running = sessions.filter(\.isActive)
                let ended = sessions.filter { !$0.isActive }
                if !running.isEmpty {
                    Section("Running") { ForEach(running) { row($0) } }
                }
                if !ended.isEmpty {
                    Section("Ended") { ForEach(ended) { row($0) } }
                }
                if sessions.isEmpty {
                    Text("No terminals yet. They keep running on the machine after you leave.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(title)
        .navigationDestination(item: $opening) { TerminalScreen(terminalId: $0) }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: opening) { _, id in if id == nil { Task { await load() } } }
        .alert("Run a command", isPresented: $askingCommand) {
            TextField("pnpm dev", text: $command)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {}
            Button("Run") { Task { await create(command: command) } }
        } message: {
            Text("It runs in a new terminal that stays open after it finishes.")
        }
    }

    private func row(_ session: TerminalSession) -> some View {
        Button { opening = session.id } label: {
            HStack {
                Image(systemName: "apple.terminal")
                    .foregroundStyle(session.isActive ? .green : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.title).foregroundStyle(.primary).lineLimit(1)
                    Text("\(session.statusLabel) · \(session.shortCwd) · \(session.cols)×\(session.rows)")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text(Date(timeIntervalSince1970: session.updatedAt / 1000), style: .relative)
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .accessibilityIdentifier("terminalRow")
        .swipeActions {
            if session.isActive {
                Button(role: .destructive) { Task { await close(session) } } label: { Label("Close", systemImage: "xmark") }
            }
        }
    }

    private func load() async {
        do {
            sessions = try await app.client.terminals(scope).sorted { $0.updatedAt > $1.updatedAt }
            error = nil
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func create(command: String?) async {
        // SwiftTerm resizes it to the screen once it attaches.
        do {
            let session = try await app.client.createTerminal(scope, cols: 60, rows: 30, command: command)
            self.command = ""
            opening = session.id
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func close(_ session: TerminalSession) async {
        do {
            try await app.client.closeTerminal(session.id)
            await load()
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

/// Machines to open a terminal on.
struct MachinesView: View {
    @EnvironmentObject private var app: AppModel
    @State private var hosts: [BBHost]?
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            if let hosts {
                ForEach(hosts) { host in
                    NavigationLink(value: Route.terminals(scope: .host(host.id, cwd: nil), title: host.name)) {
                        Label {
                            VStack(alignment: .leading) {
                                Text(host.name)
                                Text(host.isConnected ? "Connected" : "Offline").font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "desktopcomputer").foregroundStyle(host.isConnected ? .green : .secondary)
                        }
                    }
                    .disabled(!host.isConnected)
                }
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Terminals")
        .task {
            do { hosts = try await app.client.hosts() } catch {
                self.error = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }
}
