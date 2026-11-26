import SwiftUI

/// A thin divider with the strand's name where the conversation changes strand
/// (desktop's timeline divider); tapping it shows only that strand.
struct StrandDividerRow: View {
    let title: String
    var only: (() -> Void)?

    var body: some View {
        Button { only?() } label: {
            HStack(spacing: 8) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                Rectangle().fill(.separator).frame(height: 0.5)
            }
            .padding(.top, 10).padding(.bottom, 2)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(only == nil)
        .accessibilityLabel("Strand: \(title)")
        .accessibilityHint(only == nil ? "" : "Shows only this strand")
        .accessibilityIdentifier("strandDivider")
    }
}

/// "N other messages" where "Only this strand" hides another strand's messages.
struct StrandGapRow: View {
    let count: Int

    var body: some View {
        HStack(spacing: 10) {
            Rectangle().fill(.separator).frame(height: 0.5)
            Text("\(count) other message\(count == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary).fixedSize()
            Rectangle().fill(.separator).frame(height: 0.5)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("strandGap")
    }
}

/// While the conversation shows only one strand: its name and ✕ to show everything.
struct StrandFilterBar: View {
    let title: String
    let clear: () -> Void
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal.decrease").font(.footnote).foregroundStyle(.secondary)
            Text("Only: \(title)").font(.footnote.weight(.medium)).lineLimit(1)
            Spacer(minLength: 4)
            Button(action: clear) {
                Image(systemName: "xmark").font(.footnote.weight(.semibold)).frame(width: 44, height: 36).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show all messages")
            .accessibilityIdentifier("strandFilterClear")
        }
        .padding(.leading, 12)
        .background(look.stackFill, in: .capsule)
        .overlay(Capsule().strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("strandFilter")
    }
}
