import SwiftUI

/// Desktop's New project on a phone: pick the machine, then type or browse to
/// the project's folder there. The name defaults to the folder's.
struct NewProjectView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    let onCreate: (Project) -> Void

    @State private var hosts: [BBHost] = []
    @State private var hostId = ""
    @State private var path = ""
    @State private var name = ""
    @State private var listing: HostDirectoryListing?
    @State private var browsePath: String?
    @State private var browseError: String?
    @State private var loadingHosts = true
    @State private var creating = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Machine") {
                    if loadingHosts {
                        ProgressView()
                    } else if hosts.isEmpty {
                        Text("BB has no machines to put a project on.").foregroundStyle(.secondary)
                    } else {
                        Picker("Machine", selection: $hostId) {
                            ForEach(hosts) { host in
                                Text(host.isConnected ? host.name : "\(host.name) (offline)").tag(host.id)
                            }
                        }
                        .accessibilityIdentifier("newProjectMachine")
                    }
                }
                Section {
                    TextField(pathPlaceholder, text: $path)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        .accessibilityIdentifier("newProjectPath")
                    TextField(ProjectPath.projectName(path).isEmpty ? "Name" : ProjectPath.projectName(path), text: $name)
                        .accessibilityIdentifier("newProjectName")
                } header: {
                    Text("Folder")
                } footer: {
                    if let message = pathMessage { Text(message) } else { Text("The name defaults to the folder's.") }
                }
                if !hostId.isEmpty { browser }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("New project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { operation.complete(on: app) { dismiss() } } }
                ToolbarItem(placement: .confirmationAction) {
                    if creating {
                        ProgressView()
                    } else {
                        Button("Create") { Task { await create() } }
                            .disabled(!canCreate)
                            .accessibilityIdentifier("newProjectCreate")
                    }
                }
            }
            .task {
                defer { loadingHosts = false }
                do {
                    hosts = try await client.hosts().filter(\.isUsable)
                    hostId = BBHost.defaultHost(hosts)?.id ?? ""
                } catch {
                    self.error = BBClient.describe(error, server: client.baseURL)
                }
            }
            .task(id: "\(hostId)|\(browsePath ?? "")") { await browse() }
            .onChange(of: hostId) { browsePath = nil }
        }
    }

    /// The machine's folders, starting at its home folder. Tapping one opens
    /// it and makes it the project folder.
    private var browser: some View {
        Section {
            if let listing {
                if let parent = listing.parent {
                    Button { open(parent) } label: { Label("Up", systemImage: "arrow.turn.left.up") }
                }
                ForEach(listing.folders) { folder in
                    Button { open(folder.path) } label: {
                        Label(folder.name, systemImage: "folder").foregroundStyle(.primary)
                    }
                }
                if listing.folders.isEmpty { Text("No folders").foregroundStyle(.secondary) }
            } else if let browseError {
                Text(browseError).foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        } header: {
            Text(listing?.directory ?? "Browse")
                .textCase(nil)
                .lineLimit(1)
                .truncationMode(.head)
        }
    }

    private var selectedHost: BBHost? { hosts.first { $0.id == hostId } }

    private var pathPlaceholder: String {
        (listing?.directory).map { ProjectPath.normalize($0).contains("\\") ? "C:\\path\\to\\project" : "/path/to/project" }
            ?? "/path/to/project"
    }

    private var pathMessage: String? {
        path.trimmingCharacters(in: .whitespaces).isEmpty ? nil : ProjectPath.validationMessage(path)
    }

    private var canCreate: Bool {
        !creating && selectedHost != nil && ProjectPath.validationMessage(path) == nil
            && !(name.trimmingCharacters(in: .whitespaces).isEmpty && ProjectPath.projectName(path).isEmpty)
    }

    private func open(_ folder: String) {
        browsePath = folder
        path = folder
    }

    private func browse() async {
        guard !hostId.isEmpty else { return }
        browseError = nil
        do {
            listing = try await client.hostDirectory(hostId: hostId, path: browsePath)
        } catch where BBClient.isCancellation(error) {
        } catch {
            listing = nil
            browseError = selectedHost?.isConnected == false
                ? "This machine is offline. Type the folder's path."
                : BBClient.describe(error, server: client.baseURL)
        }
    }

    private func create() async {
        creating = true
        defer { creating = false }
        error = nil
        let (name, hostId, path) = (self.name, self.hostId, self.path)
        do {
            try await operation.run(currentServer: { app.serverURL }, work: { client in
                try await client.createProject(name: name, hostId: hostId, path: path)
            }, completion: { project in
                onCreate(project)
                dismiss()
            })
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}
