"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
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
  Legend,
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
  DeviceMonth,
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

const fmtMonth = (yyyymm: string) =>
  new Date(`${yyyymm}-01`).toLocaleDateString("en-AU", { month: "short", year: "2-digit" });

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
  maxRows = 10,
  pieMax = 6,
}: {
  rows: NameCount[]; // sorted desc; `name` labels slice, tooltip, and row alike
  height?: number;
  maxRows?: number;
  /** Colored slices before folding into "Other" — e.g. 9 for the states
   * column so every Australian state keeps its own color. */
  pieMax?: number;
}) {
  const pie = toPie(rows, pieMax);
  return (
    <>
      <Donut data={pie} height={height} />
      {rows.length > 0 && (
        <table className="w-full text-sm mt-3">
          <tbody>
            {rows.slice(0, maxRows).map((r) => (
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
      <table className="w-full text-sm min-w-[560px]">
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
  const [deviceAudience, setDeviceAudience] = useState<Audience>("anonymous");
  const [deviceView, setDeviceView] = useState<"share" | "monthly">("share");

  const trend = useMemo(
    () => aggregateTrend(data.audience.daily, granularity),
    [data.audience.daily, granularity]
  );

  const { total, teacher } = data.audience;
  const anonymousVisitors = Math.max(0, total.visitors - teacher.visitors);
  const anonTime = Math.max(0, total.totaltime - teacher.totaltime);
  const anonVisits = Math.max(0, total.visits - teacher.visits);
  const cumulative = useMemo(() => cumulativeTrend(trend), [trend]);
  const geo = data.geography[geoAudience];
  const devices = data.geography[deviceAudience].devices;

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Traffic over time"
          subtitle={rangeLabel}
          info="Pageviews per period, split into anonymous visitors and teacher-tagged visitors (teacher tagging exists from 21 Aug 2026 — earlier traffic all reads as anonymous)."
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
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Anonymous" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Teachers" fill={PALETTE[1]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyHint>No traffic in this range.</EmptyHint>
          )}
        </Section>

        <Section
          title="Cumulative traffic"
          subtitle={rangeLabel}
          info="Running pageview total across the filtered range — starts at zero and climbs to the period's total, for each audience."
          exportData={cumulative}
          exportName="website-trend-cumulative"
        >
          {cumulative.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulative} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="Anonymous"
                    stroke={PALETTE[0]}
                    fill={PALETTE[0]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="Teachers"
                    stroke={PALETTE[1]}
                    fill={PALETTE[1]}
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyHint>No traffic in this range.</EmptyHint>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Audience mix"
          subtitle={rangeLabel}
          info="Share of lesson activity by user type, counted from lesson page-view events — covers the full history (unlike pageview tagging, which starts 21 Aug 2026)."
          exportData={data.audience.eventUserTypes}
          exportName="website-user-types"
        >
          <DonutWithTable
            rows={data.audience.eventUserTypes.map((r) => ({
              name: r.name.charAt(0).toUpperCase() + r.name.slice(1),
              count: r.count,
            }))}
          />
        </Section>

        <Section
          title="Devices"
          subtitle={rangeLabel}
          info="Visitor device mix. Toggle between anonymous visitors and teachers, or switch to the over-time view to watch the mix shift."
          exportData={devices}
          exportName={`website-devices-${deviceAudience}`}
        >
          <div className="flex flex-wrap gap-3 mb-4">
            {audienceToggle(deviceAudience, setDeviceAudience)}
            <SegmentedControl
              value={deviceView}
              onChange={setDeviceView}
              options={[
                { value: "share", label: "Share" },
                { value: "monthly", label: "Over time" },
              ]}
            />
          </div>
          {deviceView === "share" ? (
            <DonutWithTable rows={devices} />
          ) : (
            <DeviceMonthly
              months={data.deviceMonthly}
              audience={deviceAudience}
              granularity={granularity}
            />
          )}
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

// ── devices over time ────────────────────────────────────────────────────────

function DeviceMonthly({
  months: monthsRaw,
  audience,
  granularity,
}: {
  months: DeviceMonth[];
  audience: Audience;
  granularity: Granularity;
}) {
  // Device data arrives in monthly buckets — group them up to the global
  // time scale where that's coarser (quarter/year); day/week show monthly.
  const months = useMemo(() => {
    if (granularity !== "quarter" && granularity !== "year") return monthsRaw;
    const grouped = new Map<string, DeviceMonth>();
    const merge = (into: NameCount[], from: NameCount[]) => {
      for (const r of from) {
        const hit = into.find((x) => x.name === r.name);
        if (hit) hit.count += r.count;
        else into.push({ ...r });
      }
    };
    for (const m of monthsRaw) {
      const [y, mm] = m.month.split("-");
      const key =
        granularity === "year" ? y : `${y}-Q${Math.ceil(Number(mm) / 3)}`;
      const g = grouped.get(key) ?? { month: key, all: [], teacher: [] };
      merge(g.all, m.all);
      merge(g.teacher, m.teacher);
      grouped.set(key, g);
    }
    return [...grouped.values()];
  }, [monthsRaw, granularity]);

  const deviceTypes = useMemo(() => {
    const totals = new Map<string, number>();
    for (const m of months) {
      const rows =
        audience === "teacher"
          ? m.teacher
          : m.all.map((r) => ({
              name: r.name,
              count: Math.max(0, r.count - (m.teacher.find((t) => t.name === r.name)?.count ?? 0)),
            }));
      for (const r of rows) totals.set(r.name, (totals.get(r.name) ?? 0) + r.count);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 6);
  }, [months, audience]);

  const rows = months.map((m) => {
    const source =
      audience === "teacher"
        ? m.teacher
        : m.all.map((r) => ({
            name: r.name,
            count: Math.max(0, r.count - (m.teacher.find((t) => t.name === r.name)?.count ?? 0)),
          }));
    const row: Record<string, string | number> = {
      // Keys are "YYYY-MM", "YYYY-Qn", or "YYYY" depending on the time scale.
      label: /^\d{4}-\d{2}$/.test(m.month) ? fmtMonth(m.month) : m.month,
    };
    for (const t of deviceTypes) row[t] = source.find((r) => r.name === t)?.count ?? 0;
    return row;
  });

  if (deviceTypes.length === 0) return <EmptyHint>No device data yet.</EmptyHint>;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {deviceTypes.map((t, i) => (
            <Bar
              key={t}
              dataKey={t}
              stackId="devices"
              fill={sliceColor(i)}
              stroke="#ffffff"
              strokeWidth={1}
              radius={i === deviceTypes.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
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
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="course-select" className="text-sm text-gray-600">
          Course:
        </label>
        <select
          id="course-select"
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
          <KpiCard label="Course views" value={num(course.courseViews)} />
          <KpiCard label="Lesson page views" value={num(course.lessonPageViews)} />
          <KpiCard
            label="Teacher visits"
            value={num(course.teacherSessions)}
            sub="teacher sessions reaching a lesson"
          />
          <KpiCard label="Interactions" value={num(course.interactions)} sub="accordions, reveals, links, media" />
          <KpiCard label="Lumen sessions" value={num(course.lumen.sessions)} sub="in this course's activities" />
          <KpiCard label="Inline quizzes" value={num(course.inlineQuizCompletes)} sub="knowledge checks completed" />
          <KpiCard label="Quiz completions" value={num(course.quizCompletes)} sub="end-of-lesson" />
          <KpiCard label="Certificates generated" value={num(course.certificates)} />
          <KpiCard label="Teacher feedback" value={num(course.feedback)} />
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
          <KpiCard label="Lesson views" value={num(lesson.lessonViews)} />
          <KpiCard label="Page views" value={num(lesson.pageViews)} />
          <KpiCard
            label="Teacher visits"
            value={num(lesson.teacherSessions)}
            sub="teacher sessions reaching this lesson"
          />
          <KpiCard
            label="Teacher vs anon views"
            value={
              lesson.teacherPageViews + lesson.anonymousPageViews > 0
                ? `${num(lesson.teacherPageViews)} / ${num(lesson.anonymousPageViews)}`
                : "–"
            }
            sub="page views · tracked since 27 Aug"
          />
          <KpiCard label="Interactions" value={num(lesson.interactions)} />
          <KpiCard label="Inline quizzes" value={num(lesson.inlineQuizCompletes)} />
          <KpiCard label="Quiz completions" value={num(lesson.quizCompletes)} />
          <KpiCard label="Certificates" value={num(lesson.certificates)} />
          <KpiCard
            label="Lumen sessions"
            value={lesson.lumen ? num(lesson.lumen.sessions) : "—"}
            sub={
              lesson.lumen
                ? `${num(lesson.lumen.promptClicks)} clicks · ${num(lesson.lumen.responses)} responses`
                : "no Lumen activity embedded"
            }
          />
          <KpiCard label="Feedback" value={num(lesson.feedback)} />
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
              {pages.map((p) => (
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
                    {p.interactionsSince && <span className="text-gray-400">*</span>}
                  </td>
                  <td className="py-2 pl-2 text-center">
                    {p.lumen ? num(p.lumen.sessions) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages.some((p) => p.interactionsSince) && (
            <p className="text-xs text-gray-400 mt-2">
              * this page name is shared across lessons, so its interactions are counted
              from 26 Aug 2026 (when per-lesson page tracking was added). Lesson totals
              above are always exact.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lumen ────────────────────────────────────────────────────────────────────

function LumenSection({
  data,
  rangeLabel,
  granularity,
}: {
  data: WebsiteReport;
  rangeLabel: string;
  granularity: Granularity;
}) {
  const scenarioPie = toPie(
    data.lumen.byScenario.map((s) => ({ name: s.scenario, count: s.sessions }))
  );
  const promptPie = toPie(data.lumen.topPrompts, 6);
  const responsesTrend = useMemo(() => {
    const buckets = new Map<string, { label: string; Responses: number }>();
    for (const d of data.lumen.responsesDaily) {
      const { key, label } = bucketOf(d.date, granularity);
      const b = buckets.get(key) ?? { label, Responses: 0 };
      b.Responses += d.count;
      buckets.set(key, b);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [data.lumen.responsesDaily, granularity]);

  return (
    <>
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Lumen (AI editor)</h2>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <KpiCard label="Sessions" value={num(data.lumen.sessions)} sub={rangeLabel} />
        <KpiCard label="Prompt clicks" value={num(data.lumen.promptClicks)} />
        <KpiCard label="Responses" value={num(data.lumen.responses)} />
        <KpiCard label="Total tokens" value={`≈${num(data.lumen.totalTokens)}`} sub="input + output" />
        <KpiCard label="Tokens / response" value={`≈${num(data.lumen.avgTokensPerResponse)}`} />
        <KpiCard
          label="Avg response time"
          value={data.lumen.avgResponseMs ? `${(data.lumen.avgResponseMs / 1000).toFixed(1)}s` : "–"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Scenarios"
          subtitle={rangeLabel}
          info="Share of Lumen sessions per scenario, with where each scenario is embedded in course content."
          exportData={data.lumen.byScenario.map((s) => ({
            scenario: s.scenario,
            location: s.location
              ? `L${s.location.lessonNumber} · ${s.location.pageTitle}`
              : "",
            sessions: s.sessions,
            promptClicks: s.promptClicks,
            responses: s.responses,
          }))}
          exportName="website-lumen-scenarios"
        >
          <Donut data={scenarioPie} />
          <SimpleTable
            headers={["Scenario", "Where it lives", "Sessions", "Clicks", "Responses"]}
            rows={data.lumen.byScenario.map((s) => [
              <span key="n">
                <Swatch color={rowColor(s.scenario, scenarioPie)} />
                {s.scenario}
              </span>,
              s.location ? (
                <span key="loc">
                  <span className="text-gray-400">L{s.location.lessonNumber} ·</span>{" "}
                  {s.location.pageTitle}
                </span>
              ) : (
                "—"
              ),
              num(s.sessions),
              num(s.promptClicks),
              num(s.responses),
            ])}
          />
        </Section>

        <Section
          title="Top prompts"
          subtitle={rangeLabel}
          info="Most-clicked predefined prompts across all Lumen scenarios."
          exportData={data.lumen.topPrompts}
          exportName="website-lumen-prompts"
        >
          <Donut data={promptPie} />
          <SimpleTable
            headers={["Prompt", "Clicks"]}
            rows={data.lumen.topPrompts.slice(0, 15).map((p) => [
              <span key="n">
                <Swatch color={rowColor(p.name, promptPie)} />
                {p.name}
              </span>,
              num(p.count),
            ])}
          />
        </Section>
      </div>

      <Section
        title="Lumen responses over time"
        subtitle={rangeLabel}
        info="AI responses generated in Lumen activities per period."
        exportData={responsesTrend}
        exportName="website-lumen-daily"
      >
        {responsesTrend.length > 0 ? (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={responsesTrend}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="Responses" stroke={PALETTE[2]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No responses in this range.</EmptyHint>
        )}
      </Section>
    </>
  );
}

// ── Teachers ─────────────────────────────────────────────────────────────────

function TeachersSection({ data, rangeLabel }: { data: WebsiteReport; rangeLabel: string }) {
  const t = data.teachers;
  const pagesPerVisit =
    t.totalVisits > 0
      ? (t.rows.reduce((a, r) => a + r.views, 0) / t.totalVisits).toFixed(1)
      : "–";

  return (
    <>
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">
        Teachers &amp; schools
        <InfoTip
          text={`Teachers are pseudonymous — random codes plus their school, never names. Role tagging began ${fmtDate(data.tagSince)}, so earlier teacher visits aren't in this section. A small number of teacher sessions (${num(t.unidentifiedSessions)} in this range) closed before the identity call landed and can't be matched to a code.`}
        />
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Active teachers" value={num(t.identifiedTeachers)} sub={rangeLabel} />
        <KpiCard
          label="Returning teachers"
          value={num(t.returningTeachers)}
          sub="came back more than once"
          tone="positive"
        />
        <KpiCard label="Total teacher visits" value={num(t.totalVisits)} />
        <KpiCard label="Pages per visit" value={pagesPerVisit} sub="teacher average" />
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
          exportData={t.schools.map((s) => ({ ...s }))}
          exportName="website-schools"
        >
          <SimpleTable
            headers={["School", "Teachers", "Visits", "Views", "Last seen"]}
            rows={t.schools.map((s) => [
              s.school,
              num(s.teachers),
              num(s.visits),
              num(s.views),
              fmtDate(s.lastSeen),
            ])}
          />
        </Section>
      )}

      <Section
        title="Teacher activity"
        subtitle={rangeLabel}
        info="One row per pseudonymous teacher: visits, page views, first/last seen, and the lessons they reached."
        exportData={t.rows.map((r) => ({ ...r, lessons: r.lessons.join(", ") }))}
        exportName="website-teachers"
      >
        {t.rows.length > 0 ? (
          <SimpleTable
            headers={["Teacher", "School", "Visits", "Views", "First seen", "Last seen", "Lessons visited"]}
            rows={t.rows.map((r) => [
              <code key="c" className="text-xs bg-gray-100 rounded px-1.5 py-0.5">{r.code}</code>,
              r.school ?? "—",
              num(r.visits),
              num(r.views),
              fmtDate(r.firstSeen),
              fmtDate(r.lastSeen),
              r.lessons.length > 0 ? r.lessons.join(", ") : "—",
            ])}
          />
        ) : (
          <EmptyHint>
            No identified teacher sessions in this range (tagging began {fmtDate(data.tagSince)}).
          </EmptyHint>
        )}
      </Section>
    </>
  );
}
