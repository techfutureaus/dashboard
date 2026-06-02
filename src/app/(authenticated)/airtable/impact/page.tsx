"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useImpactAgg } from "@/hooks/useAirtableData";
import { Section, KpiCard, EmptyHint, Banner } from "@/components/dashboard-bits";
import { LastRefreshedBadge } from "@/components/LastRefreshedBadge";

export default function ImpactPage() {
  const { data, loading, error, fetchedAt, refreshing, refresh } = useImpactAgg();

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <div className="text-gray-500">No data.</div>;

  const totalStudentsCompleting = data.completingSeries.reduce((s, r) => s + r.students, 0);
  const latestCoding = data.csisSeries[data.csisSeries.length - 1];

  return (
    <>
      <div className="mb-3">
        <LastRefreshedBadge fetchedAt={fetchedAt} refreshing={refreshing} onRefresh={refresh} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Students completing (total)"
          value={totalStudentsCompleting.toLocaleString()}
          sub="all years"
        />
        <KpiCard
          label="Students coding (latest)"
          value={latestCoding ? latestCoding.studentsCoding.toLocaleString() : "—"}
          sub={latestCoding?.term ?? ""}
        />
        <KpiCard
          label="Avg time coding (latest)"
          value={latestCoding ? `${latestCoding.avgTimeCoding}` : "—"}
          sub={latestCoding?.term ?? ""}
        />
        <KpiCard
          label="Industry partners"
          value={data.industryPartnersTotal.toLocaleString()}
          sub="total records"
        />
      </div>

      <Section
        title="Students coding per term"
        subtitle="From csinschools.io table (Include in dashboard rows only)"
        exportData={data.csisSeries}
        exportName="students-coding-per-term"
      >
        {data.csisSeries.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.csisSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="term" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="studentsCoding" name="Students coding" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="avgTimeCoding" name="Avg time coding" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No csinschools.io rows flagged for dashboard.</EmptyHint>
        )}
      </Section>

      <Section
        title="Students completing a course"
        subtitle="Annual completions by year"
        exportData={data.completingSeries}
        exportName="students-completing-per-year"
      >
        {data.completingSeries.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.completingSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="students" fill="#22c55e" name="Students" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No completion data.</EmptyHint>
        )}
      </Section>
    </>
  );
}
