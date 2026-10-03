import SwiftUI

/// A search prompt and input that can wrap at accessibility text sizes.
struct GrowingSearchField: View {
    @Binding var text: String
    var prompt: String
    var label: String
    var identifier: String
    @FocusState.Binding var isFocused: Bool
    var onSubmit: () -> Void = {}
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 8))
        layout {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").accessibilityHidden(true)
                ZStack(alignment: .leading) {
                    if text.isEmpty {
                        Text(prompt)
                            .fixedSize(horizontal: false, vertical: true)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    TextField("", text: $text, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($isFocused)
                        .submitLabel(.search)
                        .onSubmit(onSubmit)
                        .onChange(of: text) { old, new in
                            // A vertical TextField can insert a newline even
                            // with a Search return key. Search stays one query.
                            guard new.contains("\n") else { return }
                            text = new.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
                            if new.count == old.count + 1 { onSubmit() }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier(identifier)
                        .accessibilityLabel(label)
                }
                .padding(.horizontal, 4)
                .frame(minHeight: 44)
                if !text.isEmpty {
                    Button { text = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear search")
                }
            }
            .foregroundStyle(Color(.label))
            .padding(.horizontal, 8)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
            if isFocused || !text.isEmpty {
                Button("Cancel") {
                    text = ""
                    isFocused = false
                }
                .frame(minWidth: 44, minHeight: 44)
                .buttonStyle(.borderless)
                .accessibilityLabel("Cancel search")
            }
        }
    }
}
