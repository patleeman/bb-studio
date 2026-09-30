import SwiftUI

/// Find in thread: a field with the match count and arrows to step through
/// matches, newest first.
struct FindBar: View {
    @Binding var query: String
    @Binding var index: Int
    let count: Int
    /// Earlier pages are still loading, so the count may grow.
    let loading: Bool
    let done: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Find in thread", text: $query)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onSubmit(earlier)
                if loading {
                    ProgressView().controlSize(.small)
                } else if query.count >= 2 {
                    Text(count == 0 ? "None" : "\(index + 1) of \(count)")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.fill.tertiary, in: .capsule)
            Button(action: earlier) { Image(systemName: "chevron.up") }
                .disabled(count == 0)
                .keyboardShortcut("g", modifiers: .command)
                .accessibilityLabel("Earlier match")
            Button(action: later) { Image(systemName: "chevron.down") }
                .disabled(count == 0)
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .accessibilityLabel("Later match")
            Button("Done", action: done)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
        .onAppear { focused = true }
    }

    private func earlier() {
        if count > 0 { index = (index + 1) % count }
    }

    private func later() {
        if count > 0 { index = (index - 1 + count) % count }
    }
}
