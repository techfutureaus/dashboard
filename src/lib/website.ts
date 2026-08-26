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
import { aliasCourse } from "./course-aliases";

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
// When the site started sending the lesson-scoped page_key on events.
export const PAGE_KEY_SINCE = "2026-08-26";
const SESSION_SAMPLE = 1000;
const TIMEZONE = "Australia/Sydney";

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

export interface LumenSlice {
  sessions: number;
  promptClicks: number;
  responses: number;
}

export interface PageReport {
  slug: string;
  title: string;
  views: number;
  /** Interaction total. Unique slugs count the full history via page_slug;
   * slugs repeated across lessons (introduction/overview) count via the
   * lesson-scoped page_key the site added on 26 Aug 2026 — exact, but only
   * from that date. */
  interactions: number;
  interactionsSince?: string; // set when the page_key path was used
  lumenFlows: string[];
  lumen: LumenSlice | null; // null when the page embeds no Lumen activity
}

export interface LessonReport {
  slug: string;
  title: string;
  number: number; // 1-based position in the CMS lesson order
  lessonViews: number;
  pageViews: number;
  interactions: number;
  interactionBreakdown: Record<string, number>; // per interaction event
  quizCompletes: number;
  inlineQuizCompletes: number;
  certificates: number;
  feedback: number;
  lumen: LumenSlice | null; // summed over the lesson's embedded Lumen flows
  pages: PageReport[];
}

export interface CourseReport {
  slug: string;
  title: string;
  courseViews: number;
  lessonViews: number;
  lessonPageViews: number;
  interactions: number;
  quizCompletes: number;
  inlineQuizCompletes: number;
  certificates: number;
  feedback: number;
  lumen: LumenSlice;
  lessons: LessonReport[];
}

export interface DeviceMonth {
  month: string; // YYYY-MM
  all: NameCount[];
  teacher: NameCount[];
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
    // Full-history split via lesson_page_view user_type. Historical
    // "authenticated" events (pre-collapse, always educator accounts) are
    // folded into teacher here.
    eventUserTypes: NameCount[];
    daily: DailyPoint[];
    // From the sessions API (sampled up to 1000 most recent sessions in
    // range): how many visitors browsed beyond a single page, and how many
    // came back for another visit.
    depth: { sessions: number; multiPage: number; returning: number };
  };
  geography: {
    // "anonymous" is all-visitors minus the teacher-tagged slice, row by row.
    anonymous: GeoBreakdown;
    teacher: GeoBreakdown;
  };
  deviceMonthly: DeviceMonth[];
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
    byScenario: {
      scenario: string;
      sessions: number;
      promptClicks: number;
      responses: number;
      // Where this scenario is embedded in course content (from Sanity).
      location: { lessonTitle: string; lessonNumber: number; pageTitle: string } | null;
    }[];
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
  const pool = makePool(12);
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

  // Everything below shares the pool, so kicking every phase off up-front
  // (instead of awaiting them in sequence) lets the pool stay saturated —
  // this is what keeps a date-range change fast.
  const structurePromise = getCourseStructure();
  const teachersPromise = buildTeacherSection(range, pool);
  const interactionsPromise = Promise.all([
    Promise.all(
      INTERACTION_EVENTS.map(async (ev) =>
        [ev, await pool(() => eventDataValues(range, ev, "lesson_slug"))] as const
      )
    ),
    Promise.all(
      INTERACTION_EVENTS.map(async (ev) =>
        [ev, await pool(() => eventDataValues(range, ev, "page_slug"))] as const
      )
    ),
    Promise.all(
      INTERACTION_EVENTS.map(async (ev) =>
        [ev, await pool(() => eventDataValues(range, ev, "page_key"))] as const
      )
    ),
  ]);
  const depthPromise = (async () => {
    type SessionRow = { views?: number; visits?: number };
    const pageSize = 200;
    const pages = await Promise.all(
      Array.from({ length: SESSION_SAMPLE / pageSize }, (_, i) =>
        pool(() =>
          umamiFetch<{ data?: SessionRow[] } | SessionRow[]>("/sessions", {
            startAt, endAt, page: i + 1, pageSize,
          })
        ).catch(() => [] as SessionRow[])
      )
    );
    const out = { sessions: 0, multiPage: 0, returning: 0 };
    for (const res of pages) {
      for (const s of Array.isArray(res) ? res : res.data ?? []) {
        out.sessions++;
        if ((s.views ?? 0) >= 2) out.multiPage++;
        if ((s.visits ?? 0) >= 2) out.returning++;
      }
    }
    return out;
  })();

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
    userTypesRaw,
    courseViewsBySlug,
    lessonViewEvents,
    lessonPageViewEvents,
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
    values("lesson_view", "lesson_slug"),
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

  const [interactionsByLesson, interactionsByPage, interactionsByPageKey] =
    await interactionsPromise;
  const depth = await depthPromise;

  // Device mix per month, for the devices-over-time view. Month boundaries in
  // report-timezone terms; bounded to the selected range (≤ 13 buckets).
  const months: string[] = [];
  {
    const first = new Date(startAt);
    const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    while (cursor.getTime() <= endAt && months.length < 13) {
      months.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const deviceMonthly: DeviceMonth[] = await Promise.all(
    months.map(async (month) => {
      const mStart = Math.max(new Date(`${month}-01T00:00:00+10:00`).getTime(), startAt);
      const next = new Date(`${month}-01T00:00:00+10:00`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const mEnd = Math.min(next.getTime() - 1, endAt);
      const monthMetric = (extra: Record<string, string | number> = {}) =>
        pool(() =>
          umamiFetch<XY[]>("/metrics", {
            type: "device", startAt: mStart, endAt: mEnd, limit: 20, ...extra,
          }).then((rows) =>
            rows
              .map((r) => ({ name: String(xyName(r)), count: xyCount(r) }))
              .filter((r) => r.name !== "")
          )
        );
      const [all, teacher] = await Promise.all([
        monthMetric(),
        monthMetric({ tag: "teacher" }),
      ]);
      return { month, all, teacher };
    })
  );

  const structure = await structurePromise;
  const teachers = await teachersPromise;

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
  const lessonViewMap = asMap(lessonViewEvents);
  const lessonPageViewMap = asMap(lessonPageViewEvents);
  const quizMap = asMap(lessonQuiz);
  const inlineQuizMap = asMap(lessonInlineQuiz);
  const certMap = asMap(lessonCerts);
  const feedbackMap = asMap(lessonFeedback);
  const courseViewMap = new Map<string, number>();
  for (const r of courseViewsBySlug) {
    const slug = aliasCourse(r.name);
    courseViewMap.set(slug, (courseViewMap.get(slug) ?? 0) + r.count);
  }

  // Interaction totals + per-event breakdowns, by lesson slug.
  const interactionMap = new Map<string, number>();
  const interactionDetail = new Map<string, Record<string, number>>();
  for (const [event, rows] of interactionsByLesson) {
    for (const r of rows) {
      interactionMap.set(r.name, (interactionMap.get(r.name) ?? 0) + r.count);
      const detail = interactionDetail.get(r.name) ?? {};
      detail[event] = (detail[event] ?? 0) + r.count;
      interactionDetail.set(r.name, detail);
    }
  }

  // Per-page interactions — attributable only where the page slug is unique
  // across all lessons (page_slug is the only key the events carry).
  const pageSlugOwners = new Map<string, number>();
  for (const course of structure) {
    for (const lesson of course.lessons) {
      for (const p of lesson.pages) {
        pageSlugOwners.set(p.slug, (pageSlugOwners.get(p.slug) ?? 0) + 1);
      }
    }
  }
  const pageInteractionMap = new Map<string, number>();
  for (const [, rows] of interactionsByPage) {
    for (const r of rows) {
      pageInteractionMap.set(r.name, (pageInteractionMap.get(r.name) ?? 0) + r.count);
    }
  }
  const pageKeyInteractionMap = new Map<string, number>();
  for (const [, rows] of interactionsByPageKey) {
    for (const r of rows) {
      pageKeyInteractionMap.set(r.name, (pageKeyInteractionMap.get(r.name) ?? 0) + r.count);
    }
  }

  // Lumen flow → per-scenario stats, and flow locations from the structure.
  const scenarioStats = new Map<string, LumenSlice>();
  const bumpFlow = (rows: NameCount[], key: keyof LumenSlice) => {
    for (const r of rows) {
      const s =
        scenarioStats.get(r.name) ?? { sessions: 0, promptClicks: 0, responses: 0 };
      s[key] += r.count;
      scenarioStats.set(r.name, s);
    }
  };
  bumpFlow(lumenSessionsByScenario, "sessions");
  bumpFlow(lumenClicksByScenario, "promptClicks");
  bumpFlow(lumenResponsesByScenario, "responses");
  const sumFlows = (flows: string[]): LumenSlice | null => {
    if (flows.length === 0) return null;
    const out = { sessions: 0, promptClicks: 0, responses: 0 };
    for (const f of flows) {
      const s = scenarioStats.get(f);
      if (s) {
        out.sessions += s.sessions;
        out.promptClicks += s.promptClicks;
        out.responses += s.responses;
      }
    }
    return out;
  };
  const flowLocation = new Map<
    string,
    { lessonTitle: string; lessonNumber: number; pageTitle: string }
  >();

  // Per-page views from URL metrics: /courses/{course}/{lesson}/{page}.
  const pageViewsByPath = new Map<string, number>();
  for (const r of urls) {
    const m = r.name.match(/^\/courses\/([^/]+)\/([^/]+)\/([^/?]+)/);
    if (!m) continue;
    const key = `${aliasCourse(m[1])}/${m[2]}/${m[3]}`;
    pageViewsByPath.set(key, (pageViewsByPath.get(key) ?? 0) + r.count);
  }

  const courses: CourseReport[] = structure.map((course: CourseNode) => {
    const lessons: LessonReport[] = course.lessons.map((lesson, lessonIndex) => {
      const lessonNumber = lessonIndex + 1;
      const lessonFlows: string[] = [];
      const pages: PageReport[] = lesson.pages.map((p) => {
        lessonFlows.push(...p.lumenFlows);
        for (const f of p.lumenFlows) {
          if (!flowLocation.has(f)) {
            flowLocation.set(f, {
              lessonTitle: lesson.title,
              lessonNumber,
              pageTitle: p.title,
            });
          }
        }
        const uniqueSlug = pageSlugOwners.get(p.slug) === 1;
        return {
          slug: p.slug,
          title: p.title,
          views: pageViewsByPath.get(`${course.slug}/${lesson.slug}/${p.slug}`) ?? 0,
          interactions: uniqueSlug
            ? pageInteractionMap.get(p.slug) ?? 0
            : pageKeyInteractionMap.get(`${lesson.slug}/${p.slug}`) ?? 0,
          ...(uniqueSlug ? {} : { interactionsSince: PAGE_KEY_SINCE }),
          lumenFlows: p.lumenFlows,
          lumen: sumFlows(p.lumenFlows),
        };
      });
      // Quiz + teacher-overview pages live at fixed paths outside the CMS page list.
      for (const extra of ["quiz", "teacher-overview"]) {
        const views = pageViewsByPath.get(`${course.slug}/${lesson.slug}/${extra}`);
        if (views) {
          pages.push({
            slug: extra,
            title: `(${extra.replace("-", " ")})`,
            views,
            interactions: 0,
            lumenFlows: [],
            lumen: null,
          });
        }
      }
      return {
        slug: lesson.slug,
        title: lesson.title,
        number: lessonNumber,
        lessonViews: lessonViewMap.get(lesson.slug) ?? 0,
        pageViews: lessonPageViewMap.get(lesson.slug) ?? 0,
        interactions: interactionMap.get(lesson.slug) ?? 0,
        interactionBreakdown: interactionDetail.get(lesson.slug) ?? {},
        quizCompletes: quizMap.get(lesson.slug) ?? 0,
        inlineQuizCompletes: inlineQuizMap.get(lesson.slug) ?? 0,
        certificates: certMap.get(lesson.slug) ?? 0,
        feedback: feedbackMap.get(lesson.slug) ?? 0,
        lumen: sumFlows([...new Set(lessonFlows)]),
        pages,
      };
    });
    const sum = (f: (l: LessonReport) => number) =>
      lessons.reduce((a, l) => a + f(l), 0);
    return {
      slug: course.slug,
      title: course.title,
      courseViews: courseViewMap.get(course.slug) ?? 0,
      lessonViews: sum((l) => l.lessonViews),
      lessonPageViews: sum((l) => l.pageViews),
      interactions: sum((l) => l.interactions),
      quizCompletes: sum((l) => l.quizCompletes),
      inlineQuizCompletes: sum((l) => l.inlineQuizCompletes),
      certificates: sum((l) => l.certificates),
      feedback: sum((l) => l.feedback),
      lumen: {
        sessions: sum((l) => l.lumen?.sessions ?? 0),
        promptClicks: sum((l) => l.lumen?.promptClicks ?? 0),
        responses: sum((l) => l.lumen?.responses ?? 0),
      },
      lessons,
    };
  });

  // Historical "authenticated" events were always educator accounts whose
  // role read failed (the site stopped emitting the bucket on 21 Aug) — fold
  // them into teacher so the split isn't misleading.
  const userTypeMap = new Map<string, number>();
  for (const r of userTypesRaw) {
    const name = r.name === "authenticated" ? "teacher" : r.name;
    userTypeMap.set(name, (userTypeMap.get(name) ?? 0) + r.count);
  }
  const eventUserTypes = [...userTypeMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Anonymous slice = everyone minus the teacher-tagged rows, per value.
  const minus = (all: NameCount[], teacher: NameCount[]): NameCount[] => {
    const t = new Map(teacher.map((r) => [r.name, r.count]));
    return all
      .map((r) => ({ name: r.name, count: Math.max(0, r.count - (t.get(r.name) ?? 0)) }))
      .filter((r) => r.count > 0);
  };

  const responses = counts.get("ai_prompt_response") ?? 0;
  const totalTokens = lumenInput + lumenOutput;

  return {
    property: UMAMI_SOURCE,
    tagSince: TAG_SINCE,
    audience: {
      total: statBlock(totalStats),
      teacher: statBlock(teacherStats),
      eventUserTypes,
      daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      depth,
    },
    geography: {
      anonymous: {
        countries: minus(countries, tCountries),
        regions: minus(regions, tRegions),
        cities: minus(cities, tCities),
        devices: minus(devices, tDevices),
      },
      teacher: {
        countries: tCountries,
        regions: tRegions,
        cities: tCities,
        devices: tDevices,
      },
    },
    deviceMonthly,
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
      byScenario: [...scenarioStats.entries()]
        .map(([scenario, v]) => ({
          scenario,
          ...v,
          location: flowLocation.get(scenario) ?? null,
        }))
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
