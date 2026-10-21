// Codable mirror of shared/types.ts — the API contract. Keep in sync with the server.
// Timestamps stay as ISO-8601 strings on the wire; use the `Date` helpers below in the UI.

import Foundation

enum Category: String, Codable, CaseIterable, Identifiable, Sendable {
    case study, code, write, design, music, art, other
    var id: String { rawValue }
}

enum Visibility: String, Codable, CaseIterable, Identifiable, Sendable {
    case `public`, followers, `private`
    var id: String { rawValue }
}

struct UserSummary: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let username: String
    let displayName: String
    let avatarColor: String
}

struct User: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let username: String
    var displayName: String
    var bio: String
    let avatarColor: String
    var weeklyGoalMin: Int
    let createdAt: String
}

struct UserProfile: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let username: String
    var displayName: String
    var bio: String
    let avatarColor: String
    var weeklyGoalMin: Int
    let createdAt: String
    var followers: Int
    var following: Int
    var sessionCount: Int
    var totalFocusMin: Int
    var streakDays: Int
    var isFollowing: Bool
    var isMe: Bool
}

struct AuthResponse: Codable, Sendable {
    let token: String
    let user: User
}

struct CreateSessionInput: Codable, Sendable {
    var title: String
    var description: String?
    var category: Category
    var visibility: Visibility
    var startedAt: String
    var endedAt: String
    var focusMs: Int
    var frameCount: Int
    var intervalSec: Int
    var videoDurationMs: Int
    var localDate: String // YYYY-MM-DD in the user's time zone
}

struct WorkSession: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let user: UserSummary
    var title: String
    var description: String
    var category: Category
    var visibility: Visibility
    let startedAt: String
    let endedAt: String
    let focusMs: Int
    let frameCount: Int
    let intervalSec: Int
    let videoDurationMs: Int
    let localDate: String
    let videoUrl: String // server-relative, e.g. /media/abc.mp4; may be "" for seeded data
    let thumbnailUrl: String
    var kudos: Int
    var hasKudoed: Bool
    var commentCount: Int
    let createdAt: String
}

struct Comment: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let sessionId: String
    let user: UserSummary
    let body: String
    let createdAt: String
}

struct Page<T: Codable & Sendable>: Codable, Sendable {
    let items: [T]
    let nextCursor: String?
}

struct WeekBucket: Codable, Hashable, Sendable {
    let weekStart: String
    let focusMin: Int
}

struct CategoryBucket: Codable, Hashable, Sendable {
    let category: Category
    let focusMin: Int
}

struct Stats: Codable, Hashable, Sendable {
    let totalSessions: Int
    let totalFocusMin: Int
    let streakDays: Int
    let longestStreakDays: Int
    let thisWeekMin: Int
    let weeklyGoalMin: Int
    let weeks: [WeekBucket]
    let byCategory: [CategoryBucket]
}

struct LeaderboardEntry: Codable, Hashable, Sendable {
    let user: UserSummary
    let focusMin: Int
    let sessions: Int
    let rank: Int
}

struct KudosResponse: Codable, Sendable {
    let kudos: Int
    let hasKudoed: Bool
}

struct FollowResponse: Codable, Sendable {
    let following: Bool
}

struct APIErrorBody: Codable, Sendable {
    let error: String
}

enum ISODate {
    nonisolated(unsafe) private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) private static let plain = ISO8601DateFormatter()

    static func parse(_ s: String) -> Date? { withFraction.date(from: s) ?? plain.date(from: s) }
    static func string(_ d: Date) -> String { withFraction.string(from: d) }
    /// YYYY-MM-DD in the device's current time zone.
    static func localDate(_ d: Date = Date()) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
