import SwiftUI

/// Search in the bar's drawer on the iPhone; on the Duo, whose pushed screens
/// have no bar, a field at the top of the page.
struct ShellSearchable: ViewModifier {
    @Binding var text: String
    let prompt: String
    @Environment(\.shellPosture) private var posture

    func body(content: Content) -> some View {
        if posture.usesRail {
            VStack(spacing: 0) {
                ShellSearchField(text: $text, prompt: prompt)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("shellSearch")
                content
            }
        } else {
            content.searchable(text: $text, placement: .navigationBarDrawer(displayMode: .automatic), prompt: prompt)
        }
    }
}

extension View {
    func shellSearchable(text: Binding<String>, prompt: String) -> some View {
        modifier(ShellSearchable(text: text, prompt: prompt))
    }
}

/// The one search field: a magnifying glass, the field, and Clear once
/// something is typed. Home's, Memory's and a pushed page's on the Duo.
struct ShellSearchField: View {
    @Binding var text: String
    let prompt: String
    var id = "shellSearchField"
    /// The caller's focus (Home's Search button), else the field's own.
    var focused: FocusState<Bool>.Binding?
    var focusOnAppear = false
    @FocusState private var ownFocus: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(prompt, text: $text)
                .focused(focused ?? $ownFocus)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier(id)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 38)
        .background(.fill.tertiary, in: .rect(cornerRadius: 10, style: .continuous))
        .onAppear { if focusOnAppear { ownFocus = true } }
    }
}
