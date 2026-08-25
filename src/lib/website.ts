import { cached } from "./api-response";
import { TAGS } from "./cache-tags";
import {
  UMAMI_SOURCE,
  umamiFetch,
  rangeToMs,
  eventCounts,
  eventDataValues,
  eventDataSum,
  eventSeries,
  type UmamiRange,
  type NameCount,
} from "./umami";
import { getCourseStructure, type CourseNode } from "./sanity-structure";
import { getSchoolsByAnalyticsId, schoolsAvailable } from "./schools";

// The "Website" report: one payload behind the single-page TechFutures
// website dashboard. Course/lesson/page rows come from the live Sanity
// structure (so future courses appear automatically) and are decorated with
// Umami numbers; teacher rows are pseudonymous (analyticsId prefix + school).
//
// Data caveats baked into the shapes below:
// - The teacher/anonymous split on *pageviews, time, geography, devices*
//   exists only from TAG_SINCE (when the tracker's data-tag shipped).
//   Custom events carry user_type for the site's whole history.
// - Umami's event-data values endpoint returns at most 100 distinct values,
//   so token sums are top-100 approximations.
export const TAG_SINCE = "2026-08-21";
const TIMEZONE = "Australia/Sydney";

// The AI course's pre-25-Jul slug — folded into the current one everywhere.
const COURSE_SLUG_ALIASES: Record<string, string> = {
  "ai-course": "intro-to-ai",
};

// ── shapes ───────────────────────────────────────────────────────────────────

export interface StatBlock {
  pageviews: number;
  visitors: number;
  visits: number;
  totaltime: number; // seconds, across all visits
}

export interface DailyPoint {
  date: string; // YYYYMMDD in report timezone
  pageviews: number;
  sessions: number;
  teacherPageviews: number;
  teacherSessions: number;
}

export interface GeoBreakdown {
  countries: NameCount[];
  regions: NameCount[];
  cities: NameCount[];
  devices: NameCount[];
}

export interface LessonReport {
  slug: string;
  title: string;
  pageViews: number;
  interactions: number;
  quizCompletes: number;
  inlineQuizCompletes: number;
  certificates: number;
  feedback: number;
  pages: { slug: string; title: string; views: number }[];
}

export interface CourseReport {
  slug: string;
  title: string;
  courseViews: number;
  lessonPageViews: number;
  quizCompletes: number;
  certificates: number;
  lessons: LessonReport[];
}

export interface TeacherRow {
  code: string; // pseudonymous — analyticsId prefix, never a name
  school: string | null;
  visits: number;
  views: number;
  events: number;
  firstSeen: string;
  lastSeen: string;
  region: string | null;
  device: string | null;
  lessons: string[]; // lesson slugs visited
}

export interface SchoolRow {
  school: string;
  teachers: number;
  visits: number;
  views: number;
  lastSeen: string;
}

export interface WebsiteReport {
  property: typeof UMAMI_SOURCE;
  tagSince: string;
  audience: {
    total: StatBlock;
    teacher: StatBlock; // tag-filtered — only meaningful from tagSince
    eventUserTypes: NameCount[]; // full-history split via lesson_page_view
    daily: DailyPoint[];
  };
  geography: {
    all: GeoBreakdown;
    teacher: GeoBreakdown;
  };
  courses: CourseReport[];
  lumen: {
    sessions: number;
    promptClicks: number;
    responses: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgTokensPerResponse: number;
    avgResponseMs: number;
    byScenario: { scenario: string; sessions: number; promptClicks: number; responses: number }[];
    topPrompts: NameCount[];
    responsesDaily: { date: string; count: number }[];
  };
  teachers: {
    identifiedTeachers: number;
    returningTeachers: number;
    totalVisits: number;
    unidentifiedSessions: number;
    schoolsJoined: boolean;
    rows: TeacherRow[];
    schools: SchoolRow[];
  };
}

// ── small utilities ──────────────────────────────────────────────────────────

// Umami Cloud tolerates bursts poorly on ~30 parallel calls; run them through
// a small pool instead.
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

const toDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: TIMEZONE }).replace(/-/g, "");

type XY = { x?: string | null; y?: number };
const xyName = (r: XY) => r.x ?? "";
const xyCount = (r: XY) => Number(r.y ?? 0) || 0;

function statBlock(raw: Record<string, unknown>): StatBlock {
  const n = (v: unknown) =>
    typeof v === "number" ? v : Number((v as { value?: number })?.value ?? 0) || 0;
  return {
    pageviews: n(raw.pageviews),
    visitors: n(raw.visitors),
    visits: n(raw.visits),
    totaltime: n(raw.totaltime),
  };
}

const aliasCourse = (slug: string) => COURSE_SLUG_ALIASES[slug] ?? slug;

// ── report assembly ──────────────────────────────────────────────────────────

const INTERACTION_EVENTS = [
  "accordion_open",
  "reveal_open",
  "tab_switch",
  "audio_play",
  "video_start",
  "video_complete",
  "resource_click",
];

async function _getWebsiteReport(range: UmamiRange): Promise<WebsiteReport> {
  const { startAt, endAt } = rangeToMs(range);
  const pool = makePool(6);
  const metrics = (type: string, extra: Record<string, string | number> = {}) =>
    pool(() =>
      umamiFetch<XY[]>("/metrics", { type, startAt, endAt, limit: 500, ...extra }).then(
        (rows) =>
          rows
            .map((r) => ({ name: String(xyName(r)), count: xyCount(r) }))
            .filter((r) => r.name !== "")
      )
    );
  const values = (event: string, propertyName: string) =>
    pool(() => eventDataValues(range, event, propertyName));

  const structurePromise = getCourseStructure();

  const [
    totalStats,
    teacherStats,
    totalPv,
    teacherPv,
    countries,
    regions,
    cities,
    devices,
    tCountries,
    tRegions,
    tCities,
    tDevices,
    urls,
    counts,
    series,
    userTypes,
    courseViewsBySlug,
    lessonViews,
    lessonQuiz,
    lessonInlineQuiz,
    lessonCerts,
    lessonFeedback,
    lumenSessionsByScenario,
    lumenClicksByScenario,
    lumenResponsesByScenario,
    lumenPrompts,
    lumenInput,
    lumenOutput,
    lumenResponseMsSum,
  ] = await Promise.all([
    pool(() => umamiFetch<Record<string, unknown>>("/stats", { startAt, endAt })),
    pool(() => umamiFetch<Record<string, unknown>>("/stats", { startAt, endAt, tag: "teacher" })),
    pool(() =>
      umamiFetch<{ pageviews: XY[]; sessions: XY[] }>("/pageviews", {
        startAt, endAt, unit: "day", timezone: TIMEZONE,
      })
    ),
    pool(() =>
      umamiFetch<{ pageviews: XY[]; sessions: XY[] }>("/pageviews", {
        startAt, endAt, unit: "day", timezone: TIMEZONE, tag: "teacher",
      })
    ),
    metrics("country"),
    metrics("region"),
    metrics("city"),
    metrics("device"),
    metrics("country", { tag: "teacher" }),
    metrics("region", { tag: "teacher" }),
    metrics("city", { tag: "teacher" }),
    metrics("device", { tag: "teacher" }),
    metrics("url"),
    pool(() => eventCounts(range)),
    pool(() => eventSeries(range)),
    values("lesson_page_view", "user_type"),
    values("course_view", "course_slug"),
    values("lesson_page_view", "lesson_slug"),
    values("quiz_complete", "lesson_slug"),
    values("inline_quiz_complete", "lesson_slug"),
    values("certificate_generated", "lesson_slug"),
    values("lesson_feedback_submit", "lesson_slug"),
    values("ai_session_start", "session_type"),
    values("ai_prompt_click", "session_type"),
    values("ai_prompt_response", "session_type"),
    values("ai_prompt_click", "prompt_label"),
    pool(() => eventDataSum(range, "ai_prompt_response", "input_tokens")),
    pool(() => eventDataSum(range, "ai_prompt_response", "output_tokens")),
    pool(() => eventDataSum(range, "ai_prompt_response", "response_ms")),
  ]);

  // Per-lesson interaction totals (accordions, reveals, tabs, media, links).
  const interactionSets = await Promise.all(
    INTERACTION_EVENTS.map((ev) => values(ev, "lesson_slug"))
  );

  const structure = await structurePromise;
  const teachers = await buildTeacherSection(range, pool);

  // Daily series: merge the total and teacher-tagged pageview series by day.
  const daily = new Map<string, DailyPoint>();
  const addSeries = (
    rows: XY[],
    key: keyof Omit<DailyPoint, "date">
  ) => {
    for (const r of rows) {
      const date = r.x ? toDay(String(r.x)) : "";
      if (date.length !== 8) continue;
      const point =
        daily.get(date) ??
        { date, pageviews: 0, sessions: 0, teacherPageviews: 0, teacherSessions: 0 };
      point[key] += xyCount(r);
      daily.set(date, point);
    }
  };
  addSeries(totalPv.pageviews, "pageviews");
  addSeries(totalPv.sessions, "sessions");
  addSeries(teacherPv.pageviews, "teacherPageviews");
  addSeries(teacherPv.sessions, "teacherSessions");

  // Courses: Sanity structure decorated with Umami numbers. Lesson slugs are
  // globally unique, so per-lesson event values can be attached directly.
  const asMap = (rows: NameCount[]) => new Map(rows.map((r) => [r.name, r.count]));
  const lessonViewMap = asMap(lessonViews);
  const quizMap = asMap(lessonQuiz);
  const inlineQuizMap = asMap(lessonInlineQuiz);
  const certMap = asMap(lessonCerts);
  const feedbackMap = asMap(lessonFeedback);
  const courseViewMap = new Map<string, number>();
  for (const r of courseViewsBySlug) {
    const slug = aliasCourse(r.name);
    courseViewMap.set(slug, (courseViewMap.get(slug) ?? 0) + r.count);
  }
  const interactionMap = new Map<string, number>();
  for (const set of interactionSets) {
    for (const r of set) {
      interactionMap.set(r.name, (interactionMap.get(r.name) ?? 0) + r.count);
    }
  }

  // Per-page views from URL metrics: /courses/{course}/{lesson}/{page}.
  const pageViewsByPath = new Map<string, number>();
  for (const r of urls) {
    const m = r.name.match(/^\/courses\/([^/]+)\/([^/]+)\/([^/?]+)/);
    if (!m) continue;
    const key = `${aliasCourse(m[1])}/${m[2]}/${m[3]}`;
    pageViewsByPath.set(key, (pageViewsByPath.get(key) ?? 0) + r.count);
  }

  const courses: CourseReport[] = structure.map((course: CourseNode) => {
    const lessons: LessonReport[] = course.lessons.map((lesson) => {
      const pages = lesson.pages.map((p) => ({
        slug: p.slug,
        title: p.title,
        views: pageViewsByPath.get(`${course.slug}/${lesson.slug}/${p.slug}`) ?? 0,
      }));
      // Quiz + teacher-overview pages live at fixed paths outside the CMS page list.
      for (const extra of ["quiz", "teacher-overview"]) {
        const views = pageViewsByPath.get(`${course.slug}/${lesson.slug}/${extra}`);
        if (views) pages.push({ slug: extra, title: `(${extra.replace("-", " ")})`, views });
      }
      return {
        slug: lesson.slug,
        title: lesson.title,
        pageViews: lessonViewMap.get(lesson.slug) ?? 0,
        interactions: interactionMap.get(lesson.slug) ?? 0,
        quizCompletes: quizMap.get(lesson.slug) ?? 0,
        inlineQuizCompletes: inlineQuizMap.get(lesson.slug) ?? 0,
        certificates: certMap.get(lesson.slug) ?? 0,
        feedback: feedbackMap.get(lesson.slug) ?? 0,
        pages,
      };
    });
    return {
      slug: course.slug,
      title: course.title,
      courseViews: courseViewMap.get(course.slug) ?? 0,
      lessonPageViews: lessons.reduce((a, l) => a + l.pageViews, 0),
      quizCompletes: lessons.reduce((a, l) => a + l.quizCompletes, 0),
      certificates: lessons.reduce((a, l) => a + l.certificates, 0),
      lessons,
    };
  });

  // Lumen
  const scenarios = new Map<
    string,
    { sessions: number; promptClicks: number; responses: number }
  >();
  const bumpScenario = (
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
  bumpScenario(lumenSessionsByScenario, "sessions");
  bumpScenario(lumenClicksByScenario, "promptClicks");
  bumpScenario(lumenResponsesByScenario, "responses");

  const responses = counts.get("ai_prompt_response") ?? 0;
  const totalTokens = lumenInput + lumenOutput;

  return {
    property: UMAMI_SOURCE,
    tagSince: TAG_SINCE,
    audience: {
      total: statBlock(totalStats),
      teacher: statBlock(teacherStats),
      eventUserTypes: userTypes.sort((a, b) => b.count - a.count),
      daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    },
    geography: {
      all: { countries, regions, cities, devices },
      teacher: {
        countries: tCountries,
        regions: tRegions,
        cities: tCities,
        devices: tDevices,
      },
    },
    courses,
    lumen: {
      sessions: counts.get("ai_session_start") ?? 0,
      promptClicks: counts.get("ai_prompt_click") ?? 0,
      responses,
      inputTokens: lumenInput,
      outputTokens: lumenOutput,
      totalTokens,
      avgTokensPerResponse: responses > 0 ? Math.round(totalTokens / responses) : 0,
      avgResponseMs: responses > 0 ? Math.round(lumenResponseMsSum / responses) : 0,
      byScenario: [...scenarios.entries()]
        .map(([scenario, v]) => ({ scenario, ...v }))
        .sort((a, b) => b.sessions - a.sessions),
      topPrompts: lumenPrompts.sort((a, b) => b.count - a.count).slice(0, 25),
      responsesDaily: series.get("ai_prompt_response") ?? [],
    },
    teachers,
  };
}

// Teacher section: list teacher-tagged sessions, pull each session's detail
// (which carries the distinct ID the tracker's identify() set) and activity
// (which yields the lessons visited), then aggregate per pseudonymous teacher
// and join schools from Firestore when credentials are configured.
const MAX_TEACHER_SESSIONS = 120;

type SessionSummary = {
  id: string;
  visits: number;
  views: number;
  events: number;
  firstAt: string;
  lastAt: string;
  region?: string | null;
  device?: string | null;
};

async function buildTeacherSection(
  range: UmamiRange,
  pool: <T>(fn: () => Promise<T>) => Promise<T>
): Promise<WebsiteReport["teachers"]> {
  const { startAt, endAt } = rangeToMs(range);
  const list = await pool(() =>
    umamiFetch<{ data?: SessionSummary[] } | SessionSummary[]>("/sessions", {
      startAt,
      endAt,
      tag: "teacher",
      pageSize: MAX_TEACHER_SESSIONS,
    })
  );
  const sessions = (Array.isArray(list) ? list : list.data ?? []).slice(
    0,
    MAX_TEACHER_SESSIONS
  );

  type Agg = {
    analyticsId: string;
    visits: number;
    views: number;
    events: number;
    firstSeen: string;
    lastSeen: string;
    region: string | null;
    device: string | null;
    lessons: Set<string>;
  };
  const byTeacher = new Map<string, Agg>();
  let unidentifiedSessions = 0;

  await Promise.all(
    sessions.map((s) =>
      pool(async () => {
        // The list endpoint omits distinctId; the detail endpoint has it.
        const detail = await umamiFetch<{ distinctId?: string | null }>(
          `/sessions/${s.id}`,
          { startAt, endAt }
        ).catch(() => null);
        const distinctId = detail?.distinctId ?? null;
        if (!distinctId) {
          unidentifiedSessions++;
          return;
        }
        const activity = await umamiFetch<Array<{ urlPath?: string }>>(
          `/sessions/${s.id}/activity`,
          { startAt, endAt }
        ).catch(() => [] as Array<{ urlPath?: string }>);

        const agg =
          byTeacher.get(distinctId) ??
          ({
            analyticsId: distinctId,
            visits: 0,
            views: 0,
            events: 0,
            firstSeen: s.firstAt,
            lastSeen: s.lastAt,
            region: s.region ?? null,
            device: s.device ?? null,
            lessons: new Set<string>(),
          } as Agg);
        agg.visits += s.visits;
        agg.views += s.views;
        agg.events += s.events;
        if (s.firstAt < agg.firstSeen) agg.firstSeen = s.firstAt;
        if (s.lastAt > agg.lastSeen) agg.lastSeen = s.lastAt;
        for (const a of activity) {
          const m = a.urlPath?.match(/^\/courses\/[^/]+\/([^/]+)/);
          if (m) agg.lessons.add(m[1]);
        }
        byTeacher.set(distinctId, agg);
      })
    )
  );

  const aggs = [...byTeacher.values()];
  const schools = await getSchoolsByAnalyticsId(aggs.map((a) => a.analyticsId));
  const joined = await schoolsAvailable();

  const rows: TeacherRow[] = aggs
    .map((a) => ({
      code: a.analyticsId.slice(0, 8),
      school: schools.get(a.analyticsId)?.school ?? null,
      visits: a.visits,
      views: a.views,
      events: a.events,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      region: a.region,
      device: a.device,
      lessons: [...a.lessons].sort(),
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));

  const schoolRows = new Map<string, SchoolRow>();
  for (const r of rows) {
    if (!r.school) continue;
    const row =
      schoolRows.get(r.school) ??
      ({ school: r.school, teachers: 0, visits: 0, views: 0, lastSeen: r.lastSeen } as SchoolRow);
    row.teachers += 1;
    row.visits += r.visits;
    row.views += r.views;
    if (r.lastSeen > row.lastSeen) row.lastSeen = r.lastSeen;
    schoolRows.set(r.school, row);
  }

  return {
    identifiedTeachers: rows.length,
    returningTeachers: rows.filter((r) => r.visits > 1).length,
    totalVisits: rows.reduce((a, r) => a + r.visits, 0),
    unidentifiedSessions,
    schoolsJoined: joined,
    rows,
    schools: [...schoolRows.values()].sort((a, b) => b.visits - a.visits),
  };
}

export const getWebsiteReport = cached(_getWebsiteReport, "umami-website", {
  revalidate: 43200,
  tags: [TAGS.umamiWebsite],
});
