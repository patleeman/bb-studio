import SwiftUI
import UIKit

/// The message field. A `UITextView` rather than a `TextField` so Paste takes
/// images (as attachments) as well as text. Grows to `maxLines`, then scrolls.
struct ComposerField: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    var placeholder = "Message"
    var maxLines = 6
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

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        view.dataDetectorTypes = [.link]
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }
}
