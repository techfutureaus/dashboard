"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { UmamiReportPage } from "@/components/UmamiReportPage";
import { useUmamiWebsite } from "@/hooks/useUmamiData";
import {
  Section,
  KpiCard,
  EmptyHint,
  Banner,
  SegmentedControl,
  InfoTip,
} from "@/components/dashboard-bits";
import type {
  WebsiteReport,
  DailyPoint,
  CourseReport,
  LessonReport,
} from "@/lib/website";
import type { NameCount } from "@/lib/umami";

export default function WebsitePage() {
  return (
    <UmamiReportPage
      title="Tech Futures Programs Website"
      subtitleFallback="Analytics powered by Umami"
      useData={useUmamiWebsite}
    >
      {(data, rangeLabel) => <WebsiteBody data={data} rangeLabel={rangeLabel} />}
    </UmamiReportPage>
  );
}

// The date-range dropdown in the banner is the single time control: the
// chart bucketing follows the span of data it returns. Short ranges read
// day by day; longer ones step up so the charts stay legible.
function autoGranularity(dayCount: number): Granularity {
  if (dayCount <= 45) return "day";
  if (dayCount <= 200) return "week";
  if (dayCount <= 750) return "month";
  return "quarter";
}

// ── palette (validated: fixed categorical order, never cycled) ───────────────
const PALETTE = [
  "#2563eb", "#f59e0b", "#8b5cf6", "#059669", "#ec4899",
  "#0891b2", "#b45309", "#4338ca", "#65a30d",
];
const OTHER_COLOR = "#6b7280";
const sliceColor = (i: number) => PALETTE[i] ?? OTHER_COLOR;

// ── formatting helpers ───────────────────────────────────────────────────────

const num = (n: number) => n.toLocaleString();

function fmtDuration(totalSeconds: number, visits: number): string {
  if (!visits) return "–";
  const s = Math.round(totalSeconds / visits);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string) => {
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
};
const flag = (code: string) =>
  /^[A-Za-z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)))
    : "";
// Umami regions arrive as ISO 3166-2, e.g. "AU-VIC" → "VIC (AU)".
const regionName = (code: string) => {
  const [country, region] = code.split("-");
  return region ? `${region} (${country})` : code;
};

const fmtDay = (yyyymmdd: string) =>
  new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
  ).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const INTERACTION_LABELS: Record<string, string> = {
  accordion_open: "Accordion opens",
  reveal_open: "Reveal opens",
  tab_switch: "Tab switches",
  audio_play: "Audio plays",
  video_start: "Video starts",
  video_complete: "Video completes",
  resource_click: "Link / resource clicks",
};

// ── trend granularity ────────────────────────────────────────────────────────

type Granularity = "day" | "week" | "month" | "quarter" | "year";

function bucketOf(date: string, g: Granularity): { key: string; label: string } {
  const y = date.slice(0, 4);
  const m = Number(date.slice(4, 6));
  if (g === "day") return { key: date, label: fmtDay(date) };
  if (g === "month")
    return {
      key: `${y}-${date.slice(4, 6)}`,
      label: `${new Date(`${y}-${date.slice(4, 6)}-01`).toLocaleDateString("en-AU", { month: "short" })} ${y}`,
    };
  if (g === "quarter") {
    const q = Math.ceil(m / 3);
    return { key: `${y}-Q${q}`, label: `Q${q} ${y}` };
  }
  if (g === "year") return { key: y, label: y };
  const d = new Date(`${y}-${date.slice(4, 6)}-${date.slice(6, 8)}`);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const key = monday.toISOString().slice(0, 10);
  return {
    key,
    label: `wk ${monday.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`,
  };
}

// Per-bucket pageviews split into Anonymous vs Teachers (anonymous = total
// minus the teacher-tagged slice).
function aggregateTrend(daily: DailyPoint[], g: Granularity) {
  const buckets = new Map<string, { label: string; Anonymous: number; Teachers: number }>();
  for (const d of daily) {
    const { key, label } = bucketOf(d.date, g);
    const b = buckets.get(key) ?? { label, Anonymous: 0, Teachers: 0 };
    b.Anonymous += Math.max(0, d.pageviews - d.teacherPageviews);
    b.Teachers += d.teacherPageviews;
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

// Running totals over the filtered range — 0 up to the period total.
function cumulativeTrend(trend: { label: string; Anonymous: number; Teachers: number }[]) {
  let anon = 0;
  let teach = 0;
  return trend.map((b) => {
    anon += b.Anonymous;
    teach += b.Teachers;
    return { label: b.label, Anonymous: anon, Teachers: teach };
  });
}

const toPie = (rows: NameCount[], max = 6): NameCount[] => {
  const top = rows.slice(0, max);
  const rest = rows.slice(max).reduce((a, r) => a + r.count, 0);
  return rest > 0 ? [...top, { name: "Other", count: rest }] : top;
};

// ── small components ─────────────────────────────────────────────────────────

function Donut({ data, height = 280 }: { data: NameCount[]; height?: number }) {
  if (data.length === 0) return <EmptyHint>No data.</EmptyHint>;
  const total = data.reduce((a, r) => a + r.count, 0);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="name"
            innerRadius="58%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="#ffffff"
            strokeWidth={2}
          >
            {data.map((r, i) => (
              <Cell
                key={r.name}
                fill={r.name === "Other" ? OTHER_COLOR : sliceColor(i)}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => {
              const n = Number(v) || 0;
              return `${num(n)} (${total > 0 ? Math.round((n / total) * 100) : 0}%)`;
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

// The identity legend IS the table: each row carries the swatch matching its
// slice, so there's no separate (duplicated) legend under the donut.
const rowColor = (name: string, pie: NameCount[]): string => {
  const i = pie.findIndex((p) => p.name === name);
  return i >= 0 && pie[i].name !== "Other" ? sliceColor(i) : OTHER_COLOR;
};

function DonutWithTable({
  rows,
  height,
  pieMax = 6,
}: {
  rows: NameCount[]; // sorted desc; `name` labels slice, tooltip, and row alike
  height?: number;
  /** Colored slices before folding into "Other" — e.g. 9 for the states
   * column so every Australian state keeps its own color. */
  pieMax?: number;
}) {
  const pie = toPie(rows, pieMax);
  const [sort, setSort] = useState<{ key: "name" | "count"; dir: 1 | -1 }>({
    key: "count",
    dir: -1,
  });
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const cmp = sort.key === "name" ? a.name.localeCompare(b.name) : a.count - b.count;
      return cmp * sort.dir;
    });
  }, [rows, sort]);
  const pageRows = sorted.slice(page * 15, (page + 1) * 15);
  const header = (label: string, key: "name" | "count") => (
    <button
      onClick={() => {
        setSort((s0) =>
          s0.key === key
            ? { key, dir: (s0.dir * -1) as 1 | -1 }
            : { key, dir: key === "name" ? 1 : -1 }
        );
        setPage(0);
      }}
      className={`uppercase tracking-wide text-[10px] font-semibold whitespace-nowrap ${
        key === "name" ? "text-left" : "text-right w-full"
      } ${sort.key === key ? "text-violet-700" : "text-gray-400 hover:text-gray-700"}`}
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </button>
  );
  return (
    <>
      <Donut data={pie} height={height} />
      {rows.length > 0 && (
        <>
          <table className="w-full text-sm mt-3">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-1">{header("Name", "name")}</th>
                <th className="py-1 text-right">{header("Count", "count")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.name} className="border-b border-gray-100 last:border-0">
                  <td className="py-1.5 text-gray-700">
                    <Swatch color={rowColor(r.name, pie)} />
                    {r.name}
                  </td>
                  <td className="py-1.5 text-right text-gray-900 font-medium">{num(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} setPage={setPage} total={rows.length} perPage={15} />
        </>
      )}
    </>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: React.ReactNode[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[320px]">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            {headers.map((h, i) => (
              <th key={i} className="py-2 pr-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0 align-top">
              {cells.map((c, j) => (
                <td key={j} className="py-2 pr-3 text-gray-700">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── page body ────────────────────────────────────────────────────────────────

type Audience = "anonymous" | "teacher";

function WebsiteBody({ data, rangeLabel }: { data: WebsiteReport; rangeLabel: string }) {
  const granularity = autoGranularity(data.audience.daily.length);
  const [geoAudience, setGeoAudience] = useState<Audience>("anonymous");

  const trend = useMemo(
    () => aggregateTrend(data.audience.daily, granularity),
    [data.audience.daily, granularity]
  );

  const { total, teacher } = data.audience;
  const anonymousVisitors = Math.max(0, total.visitors - teacher.visitors);
  const anonTime = Math.max(0, total.totaltime - teacher.totaltime);
  const anonVisits = Math.max(0, total.visits - teacher.visits);
  const cumulative = useMemo(() => cumulativeTrend(trend), [trend]);
  const [trafficAudience, setTrafficAudience] = useState<Audience>("anonymous");
  const trafficKey = trafficAudience === "teacher" ? "Teachers" : "Anonymous";
  // Audience colors stay fixed everywhere: Anonymous blue, Teachers amber.
  const trafficColor = trafficAudience === "teacher" ? PALETTE[1] : PALETTE[0];
  const geo = data.geography[geoAudience];
  const devices = data.geography[trafficAudience].devices;

  const audienceToggle = (value: Audience, onChange: (v: Audience) => void) => (
    <SegmentedControl
      value={value}
      onChange={onChange}
      options={[
        { value: "anonymous", label: "Anonymous" },
        { value: "teacher", label: "Teachers" },
      ]}
    />
  );

  return (
    <>
      {data.dataThrough && (
        <p className="text-xs text-gray-400 mb-4 -mt-1">
          Data through {fmtDate(`${data.dataThrough}T12:00:00`)} · refreshed daily from the
          analytics archive
        </p>
      )}

      {/* ── Audience ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <KpiCard label="Teachers" value={num(teacher.visitors)} sub="tagged visitors" tone="positive" />
        <KpiCard label="Anonymous" value={num(anonymousVisitors)} sub="mostly students" />
        <KpiCard label="Pageviews" value={num(total.pageviews)} sub={`${num(total.visits)} visits`} />
        <KpiCard
          label="Avg time · teachers"
          value={fmtDuration(teacher.totaltime, teacher.visits)}
          sub="per visit"
        />
        <KpiCard
          label="Avg time · anonymous"
          value={fmtDuration(anonTime, anonVisits)}
          sub="per visit"
        />
        <KpiCard
          label="Returning teachers"
          value={num(data.teachers.returningTeachers)}
          sub="came back more than once"
        />
      </div>

      {/* One audience at a time: teacher volume is always dwarfed by
          anonymous, so both series in one chart makes the teacher data
          unreadable — the toggle drives both traffic charts at once. */}
      <div className="mb-3">{audienceToggle(trafficAudience, setTrafficAudience)}</div>
      <Section
        title="Traffic over time"
          subtitle={rangeLabel}
          info="Pageviews per period for the selected audience."
          exportData={trend}
          exportName="website-trend"
        >
          {trend.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey={trafficKey} fill={trafficColor} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyHint>No traffic in this range.</EmptyHint>
          )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Cumulative traffic"
          subtitle={rangeLabel}
          info="Running pageview total across the filtered range — starts at zero and climbs to the period's total."
          exportData={cumulative}
          exportName="website-trend-cumulative"
        >
          {cumulative.length > 0 ? (
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulative} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey={trafficKey}
                    stroke={trafficColor}
                    fill={trafficColor}
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyHint>No traffic in this range.</EmptyHint>
          )}
        </Section>

        <Section
          title="Devices"
          subtitle={rangeLabel}
          info="Visitor device mix for the selected range and audience — the Anonymous/Teachers toggle above the traffic charts drives this too."
          exportData={devices}
          exportName={`website-devices-${trafficAudience}`}
        >
          <div className="max-w-md mx-auto">
            <DonutWithTable rows={devices} />
          </div>
        </Section>
      </div>

      {/* ── Geography ──────────────────────────────────────────────────── */}
      <Section
        title="Geography"
        subtitle={rangeLabel}
        info="Where visitors are located, by country, state, and city. Toggle between anonymous visitors and teachers."
      >
        <div className="mb-4">{audienceToggle(geoAudience, setGeoAudience)}</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 text-center">
              Countries
            </h3>
            <DonutWithTable
              rows={geo.countries.map((r) => ({
                name: `${flag(r.name)} ${countryName(r.name)}`,
                count: r.count,
              }))}
              height={230}
            />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 text-center">
              States / regions
            </h3>
            <DonutWithTable
              rows={geo.regions.map((r) => ({
                name: `${flag(r.name.split("-")[0])} ${regionName(r.name)}`,
                count: r.count,
              }))}
              height={230}
              pieMax={9}
            />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 text-center">
              Cities
            </h3>
            <DonutWithTable rows={geo.cities} height={230} pieMax={9} />
          </div>
        </div>
      </Section>

      {/* ── Courses ────────────────────────────────────────────────────── */}
      <CoursesSection courses={data.courses} rangeLabel={rangeLabel} />

      {/* ── Lumen ──────────────────────────────────────────────────────── */}
      <LumenSection data={data} rangeLabel={rangeLabel} granularity={granularity} />

      {/* ── Teachers & schools ─────────────────────────────────────────── */}
      <TeachersSection data={data} rangeLabel={rangeLabel} />
    </>
  );
}

// ── courses ──────────────────────────────────────────────────────────────────

type LessonSortKey =
  | "number"
  | "pageViews"
  | "teacherSessions"
  | "interactions"
  | "inlineQuizCompletes"
  | "quizCompletes"
  | "certificates"
  | "feedback"
  | "lumenSessions";

function CoursesSection({
  courses,
  rangeLabel,
}: {
  courses: CourseReport[];
  rangeLabel: string;
}) {
  const defaultSlug =
    courses.find((c) => c.slug === "intro-to-ai")?.slug ?? courses[0]?.slug ?? "";
  const [selected, setSelected] = useState(defaultSlug);
  const [modalLesson, setModalLesson] = useState<LessonReport | null>(null);
  const [sort, setSort] = useState<{ key: LessonSortKey; dir: 1 | -1 }>({
    key: "number",
    dir: 1,
  });

  const course = courses.find((c) => c.slug === selected) ?? courses[0];
  if (!course) return <EmptyHint>No courses published yet.</EmptyHint>;

  const sortValue = (l: LessonReport, key: LessonSortKey): number =>
    key === "lumenSessions" ? l.lumen?.sessions ?? 0 : (l[key] as number);
  const lessons = [...course.lessons].sort(
    (a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * sort.dir
  );

  const header = (label: string, key: LessonSortKey, left = false) => (
    <button
      onClick={() =>
        setSort((s) =>
          s.key === key
            ? { key, dir: (s.dir * -1) as 1 | -1 }
            : { key, dir: key === "number" ? 1 : -1 }
        )
      }
      className={`w-full uppercase tracking-wide text-xs font-semibold whitespace-nowrap ${
        left ? "text-left" : "text-center"
      } ${sort.key === key ? "text-violet-700" : "text-gray-500 hover:text-gray-800"}`}
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </button>
  );

  return (
    <>
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-3">
        Courses
        <InfoTip text="Structure comes from the CMS — new courses, lessons, and pages appear here automatically when published." />
      </h2>
      <div className="mb-4">
        <select
          id="course-select"
          aria-label="Course"
          value={course.slug}
          onChange={(e) => setSelected(e.target.value)}
          className="px-3 py-1.5 bg-white border border-gray-200 rounded-md text-sm text-gray-800"
        >
          {courses.map((c) => (
            <option key={c.slug} value={c.slug}>{c.title}</option>
          ))}
        </select>
      </div>

      <Section
        title={course.title}
        subtitle={rangeLabel}
        info={`Lives at /courses/${course.slug}. Click a column heading to sort; click a lesson row for its full breakdown, including per-page numbers.`}
        exportData={course.lessons.map((l) => ({
          number: l.number,
          lesson: l.title,
          lessonViews: l.lessonViews,
          pageViews: l.pageViews,
          teacherSessions: l.teacherSessions,
          teacherPageViews: l.teacherPageViews,
          anonymousPageViews: l.anonymousPageViews,
          interactions: l.interactions,
          inlineQuizCompletes: l.inlineQuizCompletes,
          quizCompletes: l.quizCompletes,
          certificates: l.certificates,
          feedback: l.feedback,
          lumenSessions: l.lumen?.sessions ?? 0,
        }))}
        exportName={`website-course-${course.slug}`}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
          <KpiCard
            label="Course views"
            value={num(course.courseViews)}
            info="Times the course landing page was viewed."
          />
          <KpiCard
            label="Lesson page views"
            value={num(course.lessonPageViews)}
            info="Views of pages inside this course's lessons."
          />
          <KpiCard
            label="Teacher visits"
            value={num(course.teacherSessions)}
            info="Teacher sessions that reached at least one lesson in this course."
          />
          <KpiCard
            label="Interactions"
            value={num(course.interactions + course.certificates)}
            info="Accordion opens, reveals, tab switches, audio and video plays, link and resource clicks, and certificates generated."
          />
          <KpiCard
            label="Lumen sessions"
            value={num(course.lumen.sessions)}
            info="Sessions in the Lumen AI activities embedded in this course."
          />
          <KpiCard
            label="Quiz completions"
            value={num(course.quizCompletes)}
            info="End-of-lesson quizzes completed (practice-until-correct, so completing always means 100%)."
          />
        </div>

        {course.lessons.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 pr-2 w-2/5">{header("Lesson", "number", true)}</th>
                  <th className="py-2 px-2">{header("Page views", "pageViews")}</th>
                  <th className="py-2 px-2">{header("Teacher visits", "teacherSessions")}</th>
                  <th className="py-2 px-2">{header("Interactions", "interactions")}</th>
                  <th className="py-2 px-2">{header("Inline quizzes", "inlineQuizCompletes")}</th>
                  <th className="py-2 px-2">{header("Quiz done", "quizCompletes")}</th>
                  <th className="py-2 px-2">{header("Certificates", "certificates")}</th>
                  <th className="py-2 px-2">{header("Lumen", "lumenSessions")}</th>
                  <th className="py-2 pl-2">{header("Feedback", "feedback")}</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson) => (
                  <tr
                    key={lesson.slug}
                    onClick={() => setModalLesson(lesson)}
                    className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-violet-50/40"
                  >
                    <td className="py-2 pr-2 font-medium text-gray-800">
                      <span className="text-gray-400 mr-1.5">{lesson.number}.</span>
                      {lesson.title}
                    </td>
                    <td className="py-2 px-2 text-center">{num(lesson.pageViews)}</td>
                    <td className="py-2 px-2 text-center">{num(lesson.teacherSessions)}</td>
                    <td className="py-2 px-2 text-center">{num(lesson.interactions)}</td>
                    <td className="py-2 px-2 text-center">{num(lesson.inlineQuizCompletes)}</td>
                    <td className="py-2 px-2 text-center">{num(lesson.quizCompletes)}</td>
                    <td className="py-2 px-2 text-center">{num(lesson.certificates)}</td>
                    <td className="py-2 px-2 text-center">
                      {lesson.lumen ? num(lesson.lumen.sessions) : "—"}
                    </td>
                    <td className="py-2 pl-2 text-center">{num(lesson.feedback)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-400 mt-2">
              Click a column to sort · click a lesson for its full breakdown.
            </p>
          </div>
        ) : (
          <EmptyHint>No lessons published yet.</EmptyHint>
        )}
      </Section>

      {modalLesson && (
        <LessonModal lesson={modalLesson} onClose={() => setModalLesson(null)} />
      )}
    </>
  );
}

// ── lesson modal ─────────────────────────────────────────────────────────────

type PageSortKey = "index" | "views" | "interactions" | "lumen";

function LessonModal({ lesson, onClose }: { lesson: LessonReport; onClose: () => void }) {
  const [sort, setSort] = useState<{ key: PageSortKey; dir: 1 | -1 }>({ key: "index", dir: 1 });

  const numbered = lesson.pages.map((p, i) => ({ ...p, index: i + 1 }));
  const sortValue = (p: (typeof numbered)[number]): number =>
    sort.key === "index"
      ? p.index
      : sort.key === "views"
        ? p.views
        : sort.key === "interactions"
          ? p.interactions
          : p.lumen?.sessions ?? -1;
  const pages = [...numbered].sort((a, b) => (sortValue(a) - sortValue(b)) * sort.dir);
  const [pagePage, setPagePage] = useState(0);
  const visiblePages = pages.slice(pagePage * 15, (pagePage + 1) * 15);

  const header = (label: string, key: PageSortKey, left = false) => (
    <button
      onClick={() =>
        setSort((s) =>
          s.key === key
            ? { key, dir: (s.dir * -1) as 1 | -1 }
            : { key, dir: key === "index" ? 1 : -1 }
        )
      }
      className={`w-full uppercase tracking-wide text-xs font-semibold whitespace-nowrap ${
        left ? "text-left" : "text-center"
      } ${sort.key === key ? "text-violet-700" : "text-gray-500 hover:text-gray-800"}`}
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </button>
  );

  const interactionRows = Object.entries(lesson.interactionBreakdown).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 md:p-10 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl p-6 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              <span className="text-gray-400">{lesson.number}.</span> {lesson.title}
            </h2>
            <p className="text-sm text-gray-500">/{lesson.slug}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="Lesson views"
            value={num(lesson.lessonViews)}
            info="Times this lesson was opened."
          />
          <KpiCard
            label="Page views"
            value={num(lesson.pageViews)}
            info="Views across all pages inside this lesson."
          />
          <KpiCard
            label="Teacher visits"
            value={num(lesson.teacherSessions)}
            info="Teacher sessions that reached this lesson."
          />
          <KpiCard
            label="Teacher vs anon views"
            value={
              lesson.teacherPageViews + lesson.anonymousPageViews > 0
                ? `${num(lesson.teacherPageViews)} / ${num(lesson.anonymousPageViews)}`
                : "–"
            }
            info="This lesson's page views split into teacher / anonymous. Newly tracked, so counts build from a recent start."
          />
          <KpiCard
            label="Interactions"
            value={num(lesson.interactions)}
            info="Accordion opens, reveals, tab switches, audio and video plays, and link/resource clicks — full breakdown below."
          />
          <KpiCard
            label="Inline quizzes"
            value={num(lesson.inlineQuizCompletes)}
            info="Knowledge-check quizzes completed inside this lesson's pages."
          />
          <KpiCard
            label="Quiz completions"
            value={num(lesson.quizCompletes)}
            info="End-of-lesson quiz completions (practice-until-correct, so completing always means 100%)."
          />
          <KpiCard
            label="Certificates"
            value={num(lesson.certificates)}
            info="Certificates generated after completing this lesson's quiz."
          />
          <KpiCard
            label="Lumen sessions"
            value={lesson.lumen ? num(lesson.lumen.sessions) : "—"}
            sub={
              lesson.lumen
                ? `${num(lesson.lumen.promptClicks)} clicks · ${num(lesson.lumen.responses)} responses`
                : "no Lumen activity embedded"
            }
            info="Sessions in the Lumen AI activities embedded in this lesson's pages."
          />
          <KpiCard
            label="Feedback"
            value={num(lesson.feedback)}
            info="Teacher feedback submissions on this lesson."
          />
        </div>

        {interactionRows.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Interaction breakdown</h3>
            <SimpleTable
              headers={["Interaction", "Count"]}
              rows={interactionRows.map(([event, count]) => [
                INTERACTION_LABELS[event] ?? event,
                num(count),
              ])}
            />
          </div>
        )}

        <h3 className="text-sm font-semibold text-gray-900 mb-2">Pages</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-2 w-1/2">{header("Page", "index", true)}</th>
                <th className="py-2 px-2">{header("Views", "views")}</th>
                <th className="py-2 px-2">{header("Interactions", "interactions")}</th>
                <th className="py-2 pl-2">{header("Lumen sessions", "lumen")}</th>
              </tr>
            </thead>
            <tbody>
              {visiblePages.map((p) => (
                <tr key={p.slug} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-2 text-gray-800">
                    <span className="text-gray-400 mr-1.5">{p.index}.</span>
                    {p.title}
                    {p.lumenFlows.length > 0 && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-violet-50 text-violet-700 rounded px-1.5 py-0.5">
                        Lumen
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">{num(p.views)}</td>
                  <td className="py-2 px-2 text-center">
                    {num(p.interactions)}
                  </td>
                  <td className="py-2 pl-2 text-center">
                    {p.lumen ? num(p.lumen.sessions) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pagePage} setPage={setPagePage} total={pages.length} perPage={15} />
        </div>
      </div>
    </div>
  );
}

// ── Lumen ────────────────────────────────────────────────────────────────────


type ColumnDef<T> = {
  label: string;
  left?: boolean;
  nowrap?: boolean;
  /** Value to sort by; omit to make the column unsortable. */
  sort?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
};

const TABLE_PAGE_SIZE = 15;

// Every numeric table on the page: sortable headings, capped at 15 rows with
// a pager so long lists never blow the layout out.
function DataTable<T>({
  cols,
  rows,
  rowKey,
  defaultSort,
  minWidth = 560,
}: {
  cols: ColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** [column index, direction] applied before any user click. */
  defaultSort?: [number, 1 | -1];
  minWidth?: number;
}) {
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(
    defaultSort ? { i: defaultSort[0], dir: defaultSort[1] } : null
  );
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = cols[sort.i];
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sort!(a);
      const bv = col.sort!(b);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return cmp * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const pageRows = sorted.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-gray-200">
              {cols.map((c, i) => (
                <th key={i} className={`py-2 ${i === 0 ? "pr-3" : "px-2"}`}>
                  {c.sort ? (
                    <button
                      onClick={() => {
                        setSort((cur) =>
                          cur?.i === i
                            ? { i, dir: (cur.dir * -1) as 1 | -1 }
                            : { i, dir: typeof c.sort!(rows[0] ?? ({} as T)) === "string" ? 1 : -1 }
                        );
                        setPage(0);
                      }}
                      className={`w-full uppercase tracking-wide text-xs font-semibold whitespace-nowrap ${
                        c.left ? "text-left" : "text-center"
                      } ${sort?.i === i ? "text-violet-700" : "text-gray-500 hover:text-gray-800"}`}
                    >
                      {c.label}
                      {sort?.i === i ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                    </button>
                  ) : (
                    <span
                      className={`block uppercase tracking-wide text-xs font-semibold text-gray-500 whitespace-nowrap ${
                        c.left ? "text-left" : "text-center"
                      }`}
                    >
                      {c.label}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-gray-100 last:border-0 align-top">
                {cols.map((c, i) => (
                  <td
                    key={i}
                    className={`py-2 ${i === 0 ? "pr-3" : "px-2"} text-gray-700 ${
                      c.left ? "text-left" : "text-center"
                    } ${c.nowrap ? "whitespace-nowrap" : ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} setPage={setPage} total={rows.length} perPage={TABLE_PAGE_SIZE} />
    </>
  );
}

type ScenarioSortKey = "sessions" | "promptClicks" | "responses" | null;

function Pager({
  page,
  setPage,
  total,
  perPage,
}: {
  page: number;
  setPage: (p: number) => void;
  total: number;
  perPage: number;
}) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
      <button
        onClick={() => setPage(Math.max(0, page - 1))}
        disabled={page === 0}
        className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
      >
        ← Prev
      </button>
      <span>
        {page * perPage + 1}–{Math.min((page + 1) * perPage, total)} of {total}
      </span>
      <button
        onClick={() => setPage(Math.min(pages - 1, page + 1))}
        disabled={page >= pages - 1}
        className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
      >
        Next →
      </button>
    </div>
  );
}

function LumenSection({
  data,
  rangeLabel,
  granularity,
}: {
  data: WebsiteReport;
  rangeLabel: string;
  granularity: Granularity;
}) {
  // Pies cover EVERYTHING (all scenarios / prompts, beyond-palette folded
  // into Other) regardless of the tables' pagination.
  const scenarioPie = toPie(
    data.lumen.byScenario.map((sc) => ({ name: sc.scenario, count: sc.sessions })),
    9
  );
  const promptPie = toPie(data.lumen.topPrompts, 9);

  const [scenarioSort, setScenarioSort] = useState<ScenarioSortKey>(null);
  const [scenarioPage, setScenarioPage] = useState(0);
  const [promptPage, setPromptPage] = useState(0);
  const SCENARIOS_PER_PAGE = 15;
  const PROMPTS_PER_PAGE = 15;

  const sortedScenarios = useMemo(() => {
    const rows = [...data.lumen.byScenario];
    if (scenarioSort) rows.sort((a, b) => b[scenarioSort] - a[scenarioSort]);
    else rows.sort((a, b) => a.scenario.localeCompare(b.scenario));
    return rows;
  }, [data.lumen.byScenario, scenarioSort]);
  const scenarioRows = sortedScenarios.slice(
    scenarioPage * SCENARIOS_PER_PAGE,
    (scenarioPage + 1) * SCENARIOS_PER_PAGE
  );
  const promptRows = data.lumen.topPrompts.slice(
    promptPage * PROMPTS_PER_PAGE,
    (promptPage + 1) * PROMPTS_PER_PAGE
  );

  const scenarioHeader = (label: string, key: Exclude<ScenarioSortKey, null>) => (
    <button
      onClick={() => {
        setScenarioSort((k) => (k === key ? null : key));
        setScenarioPage(0);
      }}
      className={`w-full uppercase tracking-wide text-xs font-semibold whitespace-nowrap text-center ${
        scenarioSort === key ? "text-violet-700" : "text-gray-500 hover:text-gray-800"
      }`}
    >
      {label}
      {scenarioSort === key ? " ↓" : ""}
    </button>
  );

  const sessionsTrend = useMemo(() => {
    const buckets = new Map<string, { label: string; Sessions: number }>();
    for (const d of data.lumen.sessionsDaily) {
      const { key, label } = bucketOf(d.date, granularity);
      const b = buckets.get(key) ?? { label, Sessions: 0 };
      b.Sessions += d.count;
      buckets.set(key, b);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [data.lumen.sessionsDaily, granularity]);
  const sessionsCumulative = useMemo(() => {
    const out: { label: string; Sessions: number }[] = [];
    for (const b of sessionsTrend) {
      out.push({ label: b.label, Sessions: (out[out.length - 1]?.Sessions ?? 0) + b.Sessions });
    }
    return out;
  }, [sessionsTrend]);

  return (
    <>
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Lumen (AI editor)</h2>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <KpiCard
          label="Sessions"
          value={num(data.lumen.sessions)}
          sub={rangeLabel}
          info="Times a Lumen AI activity was loaded."
        />
        <KpiCard
          label="Prompt clicks"
          value={num(data.lumen.promptClicks)}
          info="Clicks on the predefined prompts inside Lumen activities."
        />
        <KpiCard
          label="Responses"
          value={num(data.lumen.responses)}
          info="AI responses generated in Lumen activities."
        />
        <KpiCard
          label="Total tokens"
          value={num(data.lumen.totalTokens)}
          info="Combined AI usage across all responses — input tokens (what was sent to the model) plus output tokens (what it wrote back)."
        />
        <KpiCard
          label="Tokens / response"
          value={num(data.lumen.avgTokensPerResponse)}
          info="Average total tokens per AI response."
        />
        <KpiCard
          label="Avg response time"
          value={data.lumen.avgResponseMs ? `${(data.lumen.avgResponseMs / 1000).toFixed(1)}s` : "–"}
          info="Average time for the AI to return a response."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Scenarios"
          subtitle={rangeLabel}
          info="Share of Lumen sessions per scenario (the pie covers every scenario), with the lesson page each one is embedded on."
          exportData={sortedScenarios.map((sc) => ({
            scenario: sc.scenario,
            lessonPage: sc.location
              ? `L${sc.location.lessonNumber} · ${sc.location.pageTitle}`
              : "",
            sessions: sc.sessions,
            promptClicks: sc.promptClicks,
            responses: sc.responses,
          }))}
          exportName="website-lumen-scenarios"
        >
          <Donut data={scenarioPie} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 pr-3 text-left uppercase tracking-wide text-xs font-semibold text-gray-500 whitespace-nowrap">
                    Scenario
                  </th>
                  <th className="py-2 pr-3 text-left uppercase tracking-wide text-xs font-semibold text-gray-500 whitespace-nowrap">
                    Lesson Page
                  </th>
                  <th className="py-2 px-2">{scenarioHeader("Sessions", "sessions")}</th>
                  <th className="py-2 px-2">{scenarioHeader("Clicks", "promptClicks")}</th>
                  <th className="py-2 pl-2">{scenarioHeader("Responses", "responses")}</th>
                </tr>
              </thead>
              <tbody>
                {scenarioRows.map((sc) => (
                  <tr key={sc.scenario} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">
                      <Swatch color={rowColor(sc.scenario, scenarioPie)} />
                      {sc.scenario}
                    </td>
                    <td className="py-2 pr-3 text-gray-700">
                      {sc.location ? (
                        <span>
                          <span className="text-gray-400">L{sc.location.lessonNumber} ·</span>{" "}
                          {sc.location.pageTitle}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">{num(sc.sessions)}</td>
                    <td className="py-2 px-2 text-center">{num(sc.promptClicks)}</td>
                    <td className="py-2 pl-2 text-center">{num(sc.responses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={scenarioPage}
            setPage={setScenarioPage}
            total={sortedScenarios.length}
            perPage={SCENARIOS_PER_PAGE}
          />
        </Section>

        <Section
          title="Top prompts"
          subtitle={rangeLabel}
          info="Most-clicked predefined prompts across all Lumen scenarios (the pie covers every prompt)."
          exportData={data.lumen.topPrompts}
          exportName="website-lumen-prompts"
        >
          <Donut data={promptPie} />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-6 text-left uppercase tracking-wide text-xs font-semibold text-gray-500">
                  Prompt
                </th>
                <th className="py-2 text-center uppercase tracking-wide text-xs font-semibold text-gray-500">
                  Clicks
                </th>
              </tr>
            </thead>
            <tbody>
              {promptRows.map((pr) => (
                <tr key={pr.name} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-6 text-gray-700">
                    <Swatch color={rowColor(pr.name, promptPie)} />
                    {pr.name}
                  </td>
                  <td className="py-2 text-center">{num(pr.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={promptPage}
            setPage={setPromptPage}
            total={data.lumen.topPrompts.length}
            perPage={PROMPTS_PER_PAGE}
          />
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Lumen sessions over time"
          subtitle={rangeLabel}
          info="Lumen activity sessions started per period."
          exportData={sessionsTrend}
          exportName="website-lumen-sessions"
        >
          {sessionsTrend.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sessionsTrend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="Sessions" fill={PALETTE[2]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyHint>No sessions in this range.</EmptyHint>
          )}
        </Section>

        <Section
          title="Cumulative Lumen sessions"
          subtitle={rangeLabel}
          info="Running total of Lumen sessions across the filtered range."
          exportData={sessionsCumulative}
          exportName="website-lumen-sessions-cumulative"
        >
          {sessionsCumulative.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sessionsCumulative} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="Sessions"
                    stroke={PALETTE[2]}
                    fill={PALETTE[2]}
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyHint>No sessions in this range.</EmptyHint>
          )}
        </Section>
      </div>
    </>
  );
}

function TeachersSection({ data, rangeLabel }: { data: WebsiteReport; rangeLabel: string }) {
  const t = data.teachers;
  const pagesPerVisit =
    t.totalVisits > 0
      ? (t.rows.reduce((a, r) => a + r.views, 0) / t.totalVisits).toFixed(1)
      : "–";
  // Lesson slugs → "L3 · Trust and AI" style labels for the hover list.
  const lessonLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const course of data.courses) {
      for (const l of course.lessons) m.set(l.slug, `L${l.number} · ${l.title}`);
    }
    return m;
  }, [data.courses]);

  return (
    <>
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">
        Teachers &amp; schools
        <InfoTip
          text="Teachers are pseudonymous — random codes plus their school, never names. A small number of teacher sessions can't be matched to a code (the visit ended before the identity call landed)."
        />
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Unique teachers"
          value={num(t.identifiedTeachers)}
          sub={rangeLabel}
          info="Distinct teacher accounts seen in this range."
        />
        <KpiCard
          label="Total teacher visits"
          value={num(t.totalVisits)}
          info="Separate visits across all teachers — one teacher returning three times counts as three."
        />
        <KpiCard
          label="Pages per visit"
          value={pagesPerVisit}
          sub="teacher average"
          info="Average pages a teacher views in a single visit."
        />
      </div>

      {!t.schoolsJoined && (
        <Banner tone="warn">
          School names aren&apos;t joined yet — the dashboard needs the
          <code> FIREBASE_SERVICE_ACCOUNT</code> environment variable to look them up.
        </Banner>
      )}

      {t.schools.length > 0 && (
        <Section
          title="Schools"
          subtitle={rangeLabel}
          info="Teacher activity aggregated by the school recorded at signup."
          exportData={t.schools.map((sc) => ({ ...sc }))}
          exportName="website-schools"
        >
          <DataTable
            rows={t.schools}
            rowKey={(r) => r.school}
            defaultSort={[2, -1]}
            cols={[
              { label: "School", left: true, sort: (r) => r.school, render: (r) => r.school },
              { label: "Teachers", sort: (r) => r.teachers, render: (r) => num(r.teachers) },
              { label: "Visits", sort: (r) => r.visits, render: (r) => num(r.visits) },
              { label: "Views", sort: (r) => r.views, render: (r) => num(r.views) },
              {
                label: "Last seen",
                nowrap: true,
                sort: (r) => r.lastSeen,
                render: (r) => fmtDate(r.lastSeen),
              },
            ]}
          />
        </Section>
      )}

      <Section
        title="Teacher activity"
        subtitle={rangeLabel}
        info="One row per pseudonymous teacher: visits, page views, first/last seen, and the lessons they reached (hover the lesson count for the list)."
        exportData={t.rows.map((r) => ({ ...r, lessons: r.lessons.join(", ") }))}
        exportName="website-teachers"
      >
        {t.rows.length > 0 ? (
          <DataTable
            rows={t.rows}
            rowKey={(r) => r.code}
            defaultSort={[5, -1]}
            minWidth={720}
            cols={[
              {
                label: "Teacher",
                left: true,
                render: (r) => (
                  <code className="text-xs bg-gray-100 rounded px-1.5 py-0.5">{r.code}</code>
                ),
              },
              {
                label: "School",
                left: true,
                sort: (r) => r.school ?? "~", // unknowns sort last
                render: (r) => r.school ?? "—",
              },
              { label: "Visits", sort: (r) => r.visits, render: (r) => num(r.visits) },
              { label: "Views", sort: (r) => r.views, render: (r) => num(r.views) },
              {
                label: "First seen",
                nowrap: true,
                sort: (r) => r.firstSeen,
                render: (r) => fmtDate(r.firstSeen),
              },
              {
                label: "Last seen",
                nowrap: true,
                sort: (r) => r.lastSeen,
                render: (r) => fmtDate(r.lastSeen),
              },
              {
                label: "Lessons visited",
                sort: (r) => r.lessons.length,
                render: (r) =>
                  r.lessons.length === 0 ? (
                    "—"
                  ) : (
                    <span className="relative inline-flex group cursor-help underline decoration-dotted decoration-gray-300 whitespace-nowrap">
                      {r.lessons.length} lesson{r.lessons.length === 1 ? "" : "s"}
                      <span className="pointer-events-none absolute right-0 top-6 z-30 hidden group-hover:block w-72 bg-gray-900 text-white text-xs rounded-lg p-3 leading-relaxed shadow-lg text-left normal-case">
                        {r.lessons.map((slug) => (
                          <span key={slug} className="block">
                            {lessonLabels.get(slug) ?? slug}
                          </span>
                        ))}
                      </span>
                    </span>
                  ),
              },
            ]}
          />
        ) : (
          <EmptyHint>No identified teacher sessions in this range.</EmptyHint>
        )}
      </Section>
    </>
  );
}
