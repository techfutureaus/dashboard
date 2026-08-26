// Daily Umami → Firestore archive (see archive-types.ts for the layout and
// docs/analytics-decision.md §4 for the original decision).
//
// This job is the ONLY thing that talks to Umami: the dashboard serves
// entirely from the archive, at most one day behind. Runs daily via Vercel
// cron (~3am Sydney), backfills any missing days since the epoch, re-writes
// the trailing couple of days (late events), and upserts recent sessions
// (session rows keep evolving while a visitor returns).

import { umamiFetch } from "./umami";
import { getAdminDb } from "./firebase-admin";
import { aliasCourse } from "./course-aliases";
import {
  DAYS_COLLECTION,
  RAW_COLLECTION,
  SESSIONS_COLLECTION,
  ARCHIVE_EPOCH,
  ARCHIVE_SCHEMA,
  type ArchiveDay,
  type ArchiveSession,
  type LessonDay,
  type GeoMaps,
  type LumenSlice,
} from "./archive-types";

export const ROLLUP_EPOCH = ARCHIVE_EPOCH;
const TIMEZONE = "Australia/Sydney";
// Work caps per invocation (Vercel functions get 60s): each day costs ~50
// API calls. Missed days are picked up by the next run — the job is
// idempotent and self-healing.
const MAX_DAYS_PER_RUN = 12;
const REDO_RECENT_DAYS = 2;
const SESSION_WINDOW_DAYS = 7; // upsert sessions active in the last week
const RAW_PAGE_SIZE = 200;
const RAW_MAX_PAGES = 20;

// ── Sydney day boundaries (DST-correct, no tz library) ───────────────────────

function tzOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(
    +p.year, +p.month - 1, +p.day,
    p.hour === "24" ? 0 : +p.hour, +p.minute, +p.second
  );
  return asUtc - utcMs;
}

/** UTC ms of local midnight starting the given YYYY-MM-DD in Sydney. */
export function dayStartMs(date: string): number {
  const utcMidnight = new Date(`${date}T00:00:00Z`).getTime();
  let ts = utcMidnight - tzOffsetMs(utcMidnight);
  ts = utcMidnight - tzOffsetMs(ts);
  return ts;
}

export const todaySydney = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });

function* dayRange(from: string, toExclusive: string): Generator<string> {
  for (
    let d = new Date(`${from}T12:00:00Z`);
    d.toISOString().slice(0, 10) < toExclusive;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    yield d.toISOString().slice(0, 10);
  }
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── shared bits ──────────────────────────────────────────────────────────────

type XY = { x?: string | null; y?: number; value?: string | null; total?: number };
const rowName = (r: XY) => String(r.x ?? r.value ?? "");
const rowCount = (r: XY) => Number(r.y ?? r.total ?? 0) || 0;

function makePool(size: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= size) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
type Pool = ReturnType<typeof makePool>;

function statBlock(raw: Record<string, unknown>) {
  const n = (v: unknown) =>
    typeof v === "number" ? v : Number((v as { value?: number })?.value ?? 0) || 0;
  return {
    pageviews: n(raw.pageviews),
    visitors: n(raw.visitors),
    visits: n(raw.visits),
    totaltime: n(raw.totaltime),
  };
}

const toMap = (rows: { name: string; count: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.name, r.count]));

const LESSON_EVENT_FIELDS: Record<string, keyof LessonDay> = {
  lesson_view: "lessonViews",
  lesson_page_view: "pageViews",
  quiz_complete: "quizCompletes",
  inline_quiz_complete: "inlineQuizCompletes",
  certificate_generated: "certificates",
  lesson_feedback_submit: "feedback",
};
const INTERACTION_EVENTS = [
  "accordion_open", "reveal_open", "tab_switch", "audio_play",
  "video_start", "video_complete", "resource_click",
];

// ── per-day assembly (~50 Umami calls, all pooled) ───────────────────────────

async function buildDay(date: string, pool: Pool): Promise<ArchiveDay> {
  const startAt = dayStartMs(date);
  const endAt = dayStartMs(nextDay(date)) - 1;

  const values = (event: string, propertyName: string) =>
    pool(() =>
      umamiFetch<XY[]>("/event-data/values", { startAt, endAt, event, propertyName }).then(
        (rows) =>
          rows
            .map((r) => ({ name: rowName(r), count: rowCount(r) }))
            .filter((r) => r.name !== "")
      )
    );
  const metrics = (type: string, extra: Record<string, string | number> = {}) =>
    pool(() =>
      umamiFetch<XY[]>("/metrics", { type, startAt, endAt, limit: 500, ...extra }).then(
        (rows) =>
          rows
            .map((r) => ({ name: rowName(r), count: rowCount(r) }))
            .filter((r) => r.name !== "")
      )
    );
  const numericSum = (propertyName: string) =>
    values("ai_prompt_response", propertyName).then((rows) =>
      rows.reduce((acc, r) => acc + (Number(r.name) || 0) * r.count, 0)
    );
  const geoMaps = async (tag?: string): Promise<GeoMaps> => {
    const extra: Record<string, string | number> = tag ? { tag } : {};
    const [countries, regions, cities] = await Promise.all([
      metrics("country", extra),
      metrics("region", extra),
      metrics("city", extra),
    ]);
    return { countries: toMap(countries), regions: toMap(regions), cities };
  };

  const [
    stats, teacherStats, eventRows, urls,
    geo, teacherGeo, devices, teacherDevices,
    userTypesRaw, courseViews,
    lessonSets, interactionsByLesson, interactionsByPage, interactionsByPageKey,
    scenarioSessions, scenarioClicks, scenarioResponses, promptRows,
    inputTokens, outputTokens, responseMsSum,
  ] = await Promise.all([
    pool(() => umamiFetch<Record<string, unknown>>("/stats", { startAt, endAt })),
    pool(() => umamiFetch<Record<string, unknown>>("/stats", { startAt, endAt, tag: "teacher" })),
    metrics("event"),
    metrics("url"),
    geoMaps(),
    geoMaps("teacher"),
    metrics("device").then(toMap),
    metrics("device", { tag: "teacher" }).then(toMap),
    values("lesson_page_view", "user_type"),
    values("course_view", "course_slug"),
    Promise.all(
      Object.keys(LESSON_EVENT_FIELDS).map(async (ev) => [ev, await values(ev, "lesson_slug")] as const)
    ),
    Promise.all(
      INTERACTION_EVENTS.map(async (ev) => [ev, await values(ev, "lesson_slug")] as const)
    ),
    Promise.all(
      INTERACTION_EVENTS.map(async (ev) => [ev, await values(ev, "page_slug")] as const)
    ),
    Promise.all(
      INTERACTION_EVENTS.map(async (ev) => [ev, await values(ev, "page_key")] as const)
    ),
    values("ai_session_start", "session_type"),
    values("ai_prompt_click", "session_type"),
    values("ai_prompt_response", "session_type"),
    values("ai_prompt_click", "prompt_label"),
    numericSum("input_tokens"),
    numericSum("output_tokens"),
    numericSum("response_ms"),
  ]);

  const events = toMap(eventRows);

  // Historical "authenticated" events were educator accounts whose role read
  // failed — fold into teacher at write time so reads never re-litigate it.
  const userTypes: Record<string, number> = {};
  for (const r of userTypesRaw) {
    const name = r.name === "authenticated" ? "teacher" : r.name;
    userTypes[name] = (userTypes[name] ?? 0) + r.count;
  }

  const courses: Record<string, number> = {};
  for (const r of courseViews) {
    const slug = aliasCourse(r.name);
    courses[slug] = (courses[slug] ?? 0) + r.count;
  }

  const lessons: Record<string, LessonDay> = {};
  const lesson = (slug: string): LessonDay =>
    (lessons[slug] ??= {
      lessonViews: 0, pageViews: 0, quizCompletes: 0, inlineQuizCompletes: 0,
      certificates: 0, feedback: 0, interactions: 0, interactionBreakdown: {},
    });
  for (const [ev, rows] of lessonSets) {
    const field = LESSON_EVENT_FIELDS[ev];
    for (const r of rows) (lesson(r.name)[field] as number) += r.count;
  }
  for (const [ev, rows] of interactionsByLesson) {
    for (const r of rows) {
      const l = lesson(r.name);
      l.interactions += r.count;
      l.interactionBreakdown[ev] = (l.interactionBreakdown[ev] ?? 0) + r.count;
    }
  }

  // Per-page views from URL paths: /courses/{course}/{lesson}/{page}.
  const pages: Record<string, Record<string, number>> = {};
  for (const r of urls) {
    const m = r.name.match(/^\/courses\/[^/]+\/([^/]+)\/([^/?]+)/);
    if (!m) continue;
    const byLesson = (pages[m[1]] ??= {});
    byLesson[m[2]] = (byLesson[m[2]] ?? 0) + r.count;
  }

  const pageInteractions: Record<string, number> = {};
  for (const [, rows] of interactionsByPage) {
    for (const r of rows) {
      pageInteractions[r.name] = (pageInteractions[r.name] ?? 0) + r.count;
    }
  }
  const pageKeyInteractions: Record<string, Record<string, number>> = {};
  for (const [, rows] of interactionsByPageKey) {
    for (const r of rows) {
      const [lessonSlug, pageSlug] = r.name.split("/");
      if (!lessonSlug || !pageSlug) continue;
      const byLesson = (pageKeyInteractions[lessonSlug] ??= {});
      byLesson[pageSlug] = (byLesson[pageSlug] ?? 0) + r.count;
    }
  }

  const scenarios: Record<string, LumenSlice> = {};
  const bumpFlow = (rows: { name: string; count: number }[], key: keyof LumenSlice) => {
    for (const r of rows) {
      const s = (scenarios[r.name] ??= { sessions: 0, promptClicks: 0, responses: 0 });
      s[key] += r.count;
    }
  };
  bumpFlow(scenarioSessions, "sessions");
  bumpFlow(scenarioClicks, "promptClicks");
  bumpFlow(scenarioResponses, "responses");

  return {
    date,
    schema: ARCHIVE_SCHEMA,
    updatedAt: new Date().toISOString(),
    stats: statBlock(stats),
    teacherStats: statBlock(teacherStats),
    events,
    userTypes,
    courses,
    lessons,
    pages,
    pageInteractions,
    pageKeyInteractions,
    geo,
    teacherGeo,
    devices,
    teacherDevices,
    lumen: {
      sessions: events["ai_session_start"] ?? 0,
      promptClicks: events["ai_prompt_click"] ?? 0,
      responses: events["ai_prompt_response"] ?? 0,
      inputTokens,
      outputTokens,
      responseMsSum,
      scenarios,
      prompts: promptRows,
    },
  };
}

// ── bronze: raw event rows per day ───────────────────────────────────────────

type RawEventRow = Record<string, unknown> & { id?: string };

async function fetchRawEvents(date: string, pool: Pool): Promise<RawEventRow[]> {
  const startAt = dayStartMs(date);
  const endAt = dayStartMs(nextDay(date)) - 1;
  const out: RawEventRow[] = [];
  for (let page = 1; page <= RAW_MAX_PAGES; page++) {
    const res = await pool(() =>
      umamiFetch<{ data?: RawEventRow[] } | RawEventRow[]>("/events", {
        startAt, endAt, page, pageSize: RAW_PAGE_SIZE,
      })
    );
    const rows = Array.isArray(res) ? res : res.data ?? [];
    out.push(...rows);
    if (rows.length < RAW_PAGE_SIZE) break;
  }
  return out;
}

// ── sessions upsert ──────────────────────────────────────────────────────────

type UmamiSession = {
  id: string;
  firstAt?: string; lastAt?: string;
  visits?: number; views?: number; events?: number;
  country?: string | null; region?: string | null; city?: string | null;
  device?: string | null;
};

async function fetchSessions(
  startAt: number,
  endAt: number,
  pool: Pool,
  extra: Record<string, string | number> = {}
): Promise<UmamiSession[]> {
  const out: UmamiSession[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await pool(() =>
      umamiFetch<{ data?: UmamiSession[] } | UmamiSession[]>("/sessions", {
        startAt, endAt, page, pageSize: 200, ...extra,
      })
    );
    const rows = Array.isArray(res) ? res : res.data ?? [];
    out.push(...rows);
    if (rows.length < 200) break;
  }
  return out;
}

async function buildSessions(
  startAt: number,
  endAt: number,
  pool: Pool
): Promise<ArchiveSession[]> {
  const [all, tagged] = await Promise.all([
    fetchSessions(startAt, endAt, pool),
    fetchSessions(startAt, endAt, pool, { tag: "teacher" }),
  ]);
  const teacherIds = new Set(tagged.map((s) => s.id));

  return Promise.all(
    all.map((s) =>
      pool(async () => {
        const teacher = teacherIds.has(s.id);
        let distinctId: string | null = null;
        let lessons: string[] = [];
        if (teacher) {
          // Only teacher sessions warrant the detail + activity round-trips
          // (distinct ID and lessons visited power the teacher table).
          const detail = await umamiFetch<{ distinctId?: string | null }>(
            `/sessions/${s.id}`,
            { startAt, endAt }
          ).catch(() => null);
          distinctId = detail?.distinctId ?? null;
          const activity = await umamiFetch<Array<{ urlPath?: string }>>(
            `/sessions/${s.id}/activity`,
            { startAt, endAt }
          ).catch(() => [] as Array<{ urlPath?: string }>);
          lessons = [
            ...new Set(
              activity.flatMap((a) => {
                const m = a.urlPath?.match(/^\/courses\/[^/]+\/([^/]+)/);
                return m ? [m[1]] : [];
              })
            ),
          ].sort();
        }
        return {
          id: s.id,
          firstAt: s.firstAt ?? new Date(startAt).toISOString(),
          lastAt: s.lastAt ?? s.firstAt ?? new Date(startAt).toISOString(),
          visits: s.visits ?? 0,
          views: s.views ?? 0,
          events: s.events ?? 0,
          country: s.country ?? null,
          region: s.region ?? null,
          city: s.city ?? null,
          device: s.device ?? null,
          teacher,
          distinctId,
          lessons,
          updatedAt: new Date().toISOString(),
        };
      })
    )
  );
}

// ── the run ──────────────────────────────────────────────────────────────────

export interface RollupResult {
  dryRun: boolean;
  processed: string[];
  rawEvents: number;
  sessionsUpserted: number;
  remainingMissing: number;
  stoppedEarly: boolean; // ran out of time budget; next run continues
  elapsedMs: number;
  sample?: ArchiveDay;
}

// Stop starting new work at this point so the function returns cleanly
// (cache bust + JSON summary) instead of being killed at Vercel's 60s cap.
// The job is idempotent and detects missing days, so anything unstarted is
// simply picked up by the next daily run.
const DEFAULT_BUDGET_MS = 42_000;

export async function runRollup(opts: {
  dryRun?: boolean;
  maxDays?: number;
  budgetMs?: number;
}): Promise<RollupResult> {
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const outOfBudget = () => Date.now() - startedAt > budgetMs;
  const dryRun = opts.dryRun ?? false;
  const maxDays = Math.min(opts.maxDays ?? MAX_DAYS_PER_RUN, 40);

  const db = dryRun ? null : await getAdminDb();
  if (!dryRun && !db) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not configured — the rollup has nowhere to write. Add the service-account JSON to the environment (or call with ?dry=1)."
    );
  }

  const today = todaySydney(); // full days only: epoch .. yesterday
  const allDays = [...dayRange(ROLLUP_EPOCH, today)];

  const existing = new Set<string>();
  if (db) {
    const snap = await db.collection(DAYS_COLLECTION).select("schema").get();
    for (const doc of snap.docs) {
      // Old-schema docs count as missing so a schema bump self-migrates.
      if ((doc.data().schema ?? 1) >= ARCHIVE_SCHEMA) existing.add(doc.id);
    }
  }

  const recent = new Set(allDays.slice(-REDO_RECENT_DAYS));
  const toDo = allDays
    .filter((d) => !existing.has(d) || recent.has(d))
    .slice(0, maxDays);
  const remainingMissing =
    allDays.filter((d) => !existing.has(d) || recent.has(d)).length - toDo.length;

  const pool = makePool(12);

  // Sessions FIRST: they're the most freshness-sensitive output (the teacher
  // table), so if the time budget runs out it's a day of aggregates that
  // waits for the next run, never the teacher data. On normal runs the
  // window is the trailing week; when backfilling, widen to the oldest day
  // being processed.
  const trailingStart = [...dayRange(ROLLUP_EPOCH, today)].slice(-SESSION_WINDOW_DAYS)[0];
  const oldestToDo = toDo[0] ?? today;
  const windowStartDate = oldestToDo < trailingStart ? oldestToDo : trailingStart;
  const sessions = await buildSessions(dayStartMs(windowStartDate), Date.now(), pool);
  if (db) {
    // Firestore batches cap at 500 writes.
    for (let i = 0; i < sessions.length; i += 450) {
      const batch = db.batch();
      for (const s of sessions.slice(i, i + 450)) {
        batch.set(db.collection(SESSIONS_COLLECTION).doc(s.id), s);
      }
      await batch.commit();
    }
  }

  let rawEvents = 0;
  let sample: ArchiveDay | undefined;
  const processed: string[] = [];
  let stoppedEarly = false;

  for (const date of toDo) {
    if (outOfBudget()) {
      stoppedEarly = true;
      break;
    }
    const [day, raw] = await Promise.all([
      buildDay(date, pool),
      fetchRawEvents(date, pool),
    ]);
    rawEvents += raw.length;
    if (!sample) sample = day;
    if (db) {
      const batch = db.batch();
      batch.set(db.collection(DAYS_COLLECTION).doc(date), day);
      batch.set(db.collection(RAW_COLLECTION).doc(date), {
        date,
        count: raw.length,
        updatedAt: new Date().toISOString(),
        events: raw,
      });
      await batch.commit();
    }
    processed.push(date);
  }

  return {
    dryRun,
    processed,
    rawEvents,
    sessionsUpserted: sessions.length,
    remainingMissing: remainingMissing + (toDo.length - processed.length),
    stoppedEarly,
    elapsedMs: Date.now() - startedAt,
    sample,
  };
}
