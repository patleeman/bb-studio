import SwiftUI

/// Picks when a scheduled message goes out.
struct SendTimePicker: View {
    struct Preset {
        let title: String
        let date: () -> Date
    }

    static let presets: [Preset] = [
        Preset(title: "In 30 Minutes") { .now.addingTimeInterval(30 * 60) },
        Preset(title: "In 1 Hour") { .now.addingTimeInterval(60 * 60) },
        Preset(title: "In 3 Hours") { .now.addingTimeInterval(3 * 60 * 60) },
        Preset(title: "Tomorrow at 9 AM") { nextMorning() },
    ]

    let schedule: (Date) -> Void
    @State private var date = Date.now.addingTimeInterval(60 * 60)
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Send at", selection: $date, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
                    .datePickerStyle(.graphical)
            }
            .navigationTitle("Send Later")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Schedule") { schedule(max(date, .now)) }
                }
            }
        }
        .presentationDetents([.large])
    }

    private static func nextMorning() -> Date {
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: .now) ?? .now
        return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
    }
}
