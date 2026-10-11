import SwiftUI

/// The cadence, time and cron fields a heartbeat is set with, used by the Chief of
/// Staff's heartbeat.
struct HeartbeatFields: View {
    @Binding var cadence: String
    @Binding var time: Date
    @Binding var cron: String

    var body: some View {
        Picker("Every", selection: $cadence) {
            ForEach(ThreadLead.cadences, id: \.id) { Text($0.label).tag($0.id) }
        }
        if cadence == "custom" {
            TextField("Cron (minute hour day month weekday)", text: $cron)
                .font(.body.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        } else if ["daily", "weekdays", "weekly", "hourly", "every2hours", "every6hours"].contains(cadence) {
            DatePicker(cadence.hasPrefix("every") || cadence == "hourly" ? "At minute" : "At", selection: $time,
                displayedComponents: .hourAndMinute)
        }
    }

    static func date(_ text: String?) -> Date? {
        guard let parts = text?.split(separator: ":"), parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
        return Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now)
    }

    static func text(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 9, parts.minute ?? 0)
    }
}

/// Sets the heartbeat that wakes the Chief of Staff (`chief_of_staff_set_run`).
struct ChiefHeartbeatSheet: View {
    var saved: () async -> Void = {}
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    @Environment(\.dismiss) private var dismiss
    @State private var chief: ThreadLead?
    @State private var loaded = false
    @State private var beating = false
    @State private var cadence = "hourly"
    @State private var time = Date()
    @State private var cron = ""
    @State private var busy = false
    @State private var error: String?

    private var hasChief: Bool { chief?.threadId != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Heartbeat", isOn: $beating).disabled(!hasChief)
                    if beating, hasChief { HeartbeatFields(cadence: $cadence, time: $time, cron: $cron) }
                } footer: {
                    Text(!loaded ? "Loading…" : hasChief ? "Wakes the Chief of Staff on this schedule." : "Set a Chief of Staff to turn on the heartbeat.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Chief of Staff Heartbeat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(busy || !hasChief || (beating && cadence == "custom" && cron.trimmingCharacters(in: .whitespaces).isEmpty))
                }
            }
        }
        .task {
            do {
                chief = try await app.client.chiefOfStaff()
            } catch {
                self.error = BBClient.describe(error, server: app.client.baseURL)
            }
            loaded = true
            beating = chief?.heartbeat != nil
            cadence = chief?.heartbeat ?? "hourly"
            cron = chief?.cron ?? ""
            if let parsed = HeartbeatFields.date(chief?.time) { time = parsed }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await operation.run(currentServer: { app.serverURL }, work: { client in
                let custom = cadence == "custom" ? cron.trimmingCharacters(in: .whitespaces) : nil
                try await client.setChiefOfStaffHeartbeat(enabled: beating, cadence: cadence, time: HeartbeatFields.text(time), cron: custom)
            }, completion: { _ in
                Task { await saved() }
                dismiss()
            })
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
