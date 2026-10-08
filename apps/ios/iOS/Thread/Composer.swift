import SwiftUI
import UIKit

/// The message field. A `UITextView` rather than a `TextField` so Paste takes
/// images (as attachments) as well as text. Grows to `maxLines`, then scrolls.
struct ComposerField: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    var placeholder = "Message"
    var maxLines = 6
    /// Room on the right for a button over the field.
    var trailingInset: CGFloat = 12
    var onPasteImages: ([UIImage]) -> Void

    func makeUIView(context: Context) -> PastingTextView {
        let view = PastingTextView()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        view.textContainer.lineFragmentPadding = 0
        view.isScrollEnabled = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityLabel = placeholder
        view.placeholder.text = placeholder
        return view
    }

    func updateUIView(_ view: PastingTextView, context: Context) {
        context.coordinator.parent = self
        view.onPasteImages = onPasteImages
        if view.textContainerInset.right != trailingInset {
            view.textContainerInset.right = trailingInset
            view.invalidateIntrinsicContentSize()
        }
        if view.text != text {
            view.text = text
            view.placeholder.isHidden = !text.isEmpty
        }
        if focused, !view.isFirstResponder, view.window != nil {
            DispatchQueue.main.async { view.becomeFirstResponder() }
        } else if !focused, view.isFirstResponder {
            DispatchQueue.main.async { view.resignFirstResponder() }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView view: PastingTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
        let fitting = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let font = view.font ?? .preferredFont(forTextStyle: .body)
        let limit = font.lineHeight * CGFloat(maxLines) + view.textContainerInset.top + view.textContainerInset.bottom
        let scrolls = fitting.height > limit
        if view.isScrollEnabled != scrolls { DispatchQueue.main.async { view.isScrollEnabled = scrolls } }
        return CGSize(width: width, height: min(fitting.height, limit))
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerField
        init(_ parent: ComposerField) { self.parent = parent }

        func textViewDidChange(_ view: UITextView) {
            parent.text = view.text
            (view as? PastingTextView)?.placeholder.isHidden = !view.text.isEmpty
        }

        func textViewDidBeginEditing(_ view: UITextView) {
            if !parent.focused { parent.focused = true }
        }

        func textViewDidEndEditing(_ view: UITextView) {
            if parent.focused { parent.focused = false }
        }
    }
}

/// The message box, as in ChatGPT: one card with any attachments, the field
/// at full width, and a row under it with + (attach), the agent's settings,
/// dictation and `send`.
struct ComposerBar<Settings: View, Send: View>: View {
    @Binding var text: String
    @Binding var focused: Bool
    @Binding var attachments: [PendingAttachment]
    var placeholder = "Message"
    var maxLines = 6
    let dictate: () -> Void
    /// Hold the mic to talk and send; tapping it still dictates.
    var talk: HoldToTalk?
    /// Opens the draft on a whole screen; shown only when set.
    var expand: (() -> Void)?
    @ViewBuilder let settings: () -> Settings
    @ViewBuilder let send: () -> Send

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AttachmentStrip(items: $attachments)
                .padding([.horizontal, .top], 10)
            ComposerField(text: $text, focused: $focused, placeholder: placeholder, maxLines: maxLines, trailingInset: expand == nil ? 12 : 36) { images in
                attachments += images.compactMap { PendingAttachment.image($0, name: "pasted.jpg") }
            }
            .padding(.top, 4)
            .overlay {
                if let talk { TalkOverlay(talk: talk) }
            }
            .overlay(alignment: .topTrailing) {
                if let expand {
                    Button(action: expand) {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.caption.weight(.semibold))
                            .frame(width: 36, height: 32)
                    }
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Expand")
                }
            }
            HStack(spacing: 2) {
                AttachmentMenu(items: $attachments, symbol: "plus")
                settings()
                Spacer(minLength: 4)
                if let talk {
                    HoldToTalkMic(talk: talk, tap: dictate)
                } else {
                    Button(action: dictate) {
                        Image(systemName: "mic").font(.title3).frame(width: 36, height: 36)
                    }
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Dictate")
                }
                send()
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 6)
        }
        .background(.fill.tertiary, in: .rect(cornerRadius: 22))
    }
}

/// Covers the field while talking, so the draft underneath stays put.
private struct TalkOverlay: View {
    @ObservedObject var talk: HoldToTalk

    var body: some View {
        if talk.state != .idle {
            HoldToTalkStatus(talk: talk, cancel: talk.cancel)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .background(.background.secondary, in: .rect(cornerRadius: 16))
                .padding(.horizontal, 4)
                .transition(.opacity)
        }
    }
}

/// The composer's agent button: a gauge and the model (with its reasoning level), as ChatGPT shows its own.
struct ComposerSettingsLabel: View {
    let title: String?

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "gauge.with.dots.needle.67percent")
            if let title, !title.isEmpty { Text(title).lineLimit(1) }
        }
        .font(.subheadline)
        // Grey, not the button's tint.
        .foregroundStyle(Color(uiColor: .secondaryLabel))
        .padding(.horizontal, 8)
        .frame(height: 36)
        .contentShape(.rect)
    }
}

final class PastingTextView: UITextView {
    var onPasteImages: (([UIImage]) -> Void)?
    let placeholder = UILabel()

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        placeholder.font = .preferredFont(forTextStyle: .body)
        placeholder.adjustsFontForContentSizeCategory = true
        placeholder.textColor = .placeholderText
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        addSubview(placeholder)
        NSLayoutConstraint.activate([
            placeholder.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            placeholder.topAnchor.constraint(equalTo: topAnchor, constant: 8),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), UIPasteboard.general.hasImages { return true }
        return super.canPerformAction(action, withSender: sender)
    }

    /// Images become attachments; any text on the pasteboard is pasted as usual.
    override func paste(_ sender: Any?) {
        let board = UIPasteboard.general
        if board.hasImages, let images = board.images, !images.isEmpty {
            onPasteImages?(images)
            if board.hasStrings, board.string?.hasPrefix("http") == false { super.paste(sender) }
            return
        }
        super.paste(sender)
    }
}

/// Lets the user select part of a message; SwiftUI's `Text` only selects all of it.
struct SelectableText: UIViewRepresentable {
    let text: String
    @Binding var selection: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        view.dataDetectorTypes = [.link]
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        let parent: SelectableText
        init(_ parent: SelectableText) { self.parent = parent }

        func textViewDidChangeSelection(_ textView: UITextView) {
            let range = textView.selectedRange
            guard range.length > 0, let selected = Range(range, in: textView.text) else {
                parent.selection = ""
                return
            }
            parent.selection = String(textView.text[selected])
        }
    }
}
