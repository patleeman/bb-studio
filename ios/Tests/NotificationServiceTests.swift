import UserNotifications
import XCTest

final class NotificationServiceTests: XCTestCase {
    func testMakeCategoryBuildsIndexedChoiceActionsAndOptionalFreeText() {
        let basic = NotificationChoiceCategory.makeCategory(choices: ["Approve", "Deny"], freeText: false)
        XCTAssertEqual(basic.identifier, "BB_CHOICE.Approve\u{1F}Deny")
        XCTAssertEqual(basic.actions.map(\.identifier), ["BB_CHOICE_0", "BB_CHOICE_1"])
        XCTAssertEqual(basic.actions.map(\.title), ["Approve", "Deny"])
        XCTAssertTrue(basic.actions.allSatisfy { $0.options.contains(.authenticationRequired) })

        let withFreeText = NotificationChoiceCategory.makeCategory(choices: ["Yes"], freeText: true)
        XCTAssertEqual(withFreeText.actions.map(\.identifier), ["BB_CHOICE_0", "BB_REPLY_TEXT"])
        XCTAssertTrue(withFreeText.actions.last is UNTextInputNotificationAction)
    }

    func testMergedCategoriesReplacesSameChoiceSetAndPreservesNonChoiceCategories() {
        let staticCat = UNNotificationCategory(identifier: "BB_APPROVAL", actions: [], intentIdentifiers: [])
        let oldSame = NotificationChoiceCategory.makeCategory(choices: ["A", "B"], freeText: false)
        let otherDynamic = NotificationChoiceCategory.makeCategory(choices: ["X"], freeText: false)
        let updatedSame = NotificationChoiceCategory.makeCategory(choices: ["A", "B"], freeText: true)

        let merged = NotificationChoiceCategory.mergedCategories(
            existing: [staticCat, oldSame, otherDynamic],
            adding: updatedSame
        )
        XCTAssertEqual(merged.count, 3)
        XCTAssertTrue(merged.contains(where: { $0.identifier == "BB_APPROVAL" }))
        XCTAssertTrue(merged.contains(where: { $0.identifier == otherDynamic.identifier }))
        let replaced = merged.first(where: { $0.identifier == updatedSame.identifier })
        XCTAssertEqual(replaced?.actions.count, 3)
    }

    func testMergedCategoriesPrunesDynamicSetAtCapWhileKeepingStaticCategories() {
        let staticCat = UNNotificationCategory(identifier: "BB_LOOP", actions: [], intentIdentifiers: [])
        var existing: Set<UNNotificationCategory> = [staticCat]
        for i in 0..<NotificationChoiceCategory.maxDynamicCount {
            existing.insert(NotificationChoiceCategory.makeCategory(choices: ["Opt\(i)"], freeText: false))
        }
        let newest = NotificationChoiceCategory.makeCategory(choices: ["Fresh"], freeText: false)

        let merged = NotificationChoiceCategory.mergedCategories(existing: existing, adding: newest)
        XCTAssertEqual(merged.map(\.identifier).sorted(), ["BB_CHOICE.Fresh", "BB_LOOP"])
    }

    func testDidReceiveLeavesNonChoiceRequestsUnchanged() {
        let service = NotificationService()
        let content = UNMutableNotificationContent()
        content.categoryIdentifier = "BB_OTHER"
        content.title = "Hello"
        let request = UNNotificationRequest(identifier: "req-1", content: content, trigger: nil)

        let exp = expectation(description: "content handler called")
        service.didReceive(request) { delivered in
            XCTAssertEqual(delivered.categoryIdentifier, "BB_OTHER")
            XCTAssertEqual(delivered.title, "Hello")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 2)
    }
}
