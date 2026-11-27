import SwiftUI
import WebKit

/// A screen's still in one scroll view (`DesignStillView`).
struct DesignStill: UIViewRepresentable {
    let url: URL
    let size: CGSize
    var play: () -> Void
    /// Told when the still leaves fit-to-width or comes back to it.
    var zoomed: (Bool) -> Void = { _ in }
    var identifier = "designStill"

    func makeUIView(context: Context) -> DesignStillView {
        DesignStillView(url: url, size: size, play: play)
    }

    func updateUIView(_ view: DesignStillView, context: Context) {
        view.play = play
        view.zoomed = zoomed
        view.identifier = identifier
    }
}

/// Draws the screen once, under the scroll view at its own size, takes a picture of it,
/// and shows the picture in a `UIScrollView`: the only scroll view, so a pan
/// moves the picture and nothing inside it rubber-bands. The minimum zoom is
/// fit-to-width, the picture is centred while it's smaller than the view, and
/// the edges bounce lightly. `designStill`'s value is the zoom relative to fit.
final class DesignStillView: UIView, UIScrollViewDelegate {
    var play: () -> Void
    var zoomed: (Bool) -> Void = { _ in }
    private var wasZoomed = false
    var identifier: String {
        get { scroll.accessibilityIdentifier ?? "" }
        set { scroll.accessibilityIdentifier = newValue }
    }
    private let url: URL
    private let size: CGSize
    private let scroll = UIScrollView()
    private let imageView = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let failure = UILabel()
    /// The one render (`DesignScreenRenderer`); cancelled when the view goes.
    private var rendering: Task<Void, Never>?
    private var started = false
    private var fit: CGFloat = 1
    private var laidOutWidth: CGFloat = 0
    /// The page's height at its own width (a screen can be taller than its frame).
    private var pageHeight: CGFloat = 0

    init(url: URL, size: CGSize, play: @escaping () -> Void) {
        self.url = url
        self.size = CGSize(width: max(1, size.width), height: max(1, size.height))
        self.play = play
        super.init(frame: .zero)
        scroll.delegate = self
        scroll.bounces = true
        scroll.bouncesZoom = true
        scroll.alwaysBounceVertical = false
        scroll.alwaysBounceHorizontal = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.decelerationRate = .normal
        scroll.backgroundColor = .secondarySystemBackground
        scroll.accessibilityIdentifier = "designStill"
        scroll.accessibilityLabel = "Design screen"
        scroll.isAccessibilityElement = true
        imageView.contentMode = .scaleToFill
        scroll.addSubview(imageView)
        addSubview(scroll)
        spinner.startAnimating()
        addSubview(spinner)
        failure.text = "This screen didn't draw. Play opens it live."
        failure.font = .preferredFont(forTextStyle: .footnote)
        failure.textColor = .secondaryLabel
        failure.numberOfLines = 0
        failure.textAlignment = .center
        failure.isHidden = true
        addSubview(failure)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.require(toFail: doubleTap)
        scroll.addGestureRecognizer(tap)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        scroll.frame = bounds
        spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
        failure.frame = bounds.insetBy(dx: 32, dy: 0)
        guard bounds.width > 0 else { return }
        if !started, window != nil { render() }
        if imageView.image != nil, bounds.width != laidOutWidth { fitToWidth(keepingZoom: laidOutWidth > 0) }
    }

    deinit { rendering?.cancel() }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // Off screen: stop drawing (the render holds this view while it runs), and draw again on return.
        if window == nil, imageView.image == nil, rendering != nil {
            rendering?.cancel()
            rendering = nil
            started = false
        }
        setNeedsLayout()
    }

    // MARK: Drawing the still

    /// The page drawn once at its own width, under the scroll view (it must be in the
    /// window to draw), then shown as a picture. A failed load, a crashed page or a
    /// cancelled render ends in the failure note, never a spinner left turning.
    private func render() {
        started = true
        // Sharp to a few times fit, within a texture a phone handles (4096 px wide).
        let scale = window?.screen.scale ?? 3, fitWidth = bounds.width, size = size
        rendering = Task { [weak self, url] in
            guard let host = self else { return }
            let still = await DesignScreenRenderer.render(url, size: size, in: host, fullPage: true) { pageHeight in
                min(size.width * 3, max(fitWidth * 6, size.width), 4096 / scale, 16384 / scale * size.width / pageHeight)
            }
            guard let self, !Task.isCancelled else { return }
            if let still { self.show(still) } else { self.failed() }
        }
    }

    private func show(_ still: DesignScreenRenderer.Still) {
        spinner.stopAnimating()
        spinner.isHidden = true
        pageHeight = still.pageHeight
        imageView.image = still.image
        imageView.frame = CGRect(x: 0, y: 0, width: size.width, height: pageHeight)
        scroll.contentSize = imageView.frame.size
        fitToWidth(keepingZoom: false)
    }

    private func failed() {
        spinner.stopAnimating()
        spinner.isHidden = true
        failure.isHidden = false
    }

    // MARK: Zoom

    /// Fit-to-width is the least zoom; a size change keeps the zoom relative to it.
    private func fitToWidth(keepingZoom: Bool) {
        guard bounds.width > 0, imageView.image != nil else { return }
        let relative = keepingZoom && fit > 0 ? scroll.zoomScale / fit : 1
        laidOutWidth = bounds.width
        fit = bounds.width / size.width
        scroll.minimumZoomScale = fit
        scroll.maximumZoomScale = fit * 6
        scroll.zoomScale = fit * min(6, max(1, relative))
        if !keepingZoom { scroll.contentOffset = .zero }
        center()
        report()
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        center()
        report()
    }

    /// While the picture is smaller than the view (a wide screen's height), it sits in the middle.
    private func center() {
        let content = scroll.contentSize
        scroll.contentInset = UIEdgeInsets(top: max(0, (bounds.height - content.height) / 2), left: max(0, (bounds.width - content.width) / 2),
                                           bottom: 0, right: 0)
    }

    private func report() {
        let relative = fit > 0 ? scroll.zoomScale / fit : 0
        scroll.accessibilityValue = String(format: "%.4f", relative)
        if (relative > 1.01) != wasZoomed {
            wasZoomed = relative > 1.01
            zoomed(wasZoomed)
        }
    }

    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        guard imageView.image != nil else { return }
        if scroll.zoomScale > fit * 1.05 {
            scroll.setZoomScale(fit, animated: true)
        } else {
            let point = gesture.location(in: imageView)
            let scale = fit * 2.5
            let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            scroll.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }

    @objc private func tapped() { play() }
}

/// Loads the live player's page once per address (the demo's pages offline),
/// and knows the address `UntrustedWeb` allows it.
final class DesignPageLoader: UntrustedWebGuard {
    var loaded: URL?

    init() { super.init(allowed: nil) }

    func load(_ url: URL, in view: WKWebView) {
        loaded = url
        allowed = url
        #if DEBUG
        if let html = DesignDemo.html(for: url) {
            view.loadHTMLString(html, baseURL: nil)
            return
        }
        #endif
        view.load(URLRequest(url: url))
    }
}
