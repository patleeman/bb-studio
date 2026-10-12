import SwiftUI

/// The cadence, time and cron fields a heartbeat is set with, used by the Bot's
/// check-ins.
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

/// Sets the check-ins (heartbeat) that wake the Bot (`bot_set_run`).
struct BotHeartbeatSheet: View {
    var saved: () async -> Void = {}
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    @Environment(\.dismiss) private var dismiss
    @State private var bot: BotInfo?
    @State private var loaded = false
    @State private var beating = false
    @State private var cadence = "hourly"
    @State private var time = Date()
    @State private var cron = ""
    @State private var busy = false
    @State private var error: String?

    private var hasBot: Bool { bot?.lead.threadId != nil && bot?.state == .active }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Check-ins", isOn: $beating).disabled(!hasBot)
                    if beating, hasBot { HeartbeatFields(cadence: $cadence, time: $time, cron: $cron) }
                } footer: {
                    Text(!loaded ? "Loading…" : hasBot ? "Wakes \(bot?.name ?? BotInfo.defaultName) on this schedule." : bot == nil ? "Make a Bot to turn on its check-ins." : "Resume \(bot?.name ?? BotInfo.defaultName) to turn on its check-ins.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Check-ins")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(busy || !hasBot || (beating && cadence == "custom" && cron.trimmingCharacters(in: .whitespaces).isEmpty))
                }
            }
        }
        .task {
            do {
                bot = try await app.client.bot()
            } catch {
                self.error = BBClient.describe(error, server: app.client.baseURL)
            }
            loaded = true
            beating = bot?.lead.heartbeat != nil
            cadence = bot?.lead.heartbeat ?? "hourly"
            cron = bot?.lead.cron ?? ""
            if let parsed = HeartbeatFields.date(bot?.lead.time) { time = parsed }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await operation.run(currentServer: { app.serverURL }, work: { client in
                let custom = cadence == "custom" ? cron.trimmingCharacters(in: .whitespaces) : nil
                try await client.setBotHeartbeat(enabled: beating, cadence: cadence, time: HeartbeatFields.text(time), cron: custom)
            }, completion: { _ in
                Task { await saved() }
                dismiss()
            })
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
