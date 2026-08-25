// Weekly Umami → Firestore archive rollups (docs/analytics-decision.md §4).
//
// Umami Cloud deletes raw data after 2 years; these daily rollup docs are the
// "ours forever" copy — funder reports, term-vs-term questions, and insurance
// against any future tool switch. Daily granularity, per-lesson breakdowns,
// Lumen included. Written idempotently (same doc IDs overwrite), so re-running
// a day is always safe and recent days are re-written each run to pick up
// late-arriving events.
//
// Firestore layout:
//   analytics_daily/{YYYY-MM-DD}                      — site-wide day totals
//   analytics_daily_lessons/{YYYY-MM-DD}_{course}_{lesson} — per-lesson day

import { umamiFetch } from "./umami";
import { getCourseStructure } from "./sanity-structure";
import { getAdminDb } from "./firebase-admin";
import { aliasCourse } from "./course-aliases";

// First day with only real data (the 22 Jul demo-seed day is excluded, same
// epoch as the live reports).
export const ROLLUP_EPOCH = "2026-07-23";
const TIMEZONE = "Australia/Sydney";
// Cap work per invocation so the Vercel function stays inside its time limit;
// missing older days are picked up by subsequent runs.
const MAX_DAYS_PER_RUN = 25;
// Always re-write this many trailing days: events can arrive late, and the
// current day at run time is partial.
const REDO_RECENT_DAYS = 8;

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
function dayStartMs(date: string): number {
  const utcMidnight = new Date(`${date}T00:00:00Z`).getTime();
  // Two passes so a DST transition on the day itself still resolves correctly.
  let ts = utcMidnight - tzOffsetMs(utcMidnight);
  ts = utcMidnight - tzOffsetMs(ts);
  return ts;
}

const todaySydney = () =>
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

// ── per-day assembly ─────────────────────────────────────────────────────────

const LESSON_EVENT_FIELDS: Record<string, string> = {
  pageViews: "lesson_page_view",
  quizCompletes: "quiz_complete",
  inlineQuizCompletes: "inline_quiz_complete",
  certificates: "certificate_generated",
  feedback: "lesson_feedback_submit",
};
const INTERACTION_EVENTS = [
  "accordion_open", "reveal_open", "tab_switch", "audio_play",
  "video_start", "video_complete", "resource_click",
];

export interface DayRollup {
  date: string;
  stats: { pageviews: number; visitors: number; visits: number; totaltime: number };
  teacherStats: { pageviews: number; visitors: number; visits: number; totaltime: number };
  events: Record<string, number>;
  courseViews: Record<string, number>;
  lumen: {
    sessions: number;
    promptClicks: number;
    responses: number;
    inputTokens: number;
    outputTokens: number;
    scenarioSessions: Record<string, number>;
  };
}

export interface LessonRollup {
  date: string;
  courseSlug: string;
  lessonSlug: string;
  pageViews: number;
  quizCompletes: number;
  inlineQuizCompletes: number;
  certificates: number;
  feedback: number;
  interactions: number;
}

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

async function buildDay(
  date: string,
  lessonToCourse: Map<string, string>,
  pool: <T>(fn: () => Promise<T>) => Promise<T>
): Promise<{ day: DayRollup; lessons: LessonRollup[] }> {
  const startAt = dayStartMs(date);
  const nextDay = new Date(`${date}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const endAt = dayStartMs(nextDay.toISOString().slice(0, 10)) - 1;

  const values = (event: string, propertyName: string) =>
    pool(() =>
      umamiFetch<XY[]>("/event-data/values", { startAt, endAt, event, propertyName }).then(
        (rows) =>
          rows
            .map((r) => ({ name: rowName(r), count: rowCount(r) }))
            .filter((r) => r.name !== "")
      )
    );
  const sumTokens = (propertyName: string) =>
    values("ai_prompt_response", propertyName).then((rows) =>
      rows.reduce((acc, r) => acc + (Number(r.name) || 0) * r.count, 0)
    );

  const [stats, teacherStats, eventRows, courseViewRows, scenarioRows, inputTokens, outputTokens] =
    await Promise.all([
      pool(() => umamiFetch<Record<string, unknown>>("/stats", { startAt, endAt })),
      pool(() =>
        umamiFetch<Record<string, unknown>>("/stats", { startAt, endAt, tag: "teacher" })
      ),
      pool(() =>
        umamiFetch<XY[]>("/metrics", { type: "event", startAt, endAt, limit: 500 })
      ),
      values("course_view", "course_slug"),
      values("ai_session_start", "session_type"),
      sumTokens("input_tokens"),
      sumTokens("output_tokens"),
    ]);

  const lessonValueSets = Object.fromEntries(
    await Promise.all(
      Object.entries(LESSON_EVENT_FIELDS).map(async ([field, event]) => [
        field,
        await values(event, "lesson_slug"),
      ])
    )
  ) as Record<string, { name: string; count: number }[]>;
  const interactionSets = await Promise.all(
    INTERACTION_EVENTS.map((ev) => values(ev, "lesson_slug"))
  );

  const events: Record<string, number> = {};
  for (const r of eventRows) {
    const name = rowName(r);
    if (name) events[name] = rowCount(r);
  }

  const courseViews: Record<string, number> = {};
  for (const r of courseViewRows) {
    const slug = aliasCourse(r.name);
    courseViews[slug] = (courseViews[slug] ?? 0) + r.count;
  }

  const scenarioSessions: Record<string, number> = {};
  for (const r of scenarioRows) scenarioSessions[r.name] = r.count;

  // Per-lesson docs — one per lesson that saw any activity this day.
  const lessons = new Map<string, LessonRollup>();
  const lessonDoc = (slug: string): LessonRollup => {
    let doc = lessons.get(slug);
    if (!doc) {
      doc = {
        date,
        courseSlug: lessonToCourse.get(slug) ?? "unknown",
        lessonSlug: slug,
        pageViews: 0,
        quizCompletes: 0,
        inlineQuizCompletes: 0,
        certificates: 0,
        feedback: 0,
        interactions: 0,
      };
      lessons.set(slug, doc);
    }
    return doc;
  };
  for (const [field, rows] of Object.entries(lessonValueSets)) {
    for (const r of rows) {
      const doc = lessonDoc(r.name) as unknown as Record<string, number>;
      doc[field] += r.count;
    }
  }
  for (const set of interactionSets) {
    for (const r of set) lessonDoc(r.name).interactions += r.count;
  }

  return {
    day: {
      date,
      stats: statBlock(stats),
      teacherStats: statBlock(teacherStats),
      events,
      courseViews,
      lumen: {
        sessions: events["ai_session_start"] ?? 0,
        promptClicks: events["ai_prompt_click"] ?? 0,
        responses: events["ai_prompt_response"] ?? 0,
        inputTokens,
        outputTokens,
        scenarioSessions,
      },
    },
    lessons: [...lessons.values()],
  };
}

// ── the run ──────────────────────────────────────────────────────────────────

export interface RollupResult {
  dryRun: boolean;
  processed: string[];
  lessonDocs: number;
  remainingMissing: number;
  sample?: { day: DayRollup; lessons: LessonRollup[] };
}

export async function runRollup(opts: {
  dryRun?: boolean;
  maxDays?: number;
}): Promise<RollupResult> {
  const dryRun = opts.dryRun ?? false;
  const maxDays = Math.min(opts.maxDays ?? MAX_DAYS_PER_RUN, 60);

  const db = dryRun ? null : await getAdminDb();
  if (!dryRun && !db) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not configured — the rollup has nowhere to write. Add the service-account JSON to the environment (or call with ?dry=1)."
    );
  }

  const today = todaySydney(); // rollup covers full days only: epoch .. yesterday
  const allDays = [...dayRange(ROLLUP_EPOCH, today)];

  const existing = new Set<string>();
  if (db) {
    const snap = await db.collection("analytics_daily").select().get();
    for (const doc of snap.docs) existing.add(doc.id);
  }

  const recent = new Set(allDays.slice(-REDO_RECENT_DAYS));
  const toDo = allDays
    .filter((d) => !existing.has(d) || recent.has(d))
    .slice(0, maxDays);
  const remainingMissing =
    allDays.filter((d) => !existing.has(d) || recent.has(d)).length - toDo.length;

  const structure = await getCourseStructure();
  const lessonToCourse = new Map<string, string>();
  for (const course of structure) {
    for (const lesson of course.lessons) lessonToCourse.set(lesson.slug, course.slug);
  }

  const pool = makePool(5);
  let lessonDocs = 0;
  let sample: RollupResult["sample"];

  // Days run sequentially (each already fans out ~18 API calls internally).
  for (const date of toDo) {
    const { day, lessons } = await buildDay(date, lessonToCourse, pool);
    lessonDocs += lessons.length;
    if (!sample) sample = { day, lessons };
    if (db) {
      const batch = db.batch();
      batch.set(db.collection("analytics_daily").doc(date), {
        ...day,
        updatedAt: new Date().toISOString(),
      });
      for (const lesson of lessons) {
        batch.set(
          db
            .collection("analytics_daily_lessons")
            .doc(`${date}_${lesson.courseSlug}_${lesson.lessonSlug}`),
          { ...lesson, updatedAt: new Date().toISOString() }
        );
      }
      await batch.commit();
    }
  }

  return { dryRun, processed: toDo, lessonDocs, remainingMissing, sample };
}
