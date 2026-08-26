import { cached } from "./api-response";
import { TAGS } from "./cache-tags";
import { UMAMI_SOURCE, type UmamiRange, type NameCount } from "./umami";
import { getCourseStructure, type CourseNode } from "./sanity-structure";
import { getSchoolsByAnalyticsId, schoolsAvailable } from "./schools";
import { getAdminDb } from "./firebase-admin";
import {
  DAYS_COLLECTION,
  SESSIONS_COLLECTION,
  ARCHIVE_EPOCH,
  ARCHIVE_SCHEMA,
  type ArchiveDay,
  type ArchiveSession,
  type StatBlock,
  type LumenSlice,
} from "./archive-types";
import { dayStartMs, todaySydney } from "./rollup";

// The "Website" report, served ENTIRELY from the Firestore archive that the
// daily rollup cron maintains — the dashboard makes no live Umami calls, and
// the data runs through the last archived day (at most one day behind; the
// UI surfaces this as "data through …"). Course/lesson/page structure still
// comes live from the public Sanity dataset so new content appears
// automatically.
export const TAG_SINCE = "2026-08-21"; // teacher tag epoch
export const PAGE_KEY_SINCE = "2026-08-26"; // lesson-scoped page_key epoch
const SESSION_SCAN_CAP = 10000;

export type { StatBlock };

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

export interface PageReport {
  slug: string;
  title: string;
  views: number;
  interactions: number;
  interactionsSince?: string; // set when the page_key path was used
  lumenFlows: string[];
  lumen: LumenSlice | null;
}

export interface LessonReport {
  slug: string;
  title: string;
  number: number;
  lessonViews: number;
  pageViews: number;
  interactions: number;
  interactionBreakdown: Record<string, number>;
  quizCompletes: number;
  inlineQuizCompletes: number;
  certificates: number;
  feedback: number;
  lumen: LumenSlice | null;
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
  code: string;
  school: string | null;
  visits: number;
  views: number;
  events: number;
  firstSeen: string;
  lastSeen: string;
  region: string | null;
  device: string | null;
  lessons: string[];
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
  dataThrough: string | null; // last archived day (YYYY-MM-DD)
  audience: {
    total: StatBlock;
    teacher: StatBlock;
    eventUserTypes: NameCount[];
    daily: DailyPoint[];
    depth: { sessions: number; multiPage: number; returning: number };
  };
  geography: {
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

// ── helpers ──────────────────────────────────────────────────────────────────

const compactDate = (d: string) => d.replace(/-/g, ""); // YYYY-MM-DD → YYYYMMDD

const sumMaps = (
  into: Map<string, number>,
  from: Record<string, number> | undefined
) => {
  for (const [k, v] of Object.entries(from ?? {})) {
    into.set(k, (into.get(k) ?? 0) + v);
  }
};

const mapToRows = (m: Map<string, number>): NameCount[] =>
  [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

const sumRows = (into: Map<string, number>, rows?: { name: string; count: number }[]) => {
  for (const r of rows ?? []) into.set(r.name, (into.get(r.name) ?? 0) + r.count);
};

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── report assembly (Firestore only) ─────────────────────────────────────────

async function _getWebsiteReport(range: UmamiRange): Promise<WebsiteReport> {
  const db = await getAdminDb();
  if (!db) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not configured — the dashboard serves from the Firestore analytics archive and can't run without it."
    );
  }

  const startDate =
    range.start && range.start > ARCHIVE_EPOCH ? range.start : ARCHIVE_EPOCH;
  const endDate = range.end || todaySydney();

  const structurePromise = getCourseStructure();
  const daysPromise = db
    .collection(DAYS_COLLECTION)
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .orderBy("date")
    .get();
  // Sessions active in the range (both bounds on lastAt → no composite index).
  const startISO = new Date(dayStartMs(startDate)).toISOString();
  const endISO = new Date(dayStartMs(nextDay(endDate))).toISOString();
  const sessionsPromise = db
    .collection(SESSIONS_COLLECTION)
    .where("lastAt", ">=", startISO)
    .where("lastAt", "<=", endISO)
    .limit(SESSION_SCAN_CAP)
    .get();

  const [structure, daysSnap, sessionsSnap] = await Promise.all([
    structurePromise,
    daysPromise,
    sessionsPromise,
  ]);
  const days = daysSnap.docs
    .map((d) => d.data() as ArchiveDay)
    .filter((d) => (d.schema ?? 1) >= ARCHIVE_SCHEMA);
  const sessions = sessionsSnap.docs.map((d) => d.data() as ArchiveSession);
  const dataThrough = days.length > 0 ? days[days.length - 1].date : null;

  // ── audience ──
  const zero = (): StatBlock => ({ pageviews: 0, visitors: 0, visits: 0, totaltime: 0 });
  const total = zero();
  const teacher = zero();
  const addStats = (into: StatBlock, s?: StatBlock) => {
    into.pageviews += s?.pageviews ?? 0;
    into.visits += s?.visits ?? 0;
    into.totaltime += s?.totaltime ?? 0;
  };
  const userTypeTotals = new Map<string, number>();
  const daily: DailyPoint[] = [];
  for (const d of days) {
    addStats(total, d.stats);
    addStats(teacher, d.teacherStats);
    sumMaps(userTypeTotals, d.userTypes);
    daily.push({
      date: compactDate(d.date),
      pageviews: d.stats.pageviews,
      sessions: d.stats.visits,
      teacherPageviews: d.teacherStats.pageviews,
      teacherSessions: d.teacherStats.visits,
    });
  }
  // Unique visitors across the range come from the session archive (daily
  // visitor counts don't sum — the same person appears each day they return).
  total.visitors = sessions.length;
  teacher.visitors = sessions.filter((s) => s.teacher).length;

  const depth = {
    sessions: sessions.length,
    multiPage: sessions.filter((s) => s.views >= 2).length,
    returning: sessions.filter((s) => s.visits >= 2).length,
  };

  // ── geography & devices ──
  const geoAcc = () => ({
    countries: new Map<string, number>(),
    regions: new Map<string, number>(),
    cities: new Map<string, number>(),
    devices: new Map<string, number>(),
  });
  const allGeo = geoAcc();
  const tGeo = geoAcc();
  for (const d of days) {
    sumMaps(allGeo.countries, d.geo?.countries);
    sumMaps(allGeo.regions, d.geo?.regions);
    sumRows(allGeo.cities, d.geo?.cities);
    sumMaps(allGeo.devices, d.devices);
    sumMaps(tGeo.countries, d.teacherGeo?.countries);
    sumMaps(tGeo.regions, d.teacherGeo?.regions);
    sumRows(tGeo.cities, d.teacherGeo?.cities);
    sumMaps(tGeo.devices, d.teacherDevices);
  }
  const minus = (all: NameCount[], t: NameCount[]): NameCount[] => {
    const tm = new Map(t.map((r) => [r.name, r.count]));
    return all
      .map((r) => ({ name: r.name, count: Math.max(0, r.count - (tm.get(r.name) ?? 0)) }))
      .filter((r) => r.count > 0);
  };
  const teacherGeo: GeoBreakdown = {
    countries: mapToRows(tGeo.countries),
    regions: mapToRows(tGeo.regions),
    cities: mapToRows(tGeo.cities),
    devices: mapToRows(tGeo.devices),
  };
  const anonymousGeo: GeoBreakdown = {
    countries: minus(mapToRows(allGeo.countries), teacherGeo.countries),
    regions: minus(mapToRows(allGeo.regions), teacherGeo.regions),
    cities: minus(mapToRows(allGeo.cities), teacherGeo.cities),
    devices: minus(mapToRows(allGeo.devices), teacherGeo.devices),
  };

  const byMonth = new Map<string, { all: Map<string, number>; teacher: Map<string, number> }>();
  for (const d of days) {
    const month = d.date.slice(0, 7);
    const m = byMonth.get(month) ?? { all: new Map(), teacher: new Map() };
    sumMaps(m.all, d.devices);
    sumMaps(m.teacher, d.teacherDevices);
    byMonth.set(month, m);
  }
  const deviceMonthly: DeviceMonth[] = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({ month, all: mapToRows(m.all), teacher: mapToRows(m.teacher) }));

  // ── courses ──
  const courseViewTotals = new Map<string, number>();
  const lessonTotals = new Map<
    string,
    {
      lessonViews: number; pageViews: number; quizCompletes: number;
      inlineQuizCompletes: number; certificates: number; feedback: number;
      interactions: number; interactionBreakdown: Map<string, number>;
    }
  >();
  const pageViewTotals = new Map<string, number>(); // `${lesson} ${page}`
  const pageInteractionTotals = new Map<string, number>(); // by page_slug
  const pageKeyInteractionTotals = new Map<string, number>(); // `${lesson} ${page}`
  const scenarioTotals = new Map<string, LumenSlice>();
  const promptTotals = new Map<string, number>();
  const lumenTotals = {
    inputTokens: 0, outputTokens: 0, responseMsSum: 0,
    sessions: 0, promptClicks: 0, responses: 0,
  };
  const responsesDaily: { date: string; count: number }[] = [];
  const eventTotals = new Map<string, number>();

  for (const d of days) {
    sumMaps(courseViewTotals, d.courses);
    sumMaps(eventTotals, d.events);
    for (const [slug, l] of Object.entries(d.lessons ?? {})) {
      const t = lessonTotals.get(slug) ?? {
        lessonViews: 0, pageViews: 0, quizCompletes: 0, inlineQuizCompletes: 0,
        certificates: 0, feedback: 0, interactions: 0,
        interactionBreakdown: new Map<string, number>(),
      };
      t.lessonViews += l.lessonViews;
      t.pageViews += l.pageViews;
      t.quizCompletes += l.quizCompletes;
      t.inlineQuizCompletes += l.inlineQuizCompletes;
      t.certificates += l.certificates;
      t.feedback += l.feedback;
      t.interactions += l.interactions;
      sumMaps(t.interactionBreakdown, l.interactionBreakdown);
      lessonTotals.set(slug, t);
    }
    for (const [lessonSlug, pages] of Object.entries(d.pages ?? {})) {
      for (const [pageSlug, views] of Object.entries(pages)) {
        const key = `${lessonSlug} ${pageSlug}`;
        pageViewTotals.set(key, (pageViewTotals.get(key) ?? 0) + views);
      }
    }
    sumMaps(pageInteractionTotals, d.pageInteractions);
    for (const [lessonSlug, pages] of Object.entries(d.pageKeyInteractions ?? {})) {
      for (const [pageSlug, n] of Object.entries(pages)) {
        const key = `${lessonSlug} ${pageSlug}`;
        pageKeyInteractionTotals.set(key, (pageKeyInteractionTotals.get(key) ?? 0) + n);
      }
    }
    for (const [flow, s] of Object.entries(d.lumen?.scenarios ?? {})) {
      const t = scenarioTotals.get(flow) ?? { sessions: 0, promptClicks: 0, responses: 0 };
      t.sessions += s.sessions;
      t.promptClicks += s.promptClicks;
      t.responses += s.responses;
      scenarioTotals.set(flow, t);
    }
    sumRows(promptTotals, d.lumen?.prompts);
    lumenTotals.inputTokens += d.lumen?.inputTokens ?? 0;
    lumenTotals.outputTokens += d.lumen?.outputTokens ?? 0;
    lumenTotals.responseMsSum += d.lumen?.responseMsSum ?? 0;
    lumenTotals.sessions += d.lumen?.sessions ?? 0;
    lumenTotals.promptClicks += d.lumen?.promptClicks ?? 0;
    lumenTotals.responses += d.lumen?.responses ?? 0;
    if ((d.lumen?.responses ?? 0) > 0) {
      responsesDaily.push({ date: compactDate(d.date), count: d.lumen.responses });
    }
  }

  // Which page slugs are unique across lessons (page_slug attribution is only
  // safe for those; the rest use the page_key totals).
  const pageSlugOwners = new Map<string, number>();
  for (const course of structure) {
    for (const lesson of course.lessons) {
      for (const p of lesson.pages) {
        pageSlugOwners.set(p.slug, (pageSlugOwners.get(p.slug) ?? 0) + 1);
      }
    }
  }

  const sumFlows = (flows: string[]): LumenSlice | null => {
    if (flows.length === 0) return null;
    const out = { sessions: 0, promptClicks: 0, responses: 0 };
    for (const f of flows) {
      const s = scenarioTotals.get(f);
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

  const courses: CourseReport[] = structure.map((course: CourseNode) => {
    const lessons: LessonReport[] = course.lessons.map((lesson, lessonIndex) => {
      const lessonNumber = lessonIndex + 1;
      const totals = lessonTotals.get(lesson.slug);
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
        const key = `${lesson.slug} ${p.slug}`;
        return {
          slug: p.slug,
          title: p.title,
          views: pageViewTotals.get(key) ?? 0,
          interactions: uniqueSlug
            ? pageInteractionTotals.get(p.slug) ?? 0
            : pageKeyInteractionTotals.get(key) ?? 0,
          ...(uniqueSlug ? {} : { interactionsSince: PAGE_KEY_SINCE }),
          lumenFlows: p.lumenFlows,
          lumen: sumFlows(p.lumenFlows),
        };
      });
      for (const extra of ["quiz", "teacher-overview"]) {
        const views = pageViewTotals.get(`${lesson.slug} ${extra}`);
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
        lessonViews: totals?.lessonViews ?? 0,
        pageViews: totals?.pageViews ?? 0,
        interactions: totals?.interactions ?? 0,
        interactionBreakdown: Object.fromEntries(totals?.interactionBreakdown ?? []),
        quizCompletes: totals?.quizCompletes ?? 0,
        inlineQuizCompletes: totals?.inlineQuizCompletes ?? 0,
        certificates: totals?.certificates ?? 0,
        feedback: totals?.feedback ?? 0,
        lumen: sumFlows([...new Set(lessonFlows)]),
        pages,
      };
    });
    const sum = (f: (l: LessonReport) => number) =>
      lessons.reduce((a, l) => a + f(l), 0);
    return {
      slug: course.slug,
      title: course.title,
      courseViews: courseViewTotals.get(course.slug) ?? 0,
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

  // ── teachers ──
  type Agg = {
    analyticsId: string;
    visits: number; views: number; events: number;
    firstSeen: string; lastSeen: string;
    region: string | null; device: string | null;
    lessons: Set<string>;
  };
  const byTeacher = new Map<string, Agg>();
  let unidentifiedSessions = 0;
  for (const s of sessions) {
    if (!s.teacher) continue;
    if (!s.distinctId) {
      unidentifiedSessions++;
      continue;
    }
    const agg =
      byTeacher.get(s.distinctId) ??
      ({
        analyticsId: s.distinctId,
        visits: 0, views: 0, events: 0,
        firstSeen: s.firstAt, lastSeen: s.lastAt,
        region: s.region, device: s.device,
        lessons: new Set<string>(),
      } as Agg);
    agg.visits += s.visits;
    agg.views += s.views;
    agg.events += s.events;
    if (s.firstAt < agg.firstSeen) agg.firstSeen = s.firstAt;
    if (s.lastAt > agg.lastSeen) agg.lastSeen = s.lastAt;
    for (const l of s.lessons ?? []) agg.lessons.add(l);
    byTeacher.set(s.distinctId, agg);
  }
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

  const responses = lumenTotals.responses;
  const totalTokens = lumenTotals.inputTokens + lumenTotals.outputTokens;

  return {
    property: UMAMI_SOURCE,
    tagSince: TAG_SINCE,
    dataThrough,
    audience: {
      total,
      teacher,
      eventUserTypes: mapToRows(userTypeTotals),
      daily,
      depth,
    },
    geography: { anonymous: anonymousGeo, teacher: teacherGeo },
    deviceMonthly,
    courses,
    lumen: {
      sessions: lumenTotals.sessions,
      promptClicks: lumenTotals.promptClicks,
      responses,
      inputTokens: lumenTotals.inputTokens,
      outputTokens: lumenTotals.outputTokens,
      totalTokens,
      avgTokensPerResponse: responses > 0 ? Math.round(totalTokens / responses) : 0,
      avgResponseMs:
        responses > 0 ? Math.round(lumenTotals.responseMsSum / responses) : 0,
      byScenario: [...scenarioTotals.entries()]
        .map(([scenario, v]) => ({
          scenario,
          ...v,
          location: flowLocation.get(scenario) ?? null,
        }))
        .sort((a, b) => b.sessions - a.sessions),
      topPrompts: mapToRows(promptTotals).slice(0, 25),
      responsesDaily,
    },
    teachers: {
      identifiedTeachers: rows.length,
      returningTeachers: rows.filter((r) => r.visits > 1).length,
      totalVisits: rows.reduce((a, r) => a + r.visits, 0),
      unidentifiedSessions,
      schoolsJoined: joined,
      rows,
      schools: [...schoolRows.values()].sort((a, b) => b.visits - a.visits),
    },
  };
}

// The cache key carries the payload-shape version: Vercel's data cache
// survives deployments, so an unversioned key can feed a newly-deployed page
// a stale old-shape payload (seen in prod, Aug 2026 — client crashed reading
// a field the cached report predated). Bump the suffix whenever
// WebsiteReport's shape changes; the tag stays stable for cache busting.
export const getWebsiteReport = cached(_getWebsiteReport, "umami-website-v3", {
  revalidate: 43200,
  tags: [TAGS.umamiWebsite],
});
