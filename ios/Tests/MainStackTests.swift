import Darwin
import XCTest

/// The app's simulator builds give the main thread a device's 1 MB of stack,
/// not the simulator's 8 MB, so tests catch a stack overflow that only a
/// device would hit (TestFlight 20261126.0313: `ThreadView`'s view type).
final class MainStackTests: XCTestCase {
    @MainActor
    func testTheHostAppRunsOnTheDeviceMainStack() {
        #if targetEnvironment(simulator)
        XCTAssertNotEqual(pthread_main_np(), 0)
        let size = pthread_get_stacksize_np(pthread_self())
        XCTAssertLessThanOrEqual(size, 1 << 20, "project.yml links simulator builds with -stack_size 0x100000; the main stack is \(size)")
        #endif
    }
}
