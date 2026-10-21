// API contract shared by web/ and server/. Types only — no runtime code.

export type Category = 'study' | 'code' | 'write' | 'design' | 'music' | 'art' | 'other';
export type Visibility = 'public' | 'followers' | 'private';

export const CATEGORIES: readonly Category[] = ['study', 'code', 'write', 'design', 'music', 'art', 'other'] as const;

export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarColor: string; // hex, generated at signup
  weeklyGoalMin: number; // default 600
  createdAt: string; // ISO
}

export interface UserProfile extends User {
  followers: number;
  following: number;
  sessionCount: number;
  totalFocusMin: number;
  streakDays: number;
  isFollowing: boolean; // whether the viewer follows this user
  isMe: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface CreateSessionInput {
  title: string;
  description?: string;
  category: Category;
  visibility: Visibility;
  startedAt: string; // ISO
  endedAt: string; // ISO
  focusMs: number; // elapsed excluding pauses
  frameCount: number;
  intervalSec: number;
  videoDurationMs: number;
  localDate: string; // YYYY-MM-DD in the user's timezone, used for streaks
}

export interface WorkSession {
  id: string;
  user: Pick<User, 'id' | 'username' | 'displayName' | 'avatarColor'>;
  title: string;
  description: string;
  category: Category;
  visibility: Visibility;
  startedAt: string;
  endedAt: string;
  focusMs: number;
  frameCount: number;
  intervalSec: number;
  videoDurationMs: number;
  localDate: string;
  videoUrl: string; // e.g. /media/abc.webm
  thumbnailUrl: string; // e.g. /media/abc.jpg
  kudos: number;
  hasKudoed: boolean;
  commentCount: number;
  createdAt: string;
}

export interface Comment {
  id: string;
  sessionId: string;
  user: Pick<User, 'id' | 'username' | 'displayName' | 'avatarColor'>;
  body: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Stats {
  totalSessions: number;
  totalFocusMin: number;
  streakDays: number;
  longestStreakDays: number;
  thisWeekMin: number; // Monday-start week, by localDate
  weeklyGoalMin: number;
  weeks: { weekStart: string; focusMin: number }[]; // last 12 weeks, oldest first
  byCategory: { category: Category; focusMin: number }[];
}

export interface LeaderboardEntry {
  user: Pick<User, 'id' | 'username' | 'displayName' | 'avatarColor'>;
  focusMin: number;
  sessions: number;
  rank: number;
}

export interface ApiError {
  error: string;
}
