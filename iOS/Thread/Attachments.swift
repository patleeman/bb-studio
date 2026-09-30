import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A photo or file waiting to be sent. Uploaded to the thread's project at send time.
struct PendingAttachment: Identifiable, Equatable {
    let id = UUID()
    var data: Data
    var name: String
    var mimeType: String
    var thumbnail: UIImage?

    /// BB rejects HEIC, and phone photos are large: re-encode as a JPEG at most 2048px on a side.
    static func image(_ image: UIImage, name: String = "photo.jpg") -> PendingAttachment? {
        let scale = min(1, 2048 / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let data = resized.jpegData(compressionQuality: 0.85) else { return nil }
        let base = (name as NSString).deletingPathExtension
        return PendingAttachment(data: data, name: "\(base).jpg", mimeType: "image/jpeg", thumbnail: resized)
    }

    static func file(_ url: URL) -> PendingAttachment? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let type = UTType(filenameExtension: url.pathExtension)
        if type?.conforms(to: .image) == true, let image = UIImage(data: data) {
            return .image(image, name: url.lastPathComponent)
        }
        return PendingAttachment(
            data: data, name: url.lastPathComponent, mimeType: type?.preferredMIMEType ?? "application/octet-stream")
    }

    static let maxBytes = 35 * 1024 * 1024

    static func upload(_ items: [PendingAttachment], projectId: String, client: BBClient) async throws -> [JSONValue] {
        var inputs: [JSONValue] = []
        for item in items {
            guard item.data.count <= maxBytes else {
                throw BBError(status: 413, message: "\(item.name) is over 35 MB.")
            }
            inputs.append(try await client.upload(projectId: projectId, data: item.data, name: item.name, mimeType: item.mimeType))
        }
        return inputs
    }
}

/// The paperclip menu: photo library, camera, and files.
struct AttachmentMenu: View {
    @Binding var items: [PendingAttachment]
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var choosingPhotos = false
    @State private var usingCamera = false
    @State private var choosingFiles = false

    var body: some View {
        Menu {
            Button { choosingPhotos = true } label: { Label("Photo Library", systemImage: "photo.on.rectangle") }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button { usingCamera = true } label: { Label("Take Photo", systemImage: "camera") }
            }
            Button { choosingFiles = true } label: { Label("Choose File", systemImage: "folder") }
        } label: {
            Image(systemName: "paperclip").font(.title3).frame(width: 36, height: 36)
        }
        .photosPicker(isPresented: $choosingPhotos, selection: $photoItems, maxSelectionCount: 6, matching: .images)
        .onChange(of: photoItems) {
            let picked = photoItems
            photoItems = []
            Task {
                for item in picked {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                        let attachment = PendingAttachment.image(image)
                    {
                        items.append(attachment)
                    }
                }
            }
        }
        .fileImporter(isPresented: $choosingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) {
            result in
            for url in (try? result.get()) ?? [] {
                if let attachment = PendingAttachment.file(url) { items.append(attachment) }
            }
        }
        .fullScreenCover(isPresented: $usingCamera) {
            CameraPicker { image in
                if let attachment = PendingAttachment.image(image) { items.append(attachment) }
            }
            .ignoresSafeArea()
        }
    }
}

/// Thumbnails of the attachments about to be sent, each removable.
struct AttachmentStrip: View {
    @Binding var items: [PendingAttachment]

    var body: some View {
        if !items.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items) { item in
                        ZStack(alignment: .topTrailing) {
                            Group {
                                if let thumbnail = item.thumbnail {
                                    Image(uiImage: thumbnail).resizable().scaledToFill()
                                } else {
                                    VStack(spacing: 2) {
                                        Image(systemName: "doc")
                                        Text(item.name).font(.caption2).lineLimit(2).multilineTextAlignment(.center)
                                    }
                                    .padding(4)
                                }
                            }
                            .frame(width: 56, height: 56)
                            .background(.fill.tertiary)
                            .clipShape(.rect(cornerRadius: 8))
                            Button { items.removeAll { $0.id == item.id } } label: {
                                Image(systemName: "xmark.circle.fill").symbolRenderingMode(.palette)
                                    .foregroundStyle(.white, .black.opacity(0.6))
                            }
                            .offset(x: 6, y: -6)
                            .accessibilityLabel("Remove attachment")
                        }
                    }
                }
                .padding(.top, 6)
                .padding(.horizontal, 4)
            }
        }
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
