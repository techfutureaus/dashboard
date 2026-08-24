import { cached } from "./api-response";
import { TAGS } from "./cache-tags";

// Reports for the TFA LMS + Lumen (AI editor) events, served by the Umami
// Cloud API. The LMS migrated from GA4/GTM to Umami in Jul 2026 (see the main
// app's docs/analytics-decision.md); these mirror the shapes the old
// ga4-lms.ts reports produced so the report pages carry over unchanged.
//
// Auth: UMAMI_API_KEY (Umami Cloud → Account → API keys; Pro plan).
// Website: UMAMI_WEBSITE_ID (defaults to the Tech Futures site).

const API_BASE = "https://api.umami.is/v1";
const WEBSITE_ID =
  process.env.UMAMI_WEBSITE_ID || "859b32ca-fe0b-4438-be41-4864cae1c369";
const TIMEZONE = "Australia/Sydney";

// The single "property" — kept Property-shaped so the report pages' subtitle
// and export names keep working after the GA4 → Umami swap.
export const UMAMI_SOURCE = {
  id: "tfa-lms-umami",
  displayName: "Tech Futures LMS · Umami",
};

export type UmamiSource = typeof UMAMI_SOURCE;

export interface UmamiRange {
  /** yyyy-MM-dd, or undefined for "365 days ago" */
  start?: string | null;
  /** yyyy-MM-dd, or undefined for today */
  end?: string | null;
}

// Queries never reach before this moment. Two demo-seed runs polluted the
// production website on 22 Jul 2026 with ~500 fake events (fake visitors,
// quiz completions, Lumen sessions — see the main app's
// scratchpad/umami-seed.ts). Umami Cloud events are immutable, so the fake
// data can't be deleted — instead every query starts at Sydney midnight
// after the seed day. Real Umami tracking only went live the evening of
// 22 Jul, so this costs a few hours of launch-evening traffic at most.
const DATA_EPOCH = new Date("2026-07-23T00:00:00+10:00").getTime();

function rangeToMs(range: UmamiRange): { startAt: number; endAt: number } {
  const startAt = Math.max(
    range.start ? new Date(`${range.start}T00:00:00`).getTime() : DATA_EPOCH,
    DATA_EPOCH
  );
  const endAt = Math.max(
    range.end ? new Date(`${range.end}T23:59:59.999`).getTime() : Date.now(),
    startAt
  );
  return { startAt, endAt };
}

async function umamiFetch<T>(
  path: string,
  params: Record<string, string | number>
): Promise<T> {
  const key = process.env.UMAMI_API_KEY;
  if (!key) {
    throw new Error(
      "UMAMI_API_KEY is not set. Create one in Umami Cloud → Account → API keys and add it to .env.local."
    );
  }
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  );
  const res = await fetch(`${API_BASE}/websites/${WEBSITE_ID}${path}?${qs}`, {
    headers: { "x-umami-api-key": key, Accept: "application/json" },
    // Route-level caching happens via cached(); don't double-cache here.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Umami API ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// --- response-shape helpers (defensive: Umami returns {x,y} for metrics and
// {value,total} for event-data values; tolerate either) -----------------------
type XY = { x?: string | null; y?: number; value?: string | null; total?: number };

const rowName = (r: XY) => r.x ?? r.value ?? "";
const rowCount = (r: XY) => Number(r.y ?? r.total ?? 0) || 0;

/** Event totals by event name over the range. */
async function eventCounts(range: UmamiRange): Promise<Map<string, number>> {
  const { startAt, endAt } = rangeToMs(range);
  const rows = await umamiFetch<XY[]>("/metrics", {
    type: "event",
    startAt,
    endAt,
    limit: 500,
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(rowName(r), rowCount(r));
  return map;
}

// Property values only the demo seeder ever sent (real course/lesson slugs
// differ). Belt-and-braces alongside the DATA_EPOCH clamp, in case the seeder
// is ever re-run after the epoch.
const SEEDED_VALUES: Record<string, string[]> = {
  lesson_slug: ["machine-learning"],
};

// The AI course launched as "ai-course" and was renamed to "intro-to-ai" on
// 25 Jul 2026 (see the Sanity redirect), so real events from the first days
// carry the old slug — fold them into the current one. (The seeder also used
// "ai-course", but its events all predate DATA_EPOCH.)
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  course_slug: { "ai-course": "intro-to-ai" },
};

/** Distinct values of one event property, with counts. */
async function eventDataValues(
  range: UmamiRange,
  eventName: string,
  propertyName: string
): Promise<{ name: string; count: number }[]> {
  const { startAt, endAt } = rangeToMs(range);
  // NB: this endpoint takes `event`, not `eventName` (verified against the
  // live API — `eventName` is silently ignored and returns []).
  const rows = await umamiFetch<XY[]>("/event-data/values", {
    startAt,
    endAt,
    event: eventName,
    propertyName,
  });
  const seeded = SEEDED_VALUES[propertyName] ?? [];
  const aliases = VALUE_ALIASES[propertyName] ?? {};
  const merged = new Map<string, number>();
  for (const r of rows) {
    const raw = String(rowName(r));
    if (raw === "" || seeded.includes(raw)) continue;
    const name = aliases[raw] ?? raw;
    merged.set(name, (merged.get(name) ?? 0) + rowCount(r));
  }
  return [...merged.entries()].map(([name, count]) => ({ name, count }));
}

/** Sum a numeric event property (Σ value × occurrences), e.g. token counts. */
async function eventDataSum(
  range: UmamiRange,
  eventName: string,
  propertyName: string
): Promise<number> {
  const values = await eventDataValues(range, eventName, propertyName);
  return values.reduce((acc, v) => acc + (Number(v.name) || 0) * v.count, 0);
}

/** Daily counts per event name. Dates come back as YYYYMMDD (matches the GA4
 * pages' formatGaDate helper). */
async function eventSeries(
  range: UmamiRange
): Promise<Map<string, { date: string; count: number }[]>> {
  const { startAt, endAt } = rangeToMs(range);
  const rows = await umamiFetch<Array<XY & { t?: string }>>("/events/series", {
    startAt,
    endAt,
    unit: "day",
    timezone: TIMEZONE,
  });
  const byEvent = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const name = rowName(r);
    // Bucket timestamps come back in UTC (e.g. Sydney midnight = 14:00Z the
    // previous day) — convert to the report timezone before taking the date.
    const t = r.t ? new Date(r.t) : null;
    const date = t
      ? t.toLocaleDateString("en-CA", { timeZone: TIMEZONE }).replace(/-/g, "")
      : "";
    if (!name || date.length !== 8) continue;
    const days = byEvent.get(name) ?? new Map<string, number>();
    days.set(date, (days.get(date) ?? 0) + rowCount(r));
    byEvent.set(name, days);
  }
  const out = new Map<string, { date: string; count: number }[]>();
  for (const [name, days] of byEvent) {
    out.set(
      name,
      [...days.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date))
    );
  }
  return out;
}

/** Sum several events' daily series into one. */
function sumSeries(
  series: Map<string, { date: string; count: number }[]>,
  events: string[]
): { date: string; count: number }[] {
  const days = new Map<string, number>();
  for (const ev of events) {
    for (const d of series.get(ev) ?? []) {
      days.set(d.date, (days.get(d.date) ?? 0) + d.count);
    }
  }
  return [...days.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Event groupings (mirror src/lib/analytics.ts in the main app).
const EVENT_TYPE: Record<string, string> = {
  course_view: "content_view",
  lesson_view: "content_view",
  lesson_page_view: "content_view",
  teacher_content_view: "content_view",
  accordion_open: "content_interaction",
  reveal_open: "content_interaction",
  tab_switch: "content_interaction",
  audio_play: "media",
  video_start: "media",
  video_complete: "media",
  resource_click: "resource",
  quiz_complete: "progress",
  lesson_complete: "progress",
  course_complete: "progress",
  certificate_generated: "progress",
  lesson_feedback_submit: "feedback",
};
const ENGAGEMENT_EVENTS = Object.keys(EVENT_TYPE);
const INTERACTION_EVENTS = [
  "accordion_open", "reveal_open", "tab_switch", "audio_play", "video_start",
  "video_complete", "resource_click",
];
const FUNNEL_STEPS = [
  "course_view", "lesson_view", "lesson_page_view", "quiz_complete",
  "lesson_complete", "course_complete",
];
// Events worth merging for the per-lesson leaderboard (a values() call per
// event; keep the list short).
const LESSON_SLUG_EVENTS = [
  "lesson_page_view", "lesson_view", "quiz_complete", "lesson_complete",
];

export type NameCount = { name: string; count: number };

// ── Engagement ───────────────────────────────────────────────────────────────

export interface EngagementReport {
  property: UmamiSource;
  totals: { totalEvents: number };
  byType: NameCount[];
  byUserType: NameCount[];
  topLessons: NameCount[];
  topInteractions: NameCount[];
  eventsDaily: { date: string; count: number }[];
}

async function _getEngagementReport(range: UmamiRange): Promise<EngagementReport> {
  const [counts, series, userTypes, ...lessonValueSets] = await Promise.all([
    eventCounts(range),
    eventSeries(range),
    eventDataValues(range, "lesson_page_view", "user_type"),
    ...LESSON_SLUG_EVENTS.map((ev) => eventDataValues(range, ev, "lesson_slug")),
  ]);

  const byTypeMap = new Map<string, number>();
  let totalEvents = 0;
  for (const [event, count] of counts) {
    const type = EVENT_TYPE[event];
    if (!type) continue;
    totalEvents += count;
    byTypeMap.set(type, (byTypeMap.get(type) ?? 0) + count);
  }

  const lessons = new Map<string, number>();
  for (const set of lessonValueSets) {
    for (const v of set) lessons.set(v.name, (lessons.get(v.name) ?? 0) + v.count);
  }

  const desc = (a: NameCount, b: NameCount) => b.count - a.count;
  return {
    property: UMAMI_SOURCE,
    totals: { totalEvents },
    byType: [...byTypeMap.entries()].map(([name, count]) => ({ name, count })).sort(desc),
    byUserType: userTypes.sort(desc),
    topLessons: [...lessons.entries()].map(([name, count]) => ({ name, count })).sort(desc).slice(0, 15),
    topInteractions: INTERACTION_EVENTS
      .map((name) => ({ name, count: counts.get(name) ?? 0 }))
      .filter((r) => r.count > 0)
      .sort(desc),
    eventsDaily: sumSeries(series, ENGAGEMENT_EVENTS),
  };
}
export const getEngagementReport = cached(_getEngagementReport, "umami-engagement", {
  revalidate: 43200,
  tags: [TAGS.umamiEngagement],
});

// ── Course funnel & completion ───────────────────────────────────────────────

export interface FunnelReport {
  property: UmamiSource;
  steps: NameCount[]; // ordered course_view → … → course_complete
  completionsByCourse: NameCount[];
  completionsByLesson: NameCount[];
}

async function _getFunnelReport(range: UmamiRange): Promise<FunnelReport> {
  const [counts, byCourse, byLesson] = await Promise.all([
    eventCounts(range),
    eventDataValues(range, "course_complete", "course_slug"),
    eventDataValues(range, "lesson_complete", "lesson_slug"),
  ]);
  const desc = (a: NameCount, b: NameCount) => b.count - a.count;
  return {
    property: UMAMI_SOURCE,
    steps: FUNNEL_STEPS.map((step) => ({ name: step, count: counts.get(step) ?? 0 })),
    completionsByCourse: byCourse.sort(desc),
    completionsByLesson: byLesson.sort(desc).slice(0, 15),
  };
}
export const getFunnelReport = cached(_getFunnelReport, "umami-funnel", {
  revalidate: 43200,
  tags: [TAGS.umamiFunnel],
});

// ── Lumen (AI editor) ───────────────────────────────────────────────────────

export interface LumenReport {
  property: UmamiSource;
  totals: {
    sessions: number;
    promptClicks: number;
    responses: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    avgTokensPerResponse: number;
  };
  // Umami's event-data API can count-by-value but not sum-by-value per group,
  // so scenarios report responses rather than the old per-scenario token sums.
  byScenario: {
    scenario: string;
    sessions: number;
    promptClicks: number;
    responses: number;
  }[];
  topPrompts: NameCount[];
  responsesDaily: { date: string; count: number }[];
}

async function _getLumenReport(range: UmamiRange): Promise<LumenReport> {
  const [
    counts, series, sessionsByScenario, clicksByScenario, responsesByScenario,
    topPrompts, totalTokens, inputTokens, outputTokens,
  ] = await Promise.all([
    eventCounts(range),
    eventSeries(range),
    eventDataValues(range, "ai_session_start", "session_type"),
    eventDataValues(range, "ai_prompt_click", "session_type"),
    eventDataValues(range, "ai_prompt_response", "session_type"),
    eventDataValues(range, "ai_prompt_click", "prompt_label"),
    eventDataSum(range, "ai_prompt_response", "total_tokens"),
    eventDataSum(range, "ai_prompt_response", "input_tokens"),
    eventDataSum(range, "ai_prompt_response", "output_tokens"),
  ]);

  const scenarios = new Map<
    string,
    { sessions: number; promptClicks: number; responses: number }
  >();
  const bump = (
    rows: NameCount[],
    key: "sessions" | "promptClicks" | "responses"
  ) => {
    for (const r of rows) {
      const entry =
        scenarios.get(r.name) ?? { sessions: 0, promptClicks: 0, responses: 0 };
      entry[key] += r.count;
      scenarios.set(r.name, entry);
    }
  };
  bump(sessionsByScenario, "sessions");
  bump(clicksByScenario, "promptClicks");
  bump(responsesByScenario, "responses");

  const responses = counts.get("ai_prompt_response") ?? 0;
  // Some senders omit total_tokens and only send input/output — fall back to
  // their sum so the headline KPI stays meaningful.
  const total = totalTokens > 0 ? totalTokens : inputTokens + outputTokens;
  return {
    property: UMAMI_SOURCE,
    totals: {
      sessions: counts.get("ai_session_start") ?? 0,
      promptClicks: counts.get("ai_prompt_click") ?? 0,
      responses,
      totalTokens: total,
      inputTokens,
      outputTokens,
      avgTokensPerResponse: responses > 0 ? Math.round(total / responses) : 0,
    },
    byScenario: [...scenarios.entries()]
      .map(([scenario, v]) => ({ scenario, ...v }))
      .sort((a, b) => b.sessions - a.sessions),
    topPrompts: topPrompts.sort((a, b) => b.count - a.count).slice(0, 25),
    responsesDaily: series.get("ai_prompt_response") ?? [],
  };
}
export const getLumenReport = cached(_getLumenReport, "umami-lumen", {
  revalidate: 43200,
  tags: [TAGS.umamiLumen],
});
