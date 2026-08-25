"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
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
  HBarChart,
  EmptyHint,
  Banner,
  SegmentedControl,
} from "@/components/dashboard-bits";
import type { WebsiteReport, DailyPoint, CourseReport } from "@/lib/website";

export default function WebsitePage() {
  return (
    <UmamiReportPage
      title="TechFutures Website"
      subtitleFallback="Audience, courses, Lumen, and teacher engagement."
      useData={useUmamiWebsite}
    >
      {(data, rangeLabel) => <WebsiteBody data={data} rangeLabel={rangeLabel} />}
    </UmamiReportPage>
  );
}

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

// ── trend granularity ────────────────────────────────────────────────────────

type Granularity = "day" | "week" | "month" | "quarter" | "year";

// Bucket a YYYYMMDD day into the selected granularity, with a display label.
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
  // week: bucket by the Monday of that week.
  const d = new Date(`${y}-${date.slice(4, 6)}-${date.slice(6, 8)}`);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const key = monday.toISOString().slice(0, 10);
  return {
    key,
    label: `wk ${monday.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`,
  };
}

function aggregateTrend(daily: DailyPoint[], g: Granularity) {
  const buckets = new Map<
    string,
    { label: string; Pageviews: number; "Teacher pageviews": number; Sessions: number }
  >();
  for (const d of daily) {
    const { key, label } = bucketOf(d.date, g);
    const b =
      buckets.get(key) ?? { label, Pageviews: 0, "Teacher pageviews": 0, Sessions: 0 };
    b.Pageviews += d.pageviews;
    b["Teacher pageviews"] += d.teacherPageviews;
    b.Sessions += d.sessions;
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

// ── page body ────────────────────────────────────────────────────────────────

function WebsiteBody({ data, rangeLabel }: { data: WebsiteReport; rangeLabel: string }) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [geoView, setGeoView] = useState<"all" | "teacher">("all");

  const trend = useMemo(
    () => aggregateTrend(data.audience.daily, granularity),
    [data.audience.daily, granularity]
  );

  const { total, teacher } = data.audience;
  const anonymousVisitors = Math.max(0, total.visitors - teacher.visitors);
  const geo = geoView === "all" ? data.geography.all : data.geography.teacher;
  const tagNote = `Teacher split available from ${fmtDate(data.tagSince)} (when role tagging shipped)`;

  return (
    <>
      {/* ── Audience ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <KpiCard label="Visitors" value={num(total.visitors)} sub={rangeLabel} />
        <KpiCard label="Teachers" value={num(teacher.visitors)} sub="tagged visitors" tone="positive" />
        <KpiCard label="Anonymous" value={num(anonymousVisitors)} sub="mostly students" />
        <KpiCard label="Pageviews" value={num(total.pageviews)} sub={`${num(total.visits)} visits`} />
        <KpiCard label="Avg time on site" value={fmtDuration(total.totaltime, total.visits)} sub="per visit" />
      </div>

      <Section
        title="Traffic over time"
        subtitle={`${tagNote} · ${rangeLabel}`}
        exportData={trend}
        exportName="website-trend"
      >
        <div className="mb-3">
          <SegmentedControl
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
          />
        </div>
        {trend.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Pageviews" stroke="#3b82f6" dot={false} />
                <Line type="monotone" dataKey="Teacher pageviews" stroke="#22c55e" dot={false} />
                <Line type="monotone" dataKey="Sessions" stroke="#a855f7" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No traffic in this range.</EmptyHint>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Teachers vs anonymous (full history)"
          subtitle="lesson_page_view events by user_type — covers the whole range"
          exportData={data.audience.eventUserTypes}
          exportName="website-user-types"
        >
          {data.audience.eventUserTypes.length > 0 ? (
            <HBarChart data={data.audience.eventUserTypes} color="#f59e0b" nameWidth={140} />
          ) : (
            <EmptyHint>No user-type data in this range.</EmptyHint>
          )}
        </Section>

        <Section
          title="Devices"
          subtitle={geoView === "teacher" ? `Teachers only · ${tagNote}` : "All visitors"}
          exportData={geo.devices}
          exportName={`website-devices-${geoView}`}
        >
          {geo.devices.length > 0 ? (
            <HBarChart data={geo.devices} color="#06b6d4" nameWidth={120} />
          ) : (
            <EmptyHint>No device data in this range.</EmptyHint>
          )}
        </Section>
      </div>

      {/* ── Geography ──────────────────────────────────────────────────── */}
      <Section
        title="Geography"
        subtitle={geoView === "teacher" ? `Teachers only · ${tagNote}` : "All visitors"}
      >
        <div className="mb-4">
          <SegmentedControl
            value={geoView}
            onChange={setGeoView}
            options={[
              { value: "all", label: "All visitors" },
              { value: "teacher", label: "Teachers" },
            ]}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <GeoTable title="Countries" rows={geo.countries.map((r) => ({ name: countryName(r.name), count: r.count }))} />
          <GeoTable title="States / regions" rows={geo.regions.map((r) => ({ name: regionName(r.name), count: r.count }))} />
          <GeoTable title="Cities" rows={geo.cities} />
        </div>
      </Section>

      {/* ── Courses ────────────────────────────────────────────────────── */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-1">Courses</h2>
      <p className="text-sm text-gray-500 mb-4">
        Structure comes from the CMS — new courses and lessons appear here automatically.
      </p>
      {data.courses.map((course) => (
        <CourseSection key={course.slug} course={course} />
      ))}

      {/* ── Lumen ──────────────────────────────────────────────────────── */}
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
          subtitle="Sessions per Lumen scenario"
          exportData={data.lumen.byScenario}
          exportName="website-lumen-scenarios"
        >
          {data.lumen.byScenario.length > 0 ? (
            <HBarChart
              data={data.lumen.byScenario.map((s) => ({ name: s.scenario, count: s.sessions }))}
              color="#8b5cf6"
              nameWidth={200}
            />
          ) : (
            <EmptyHint>No Lumen sessions in this range.</EmptyHint>
          )}
        </Section>
        <Section
          title="Top prompts"
          subtitle="Most-clicked predefined prompts"
          exportData={data.lumen.topPrompts}
          exportName="website-lumen-prompts"
        >
          {data.lumen.topPrompts.length > 0 ? (
            <HBarChart data={data.lumen.topPrompts.slice(0, 12)} color="#ec4899" nameWidth={240} />
          ) : (
            <EmptyHint>No prompt clicks in this range.</EmptyHint>
          )}
        </Section>
      </div>
      <Section
        title="Lumen responses over time"
        subtitle={`Daily AI responses · ${rangeLabel}`}
        exportData={data.lumen.responsesDaily}
        exportName="website-lumen-daily"
      >
        {data.lumen.responsesDaily.length > 0 ? (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.lumen.responsesDaily.map((d) => ({ label: fmtDay(d.date), Responses: d.count }))}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="Responses" stroke="#8b5cf6" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No responses in this range.</EmptyHint>
        )}
      </Section>

      {/* ── Teachers & schools ─────────────────────────────────────────── */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-1">Teachers &amp; schools</h2>
      <p className="text-sm text-gray-500 mb-4">
        Pseudonymous — teachers appear as random codes with their school (never names). {tagNote}.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Identified teachers" value={num(data.teachers.identifiedTeachers)} sub={rangeLabel} />
        <KpiCard
          label="Returning teachers"
          value={num(data.teachers.returningTeachers)}
          sub="more than one visit"
          tone="positive"
        />
        <KpiCard label="Teacher visits" value={num(data.teachers.totalVisits)} />
        <KpiCard
          label="Unidentified sessions"
          value={num(data.teachers.unidentifiedSessions)}
          sub="teacher-tagged, no ID"
        />
      </div>

      {!data.teachers.schoolsJoined && (
        <Banner tone="warn">
          School names aren&apos;t joined yet — add a <code>FIREBASE_SERVICE_ACCOUNT</code> key to the
          dashboard&apos;s environment (Firebase console → Project settings → Service accounts →
          Generate new private key, paste the JSON as one line) and refresh. Teacher activity below
          still works without it.
        </Banner>
      )}

      {data.teachers.schools.length > 0 && (
        <Section
          title="Schools"
          subtitle="Teacher activity aggregated by school"
          exportData={data.teachers.schools.map((s) => ({ ...s }))}
          exportName="website-schools"
        >
          <SimpleTable
            headers={["School", "Teachers", "Visits", "Views", "Last seen"]}
            rows={data.teachers.schools.map((s) => [
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
        subtitle="Per pseudonymous teacher — visits, lessons reached, first/last seen"
        exportData={data.teachers.rows.map((r) => ({ ...r, lessons: r.lessons.join(", ") }))}
        exportName="website-teachers"
      >
        {data.teachers.rows.length > 0 ? (
          <SimpleTable
            headers={["Teacher", "School", "Visits", "Views", "First seen", "Last seen", "Lessons visited"]}
            rows={data.teachers.rows.map((r) => [
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
          <EmptyHint>No identified teacher sessions in this range (tagging began {fmtDate(data.tagSince)}).</EmptyHint>
        )}
      </Section>
    </>
  );
}

// ── section components ───────────────────────────────────────────────────────

function GeoTable({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">{title}</h3>
      {rows.length > 0 ? (
        <table className="w-full text-sm">
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.name} className="border-b border-gray-100 last:border-0">
                <td className="py-1.5 text-gray-700">{r.name}</td>
                <td className="py-1.5 text-right text-gray-900 font-medium">{num(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyHint>No data.</EmptyHint>
      )}
    </div>
  );
}

function CourseSection({ course }: { course: CourseReport }) {
  return (
    <Section
      title={course.title}
      subtitle={`/courses/${course.slug}`}
      exportData={course.lessons.map((l) => ({
        lesson: l.title,
        pageViews: l.pageViews,
        interactions: l.interactions,
        inlineQuizCompletes: l.inlineQuizCompletes,
        quizCompletes: l.quizCompletes,
        certificates: l.certificates,
        feedback: l.feedback,
      }))}
      exportName={`website-course-${course.slug}`}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Course views" value={num(course.courseViews)} />
        <KpiCard label="Lesson page views" value={num(course.lessonPageViews)} />
        <KpiCard label="Quiz completions" value={num(course.quizCompletes)} />
        <KpiCard label="Certificates" value={num(course.certificates)} />
      </div>
      {course.lessons.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
              <th className="py-2 pr-2">Lesson</th>
              <th className="py-2 px-2 text-right">Page views</th>
              <th className="py-2 px-2 text-right">Interactions</th>
              <th className="py-2 px-2 text-right">Inline quizzes</th>
              <th className="py-2 px-2 text-right">Quiz done</th>
              <th className="py-2 px-2 text-right">Certificates</th>
              <th className="py-2 pl-2 text-right">Feedback</th>
            </tr>
          </thead>
          <tbody>
            {course.lessons.map((lesson) => (
              <LessonRows key={lesson.slug} lesson={lesson} />
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyHint>No lessons published yet.</EmptyHint>
      )}
    </Section>
  );
}

function LessonRows({ lesson }: { lesson: CourseReport["lessons"][number] }) {
  const [open, setOpen] = useState(false);
  const hasPages = lesson.pages.length > 0;
  return (
    <>
      <tr className="border-b border-gray-100 last:border-0">
        <td className="py-2 pr-2">
          <button
            onClick={() => hasPages && setOpen((o) => !o)}
            className={`text-left font-medium text-gray-800 ${hasPages ? "hover:text-violet-700" : "cursor-default"}`}
          >
            {hasPages && <span className="inline-block w-4 text-gray-400">{open ? "▾" : "▸"}</span>}
            {lesson.title}
          </button>
        </td>
        <td className="py-2 px-2 text-right">{num(lesson.pageViews)}</td>
        <td className="py-2 px-2 text-right">{num(lesson.interactions)}</td>
        <td className="py-2 px-2 text-right">{num(lesson.inlineQuizCompletes)}</td>
        <td className="py-2 px-2 text-right">{num(lesson.quizCompletes)}</td>
        <td className="py-2 px-2 text-right">{num(lesson.certificates)}</td>
        <td className="py-2 pl-2 text-right">{num(lesson.feedback)}</td>
      </tr>
      {open &&
        lesson.pages.map((p) => (
          <tr key={p.slug} className="border-b border-gray-50 bg-gray-50/50 text-xs">
            <td className="py-1.5 pr-2 pl-6 text-gray-600">{p.title}</td>
            <td className="py-1.5 px-2 text-right text-gray-600">{num(p.views)}</td>
            <td colSpan={5} />
          </tr>
        ))}
    </>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            {headers.map((h) => (
              <th key={h} className="py-2 pr-3">{h}</th>
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
