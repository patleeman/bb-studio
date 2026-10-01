import SwiftUI
import UIKit

/// Commands from the editor's toolbar to the text view, at the cursor.
@MainActor
final class PageTextController {
    fileprivate weak var view: UITextView?

    /// Swaps the current line's Markdown prefix (`# `, `- [ ] `, …) for `prefix`.
    func setLinePrefix(_ prefix: String) {
        guard let view else { return }
        let text = view.text as NSString
        let line = text.lineRange(for: NSRange(location: min(view.selectedRange.location, text.length), length: 0))
        let content = text.substring(with: line)
        let stripped = PageMarkdownStyle.prefix(of: content).map { String(content.dropFirst($0.count)) } ?? content
        replace(line, with: prefix + stripped, cursorAtEnd: false)
        view.selectedRange = NSRange(location: line.location + (prefix + stripped).utf16.count - (stripped.hasSuffix("\n") ? 1 : 0), length: 0)
    }

    func insert(_ string: String) {
        guard let view else { return }
        replace(view.selectedRange, with: string, cursorAtEnd: true)
    }

    fileprivate func replace(_ range: NSRange, with string: String, cursorAtEnd: Bool) {
        guard let view, let start = view.position(from: view.beginningOfDocument, offset: range.location),
              let end = view.position(from: start, offset: range.length),
              let textRange = view.textRange(from: start, to: end) else { return }
        // Through UITextInput, so the edit is undoable and reaches the delegate.
        view.replace(textRange, withText: string)
        if cursorAtEnd { view.selectedRange = NSRange(location: range.location + string.utf16.count, length: 0) }
    }
}

/// The whole page as one continuous Markdown text, styled as you type:
/// headings are larger, list markers recede, and checkboxes toggle on tap.
struct PageTextView: UIViewRepresentable {
    @Binding var text: String
    let controller: PageTextController

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.font = PageMarkdownStyle.body
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 12, left: 16, bottom: 24, right: 16)
        view.alwaysBounceVertical = true
        view.keyboardDismissMode = .interactive
        view.accessibilityIdentifier = "pageEditor"
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)
        controller.view = view
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        guard view.text != text else { return }
        let selection = view.selectedRange
        view.text = text
        PageMarkdownStyle.apply(to: view)
        view.selectedRange = NSRange(location: min(selection.location, (text as NSString).length), length: 0)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: PageTextView
        init(_ parent: PageTextView) { self.parent = parent }

        func textViewDidChange(_ view: UITextView) {
            PageMarkdownStyle.apply(to: view)
            parent.text = view.text
        }

        /// Return continues a list with the next item; Return on an empty item ends the list.
        func textView(_ view: UITextView, shouldChangeTextIn range: NSRange, replacementText string: String) -> Bool {
            guard string == "\n", range.length == 0 else { return true }
            let text = view.text as NSString
            let line = text.lineRange(for: NSRange(location: range.location, length: 0))
            let content = text.substring(with: NSRange(location: line.location, length: range.location - line.location))
            guard let prefix = PageMarkdownStyle.listPrefix(of: content) else { return true }
            if content == prefix {
                parent.controller.replace(NSRange(location: line.location, length: prefix.utf16.count), with: "", cursorAtEnd: true)
            } else {
                parent.controller.replace(range, with: "\n" + PageMarkdownStyle.next(prefix), cursorAtEnd: true)
            }
            return false
        }

        /// A tap on a checklist item's box toggles it instead of moving the cursor.
        @objc func tapped(_ tap: UITapGestureRecognizer) {
            guard let view = tap.view as? UITextView, let box = checkbox(at: tap.location(in: view), in: view) else { return }
            let checked = (view.text as NSString).substring(with: box) != "[ ]"
            parent.controller.replace(box, with: checked ? "[ ]" : "[x]", cursorAtEnd: false)
        }

        func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let view = gesture.view as? UITextView else { return false }
            return checkbox(at: touch.location(in: view), in: view) != nil
        }

        func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { false }

        private func checkbox(at point: CGPoint, in view: UITextView) -> NSRange? {
            guard let position = view.closestPosition(to: point) else { return nil }
            let text = view.text as NSString
            let offset = view.offset(from: view.beginningOfDocument, to: position)
            let line = text.lineRange(for: NSRange(location: min(offset, text.length), length: 0))
            guard let box = PageMarkdownStyle.checkbox(in: text.substring(with: line)) else { return nil }
            let range = NSRange(location: line.location + box.location, length: box.length)
            // Generous: anywhere from the line start through the box.
            return offset <= range.location + range.length + 1 ? range : nil
        }
    }
}

/// Live Markdown styling for the page editor. The text stays plain Markdown.
enum PageMarkdownStyle {
    static var body: UIFont { .preferredFont(forTextStyle: .body) }

    private static let prefixes = ["- [ ] ", "- [x] ", "- [X] ", "### ", "## ", "# ", "- ", "* ", "> "]

    /// The line's block prefix, ignoring indentation and numbered lists' digits.
    static func prefix(of line: String) -> String? {
        let indent = String(line.prefix { $0 == " " })
        let rest = line.dropFirst(indent.count)
        if let match = prefixes.first(where: { rest.hasPrefix($0) }) { return indent + match }
        if let number = rest.firstMatch(of: #/^\d+\. /#) { return indent + String(number.output) }
        return nil
    }

    /// The prefix of a bulleted, numbered, or checklist line.
    static func listPrefix(of line: String) -> String? {
        guard let prefix = prefix(of: line), !prefix.hasSuffix("# "), !prefix.hasSuffix("> ") else { return nil }
        return prefix
    }

    /// The prefix for the item after one with `prefix`: unchecked, or numbered one higher.
    static func next(_ prefix: String) -> String {
        let indent = String(prefix.prefix { $0 == " " })
        let marker = prefix.dropFirst(indent.count)
        if marker.hasSuffix("] ") { return indent + "- [ ] " }
        if let number = Int(marker.dropLast(2)) { return indent + "\(number + 1). " }
        return prefix
    }

    /// The `[ ]` or `[x]` in a checklist line.
    static func checkbox(in line: String) -> NSRange? {
        guard let prefix = prefix(of: line), prefix.hasSuffix("] ") else { return nil }
        return NSRange(location: prefix.utf16.count - 4, length: 3)
    }

    @MainActor
    static func apply(to view: UITextView) {
        let storage = view.textStorage
        let text = storage.string as NSString
        storage.beginEditing()
        storage.setAttributes([.font: body, .foregroundColor: UIColor.label], range: NSRange(location: 0, length: text.length))
        var inFence = false
        text.enumerateSubstrings(in: NSRange(location: 0, length: text.length), options: .byLines) { line, range, _, _ in
            guard let line else { return }
            if line.hasPrefix("```") {
                inFence.toggle()
                storage.addAttributes([.font: mono, .foregroundColor: UIColor.secondaryLabel], range: range)
                return
            }
            if inFence {
                storage.addAttribute(.font, value: mono, range: range)
                return
            }
            guard let prefix = prefix(of: line) else { return }
            let marker = NSRange(location: range.location, length: prefix.utf16.count)
            switch prefix.trimmingCharacters(in: .whitespaces) {
            case "#": storage.addAttribute(.font, value: heading(.title1), range: range)
            case "##": storage.addAttribute(.font, value: heading(.title2), range: range)
            case "###": storage.addAttribute(.font, value: heading(.title3), range: range)
            case "- [x]", "- [X]":
                storage.addAttributes([.foregroundColor: UIColor.secondaryLabel, .strikethroughStyle: NSUnderlineStyle.single.rawValue], range: range)
            default: break
            }
            storage.addAttribute(.foregroundColor, value: prefix.hasSuffix("] ") ? UIColor.tintColor : UIColor.tertiaryLabel, range: marker)
        }
        storage.endEditing()
        view.typingAttributes = [.font: body, .foregroundColor: UIColor.label]
    }

    private static var mono: UIFont {
        UIFontMetrics(forTextStyle: .body).scaledFont(for: .monospacedSystemFont(ofSize: 15, weight: .regular))
    }

    private static func heading(_ style: UIFont.TextStyle) -> UIFont {
        let font = UIFont.preferredFont(forTextStyle: style)
        return UIFont(descriptor: font.fontDescriptor.withSymbolicTraits(.traitBold) ?? font.fontDescriptor, size: 0)
    }
}
