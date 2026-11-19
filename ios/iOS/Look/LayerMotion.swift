import SwiftUI
import UIKit

/// Small looping motion (a spinner's turn, a dot's pulse) as Core Animation
/// animations. They run in the render server at up to `fps`, so the app does
/// no work per frame: a SwiftUI `TimelineView(.animation)` or `repeatForever`
/// animation instead rebuilds the view on the main thread at the display's
/// rate (60 or 120 Hz) for as long as it shows.
enum LayerMotion {
    /// Enough for a 14-point spinner or a soft pulse to look smooth.
    static let fps: Float = 30
    static let key = "layerMotion"

    static func rate(_ animation: CAAnimation) {
        animation.preferredFrameRateRange = CAFrameRateRange(minimum: 10, maximum: fps, preferred: fps)
    }
}

/// A ring with a quarter arc turning once every `period` seconds; still with Reduce Motion.
struct LayerSpinner: UIViewRepresentable {
    var tint: Color
    var track: Double = 0.25
    var lineWidth: CGFloat = 1.5
    var trackWidth: CGFloat?
    var period: CFTimeInterval = 1.1
    var still = false

    func makeUIView(context: Context) -> SpinnerView { SpinnerView() }

    func updateUIView(_ view: SpinnerView, context: Context) {
        view.configure(color: UIColor(tint), track: track, lineWidth: lineWidth, trackWidth: trackWidth ?? lineWidth, period: period, still: still)
    }

    final class SpinnerView: UIView {
        private let ring = CAShapeLayer()
        private let arc = CAShapeLayer()
        private var period: CFTimeInterval = 1.1
        private var still = false

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            backgroundColor = .clear
            for shape in [ring, arc] {
                shape.fillColor = nil
                layer.addSublayer(shape)
            }
            arc.lineCap = .round
            arc.strokeEnd = 0.25
        }

        required init?(coder: NSCoder) { fatalError() }

        func configure(color: UIColor, track: Double, lineWidth: CGFloat, trackWidth: CGFloat, period: CFTimeInterval, still: Bool) {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            defer { CATransaction.commit() }
            ring.strokeColor = color.withAlphaComponent(color.cgColor.alpha * track).cgColor
            arc.strokeColor = color.cgColor
            ring.lineWidth = trackWidth
            arc.lineWidth = lineWidth
            let changed = period != self.period || still != self.still
            self.period = period
            self.still = still
            if changed { spin() }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            for shape in [ring, arc] {
                shape.frame = bounds
                // On the frame's edge, like a stroked SwiftUI Circle.
                shape.path = UIBezierPath(ovalIn: bounds).cgPath
            }
            CATransaction.commit()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            spin()
        }

        private func spin() {
            arc.removeAnimation(forKey: LayerMotion.key)
            guard window != nil, !still else { return }
            let turn = CABasicAnimation(keyPath: "transform.rotation.z")
            turn.fromValue = 0
            turn.toValue = 2 * Double.pi
            turn.duration = period
            turn.repeatCount = .infinity
            turn.isRemovedOnCompletion = false
            LayerMotion.rate(turn)
            arc.add(turn, forKey: LayerMotion.key)
        }
    }
}

/// A dot with a soft halo (at `from` opacity; none at 0) that, while `pulsing`,
/// breathes to `to` and back, easing in and out.
struct LayerPulse: UIViewRepresentable {
    var tint: Color
    var dot: CGFloat = 6
    var dotOpacity: Double = 1
    var halo: CGFloat = 14
    var from: Double = 0.22
    var to: Double = 0.08
    var period: CFTimeInterval = 1.4
    var pulsing = true

    func makeUIView(context: Context) -> PulseView { PulseView() }

    func updateUIView(_ view: PulseView, context: Context) {
        view.configure(self)
    }

    final class PulseView: UIView {
        private let haloLayer = CALayer()
        private let dotLayer = CALayer()
        private var spec: LayerPulse?

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            backgroundColor = .clear
            layer.addSublayer(haloLayer)
            layer.addSublayer(dotLayer)
        }

        required init?(coder: NSCoder) { fatalError() }

        func configure(_ spec: LayerPulse) {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            defer { CATransaction.commit() }
            let color = UIColor(spec.tint)
            let alpha = color.cgColor.alpha
            dotLayer.backgroundColor = color.withAlphaComponent(alpha * spec.dotOpacity).cgColor
            haloLayer.backgroundColor = color.withAlphaComponent(alpha * spec.from).cgColor
            let changed = self.spec.map { $0.pulsing != spec.pulsing || $0.from != spec.from || $0.to != spec.to || $0.period != spec.period } ?? true
            self.spec = spec
            setNeedsLayout()
            if changed { pulse() }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            guard let spec else { return }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            let middle = CGPoint(x: bounds.midX, y: bounds.midY)
            haloLayer.bounds = CGRect(x: 0, y: 0, width: spec.halo, height: spec.halo)
            haloLayer.cornerRadius = spec.halo / 2
            haloLayer.position = middle
            dotLayer.bounds = CGRect(x: 0, y: 0, width: spec.dot, height: spec.dot)
            dotLayer.cornerRadius = spec.dot / 2
            dotLayer.position = middle
            CATransaction.commit()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            pulse()
        }

        private func pulse() {
            haloLayer.removeAnimation(forKey: LayerMotion.key)
            guard let spec else { return }
            guard window != nil, spec.pulsing, spec.from > 0 else { return }
            let breathe = CABasicAnimation(keyPath: "opacity")
            breathe.fromValue = 1
            breathe.toValue = spec.to / spec.from
            breathe.duration = spec.period
            breathe.autoreverses = true
            breathe.repeatCount = .infinity
            breathe.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            breathe.isRemovedOnCompletion = false
            LayerMotion.rate(breathe)
            haloLayer.add(breathe, forKey: LayerMotion.key)
        }
    }
}
