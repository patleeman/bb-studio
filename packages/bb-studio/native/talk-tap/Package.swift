// swift-tools-version:5.10
import PackageDescription

// The helper's Info.plist goes into the binary's __TEXT,__info_plist section,
// so a bare command-line tool can carry its usage strings and identifier.
let infoPlist = Context.packageDirectory + "/Info.plist"

let package = Package(
    name: "talk-tap",
    platforms: [.macOS("14.2")],
    products: [
        .executable(name: "bb-talk-tap", targets: ["bb-talk-tap"]),
    ],
    dependencies: [
        .package(url: "https://github.com/argmaxinc/WhisperKit.git", exact: "1.1.1"),
    ],
    targets: [
        .target(
            name: "TalkTapCore",
            dependencies: [.product(name: "WhisperKit", package: "WhisperKit")]
        ),
        .executableTarget(
            name: "bb-talk-tap",
            dependencies: ["TalkTapCore"],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", infoPlist]),
            ]
        ),
        .testTarget(
            name: "TalkTapCoreTests",
            dependencies: ["TalkTapCore", "bb-talk-tap"]
        ),
    ]
)
