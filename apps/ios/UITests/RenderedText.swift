import UIKit
import Vision

/// Independent pixel evidence. Never supply expected words to the recognizer.
enum RenderedText {
    struct Line {
        let text: String
        let confidence: Float
        let bounds: CGRect
    }

    static func lines(in image: UIImage) throws -> [Line] {
        guard let cgImage = image.cgImage else { return [] }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cgImage: cgImage).perform([request])
        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            return Line(text: candidate.string, confidence: candidate.confidence, bounds: observation.boundingBox)
        }.sorted { lhs, rhs in
            abs(lhs.bounds.midY - rhs.bounds.midY) > 0.02
                ? lhs.bounds.midY > rhs.bounds.midY : lhs.bounds.minX < rhs.bounds.minX
        }
    }

    static func proves(_ expected: String, lines: [Line], inside bounds: CGRect) -> Bool {
        guard !lines.isEmpty else { return false }
        let recognized = lines.map(\.text).joined(separator: " ")
        guard recognized == expected, !recognized.contains("…"), !recognized.contains("...") else { return false }
        return lines.allSatisfy {
            $0.confidence >= 0.95 && !$0.bounds.isEmpty
                && bounds.contains($0.bounds)
        }
    }
}
