import SwiftUI

/// Native search in the bar's drawer, with a Search button in the bar that
/// opens it in one tap (the drawer hides until the list is pulled down).
struct ShellSearchable: ViewModifier {
    @Binding var text: String
    let prompt: String
    @State private var searching = false

    func body(content: Content) -> some View {
        content
            .searchable(text: $text, isPresented: $searching, placement: .navigationBarDrawer(displayMode: .automatic), prompt: prompt)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { searching = true } label: { Image(systemName: "magnifyingglass") }
                        .accessibilityLabel("Search")
                        .accessibilityIdentifier("screenAction-search")
                }
            }
    }
}

extension View {
    func shellSearchable(text: Binding<String>, prompt: String) -> some View {
        modifier(ShellSearchable(text: text, prompt: prompt))
    }
}

/// The one search field: a magnifying glass, the field, and Clear once
/// something is typed: in a page, where a bar's drawer doesn't fit (Memory's History).
struct ShellSearchField: View {
    @Binding var text: String
    let prompt: String
    var id = "shellSearchField"
    var focusOnAppear = false
    @FocusState private var ownFocus: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(prompt, text: $text)
                .focused($ownFocus)
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
