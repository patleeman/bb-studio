import SwiftUI
import UIKit
import WebKit

/// Pinch to zoom and drag to pan any view, as Photos does: the content fills the
/// container at 1×, pinch zooms up to `maximum`, a drag pans once zoomed, and a
/// double tap toggles between 1× and 2.5× at the tap. Taps still reach the
/// content (a design's prototype, a link), and at 1× drags fall through to it.
struct Zoomable<Content: View>: UIViewRepresentable {
    var maximum: CGFloat = 6
    @ViewBuilder var content: () -> Content

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = maximum
        scroll.bouncesZoom = true
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.backgroundColor = .clear
        scroll.accessibilityIdentifier = "zoomable"
        let host = context.coordinator.host
        host.rootView = AnyView(content())
        host.view.backgroundColor = .clear
        host.sizingOptions = []
        scroll.addSubview(host.view)
        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(ZoomableCoordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        doubleTap.cancelsTouchesInView = false
        scroll.addGestureRecognizer(doubleTap)
        context.coordinator.scroll = scroll
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.host.rootView = AnyView(content())
        scroll.maximumZoomScale = maximum
        context.coordinator.layout()
    }

    func makeCoordinator() -> ZoomableCoordinator { ZoomableCoordinator() }
}

final class ZoomableCoordinator: NSObject, UIScrollViewDelegate {
    let host = UIHostingController(rootView: AnyView(EmptyView()))
    weak var scroll: UIScrollView?
    private var lastSize: CGSize = .zero

    /// At 1× the content is exactly the container; a size change resets the zoom.
    func layout() {
        guard let scroll else { return }
        let size = scroll.bounds.size
        guard size != .zero, size != lastSize else { return }
        lastSize = size
        scroll.zoomScale = 1
        host.view.frame = CGRect(origin: .zero, size: size)
        scroll.contentSize = size
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { host.view }

    /// Runs on every bounds change, including the first layout and rotation.
    func scrollViewDidScroll(_ scrollView: UIScrollView) { layout() }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        // Keep content smaller than the screen centred while zooming out.
        let inset = { (outer: CGFloat, inner: CGFloat) in max(0, (outer - inner) / 2) }
        scrollView.contentInset = UIEdgeInsets(top: inset(scrollView.bounds.height, scrollView.contentSize.height),
                                               left: inset(scrollView.bounds.width, scrollView.contentSize.width), bottom: 0, right: 0)
    }

    @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
        guard let scroll else { return }
        if scroll.zoomScale > 1.01 {
            scroll.setZoomScale(1, animated: true)
        } else {
            let point = gesture.location(in: host.view)
            let scale = min(2.5, scroll.maximumZoomScale)
            let size = CGSize(width: scroll.bounds.width / scale, height: scroll.bounds.height / scale)
            scroll.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }
}

enum WebZoom {
    /// Lets a page pinch-zoom even when its viewport says otherwise (designs and
    /// HTML artifacts written for a desktop often set `user-scalable=no`).
    static let script = WKUserScript(source: """
        (function () {
          var content = 'width=device-width, initial-scale=1, minimum-scale=0.25, maximum-scale=6, user-scalable=yes';
          function apply() {
            var meta = document.querySelector('meta[name=viewport]');
            if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; (document.head || document.documentElement).appendChild(meta); }
            if (meta.content !== content && /user-scalable\\s*=\\s*(no|0)|maximum-scale\\s*=\\s*1(\\.0)?\\b/.test(meta.content || 'user-scalable=no')) meta.content = content;
          }
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
        })();
        """, injectionTime: .atDocumentEnd, forMainFrameOnly: true)

    static func enable(_ configuration: WKWebViewConfiguration) {
        configuration.userContentController.addUserScript(script)
    }

    static func enable(_ view: WKWebView) {
        view.scrollView.minimumZoomScale = 0.25
        view.scrollView.maximumZoomScale = 6
        view.scrollView.bouncesZoom = true
    }
}
