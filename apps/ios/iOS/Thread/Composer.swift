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
    /// Told when the keyboard's dictation ends, fails, or holds a spot for a result.
    var dictation: DictationGate? = nil
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
        view.accessibilityIdentifier = "composerField"
        view.placeholder.text = placeholder
        return view
    }

    func updateUIView(_ view: PastingTextView, context: Context) {
        context.coordinator.parent = self
        view.onPasteImages = onPasteImages
        view.onDictation = { [weak dictation] event in dictation?.handle(event) }
        // "Listening…" and "Speaking…" show here, in place of a label beside the controls.
        if view.placeholder.text != placeholder {
            view.placeholder.text = placeholder
            view.accessibilityLabel = placeholder
        }
        if view.textContainerInset.right != trailingInset {
            view.textContainerInset.right = trailingInset
            view.invalidateIntrinsicContentSize()
        }
        if view.text != text {
            view.text = text
            view.placeholder.isHidden = !text.isEmpty
        }
        if focused != view.isFirstResponder, focused ? view.window != nil : true {
            context.coordinator.applyFocus(to: view)
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

        private var applyingFocus = false

        /// Takes or gives up the keyboard to match `focused`, on a later
        /// pass and once the window has stopped resizing: a responder change
        /// during a fold reloads the keyboard in the middle of its own
        /// transition (crash 3). Checked again when it runs; one at a time.
        func applyFocus(to view: UITextView) {
            guard !applyingFocus else { return }
            applyingFocus = true
            ResizeSettling.shared.afterSettling { [weak self, weak view] in
                guard let self else { return }
                applyingFocus = false
                guard let view, view.window != nil else { return }
                if parent.focused, !view.isFirstResponder {
                    Breadcrumbs.shared.focus("composer-field", "take")
                    #if DEBUG
                    RenderCount.bump("composer.become")
                    ResizeSettling.shared.reloadingKeyboard()
                    #endif
                    view.becomeFirstResponder()
                } else if !parent.focused, view.isFirstResponder {
                    Breadcrumbs.shared.focus("composer-field", "give-up")
                    #if DEBUG
                    RenderCount.bump("composer.resign")
                    ResizeSettling.shared.reloadingKeyboard()
                    #endif
                    view.resignFirstResponder()
                }
            }
        }

        func textViewDidChange(_ view: UITextView) {
            parent.text = view.text
            (view as? PastingTextView)?.placeholder.isHidden = !view.text.isEmpty
            parent.dictation?.handle(.edited)
        }

        func textViewDidBeginEditing(_ view: UITextView) {
            Breadcrumbs.shared.focus("composer-field", "began")
            if !parent.focused { parent.focused = true }
        }

        func textViewDidEndEditing(_ view: UITextView) {
            Breadcrumbs.shared.focus("composer-field", "ended")
            if parent.focused { parent.focused = false }
            // The keyboard's dictation ends with the field's focus.
            parent.dictation?.handle(.cancelled(.keyboard))
        }
    }
}

/// The message box, as in ChatGPT: one card with any attachments, the field
/// at full width, and a row under it with + (attach), the agent's settings,
/// dictation and `send`. With a `dictation` gate, VoiceOver hears "Listening…"
/// or "Transcribing…" beside `send` while words are on the way; the caller
/// disables `send` on `dictation.blocksSend`. In voice mode `pushToTalk`
/// takes the dictation mic's place.
struct ComposerBar<Settings: View, Send: View>: View {
    @Binding var text: String
    @Binding var focused: Bool
    @Binding var attachments: [PendingAttachment]
    var placeholder = "Message"
    var maxLines = 6
    let dictate: () -> Void
    /// The mic: tap to dictate inline, hold to talk and send. Without it, the mic calls `dictate`.
    var talk: HoldToTalk?
    /// Opens the draft on a whole screen; shown only when set.
    var expand: (() -> Void)?
    /// No fill of its own, for a composer on glass.
    var clear = false
    var dictation: DictationGate? = nil
    /// "Expand to page": the draft into a Notes page linked to the thread. Beside the mic.
    var toPage: ComposerPageAction? = nil
    /// Voice mode's speaker, just before the mic; nil where Studio has no voice mode.
    var voice: VoiceModeButton? = nil
    /// Voice mode's mic; when set, the dictation mic is hidden.
    var pushToTalk: PushToTalkButton? = nil
    @ViewBuilder let settings: () -> Settings
    @ViewBuilder let send: () -> Send

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AttachmentStrip(items: $attachments)
                .padding([.horizontal, .top], 10)
            ComposerField(
                text: $text, focused: $focused, placeholder: placeholder, maxLines: maxLines,
                trailingInset: expand == nil ? 12 : 36, dictation: dictation
            ) { images in
                attachments += images.compactMap { PendingAttachment.image($0, name: "pasted.jpg") }
            }
            .padding(.top, 4)
            .overlay {
                if let talk { TalkOverlay(talk: talk, dictation: dictation) }
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
                if let toPage {
                    Button(action: toPage.run) {
                        Group {
                            if toPage.busy { ProgressView() } else { Image(systemName: "note.text.badge.plus").font(.title3) }
                        }
                        .frame(width: 36, height: 36)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .foregroundStyle(.secondary)
                    .disabled(toPage.disabled || toPage.busy)
                    .accessibilityLabel(toPage.label)
                    .accessibilityIdentifier("composerExpandToPage")
                    .help(toPage.label)
                }
                if let voice { voice }
                if let pushToTalk {
                    pushToTalk
                } else if let talk {
                    HoldToTalkMic(talk: talk)
                } else {
                    Button(action: dictate) {
                        Image(systemName: "mic").font(.title3).frame(width: 36, height: 36)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Dictate")
                    .accessibilityIdentifier("composerMic")
                }
                if let dictation { DictationSendStatus(gate: dictation) }
                send()
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 6)
        }
        .background(clear ? AnyShapeStyle(.clear) : AnyShapeStyle(.fill.tertiary), in: .rect(cornerRadius: 22))
    }
}

/// The composer's "Expand to page" button.
struct ComposerPageAction {
    var label: String
    var busy = false
    var disabled = false
    var run: () -> Void
}

/// Tells the dictation gate what a talk is doing, so Send waits for its words.
/// Every talk's status shows over the composer, in the one indicator spot
/// (`TalkStatusBar`, `VoiceIndicator`), never inside the field.
private struct TalkOverlay: View {
    @ObservedObject var talk: HoldToTalk
    /// Holds Send while a talk records or transcribes.
    let dictation: DictationGate?

    var body: some View {
        Color.clear
            .allowsHitTesting(false)
            .onChange(of: talk.state) { _, state in dictation?.handle(DictationState.talk(state)) }
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
    var onDictation: ((DictationState.Event) -> Void)?
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

    // The keyboard's dictation, through UITextInput's optional methods.
    // UITextView doesn't implement these two, so there is no `super` to call.

    override func dictationRecordingDidEnd() { onDictation?(.transcribing(.keyboard)) }

    override func dictationRecognitionFailed() { onDictation?(.failed(.keyboard)) }

    // It does implement the placeholder for a result still on its way.

    override var insertDictationResultPlaceholder: Any {
        let placeholder = super.insertDictationResultPlaceholder
        onDictation?(.placeholderAdded)
        return placeholder
    }

    override func removeDictationResultPlaceholder(_ placeholder: Any, willInsertResult: Bool) {
        super.removeDictationResultPlaceholder(placeholder, willInsertResult: willInsertResult)
        onDictation?(.placeholderRemoved)
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
