// Shared shapes for the Firestore analytics archive — written by the daily
// rollup cron (rollup.ts), read by the Website report (website.ts). The
// dashboard makes NO live Umami calls: it serves entirely from these docs,
// at most one day behind (accepted trade-off, Aug 2026).
//
// Layers (medallion in miniature):
//   analytics_events_raw/{date}  — bronze: the day's raw event rows as Umami
//                                  returns them (no custom event properties —
//                                  the Cloud API doesn't expose those per
//                                  event; the silver layer captures the
//                                  property dimensions reports use)
//   analytics_days/{date}        — silver: one fat doc per day with every
//                                  aggregate the dashboard reads
//   analytics_sessions/{id}      — sessions (upserted while still active),
//                                  powering visitor counts, browse depth,
//                                  and the teacher table
//
// Everything is idempotent and rebuildable: while Umami still holds the raw
// data (2-year retention), any schema change is just a re-run.
//
// Map keys are only ever slugs / ISO codes / device types (safe charsets for
// Firestore field names). Values with arbitrary text (cities, prompt labels)
// are stored as {name, count} arrays instead.

export const DAYS_COLLECTION = "analytics_days";
export const RAW_COLLECTION = "analytics_events_raw";
export const SESSIONS_COLLECTION = "analytics_sessions";

// First day with only real data (the 22 Jul demo-seed day stays excluded).
export const ARCHIVE_EPOCH = "2026-07-23";
export const ARCHIVE_SCHEMA = 2;

export interface StatBlock {
  pageviews: number;
  visitors: number;
  visits: number;
  totaltime: number; // seconds across all visits
}

export interface LumenSlice {
  sessions: number;
  promptClicks: number;
  responses: number;
}

export interface LessonDay {
  lessonViews: number;
  pageViews: number;
  quizCompletes: number;
  inlineQuizCompletes: number;
  certificates: number;
  feedback: number;
  interactions: number;
  interactionBreakdown: Record<string, number>; // interaction event → count
}

export interface GeoMaps {
  countries: Record<string, number>; // ISO code → visitors
  regions: Record<string, number>; // ISO 3166-2 → visitors
  cities: { name: string; count: number }[];
}

export interface ArchiveDay {
  date: string; // YYYY-MM-DD (Sydney)
  schema: number;
  updatedAt: string;
  stats: StatBlock;
  teacherStats: StatBlock;
  events: Record<string, number>; // event name → count
  userTypes: Record<string, number>; // lesson_page_view user_type (authenticated folded into teacher)
  courses: Record<string, number>; // course slug → course_view count (aliased)
  lessons: Record<string, LessonDay>; // lesson slug → per-lesson numbers
  pages: Record<string, Record<string, number>>; // lesson → page → views (from URLs)
  pageInteractions: Record<string, number>; // page_slug → interactions (full history)
  pageKeyInteractions: Record<string, Record<string, number>>; // lesson → page (since PAGE_KEY_SINCE)
  geo: GeoMaps;
  teacherGeo: GeoMaps;
  devices: Record<string, number>;
  teacherDevices: Record<string, number>;
  lumen: {
    sessions: number;
    promptClicks: number;
    responses: number;
    inputTokens: number;
    outputTokens: number;
    responseMsSum: number; // Σ response_ms — divide by responses for the avg
    scenarios: Record<string, LumenSlice>; // flow id → slice
    prompts: { name: string; count: number }[]; // prompt label → clicks
  };
}

export interface ArchiveSession {
  id: string;
  firstAt: string; // ISO
  lastAt: string; // ISO
  visits: number;
  views: number;
  events: number;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  teacher: boolean; // carried the teacher tag (taggable from 21 Aug 2026)
  distinctId: string | null; // educator analyticsId when identify() landed
  lessons: string[]; // lesson slugs visited (teacher sessions only)
  updatedAt: string;
}
