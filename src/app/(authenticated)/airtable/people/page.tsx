"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { usePeopleRecords } from "@/hooks/useAirtableData";
import { Section, KpiCard, HBarChart, EmptyHint, Banner, Select, Toolbar } from "@/components/dashboard-bits";
import {
  countBy,
  countByMulti,
  distinctValues,
  sortChronological,
  type Row,
} from "@/lib/aggregation";

export default function PeoplePage() {
  const { data, loading, error } = usePeopleRecords();
  const [state, setState] = useState("");

  const volunteers = data?.volunteers ?? [];
  const teachers = data?.teachers ?? [];
  const cadetship = data?.cadetship ?? [];

  // Union of states across both Volunteers + Teachers.
  const stateOptions = useMemo(() => {
    const a = distinctValues(volunteers, "State");
    const b = distinctValues(teachers, "State");
    return Array.from(new Set([...a, ...b])).sort();
  }, [volunteers, teachers]);

  const fVolunteers = useMemo<Row[]>(
    () => (state ? volunteers.filter((v) => v["State"] === state) : volunteers),
    [volunteers, state]
  );
  const fTeachers = useMemo<Row[]>(
    () => (state ? teachers.filter((t) => t["State"] === state) : teachers),
    [teachers, state]
  );

  const byStatus = useMemo(() => countByMulti(fVolunteers, "Application Status"), [fVolunteers]);
  const byActivation = useMemo(() => countBy(fVolunteers, "Volunteer activation"), [fVolunteers]);
  const byLocation = useMemo(() => countBy(fVolunteers, "Location"), [fVolunteers]);
  const teachersByState = useMemo(() => countBy(fTeachers, "State"), [fTeachers]);
  const teachersYears = useMemo(
    () => sortChronological(countByMulti(fTeachers, "Years Participated")),
    [fTeachers]
  );

  // Cadetship: parse year out of "2024 application" / "2024 cadet" / "2025 EOI"
  const cadetshipSeries = useMemo(() => {
    const byYear = new Map<string, { year: string; applications: number; cadets: number; eoi: number }>();
    for (const r of cadetship) {
      const tags = r["tag"];
      if (!Array.isArray(tags)) continue;
      for (const t of tags) {
        const m = String(t).match(/^(\d{4})\s*(.*)$/);
        if (!m) continue;
        const year = m[1];
        const label = m[2].toLowerCase();
        const entry = byYear.get(year) ?? { year, applications: 0, cadets: 0, eoi: 0 };
        if (label.includes("application")) entry.applications++;
        else if (label.includes("cadet")) entry.cadets++;
        else if (label.includes("eoi")) entry.eoi++;
        byYear.set(year, entry);
      }
    }
    return Array.from(byYear.values()).sort((a, b) => a.year.localeCompare(b.year));
  }, [cadetship]);

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (error) return <Banner tone="error">{error}</Banner>;

  return (
    <>
      <Toolbar>
        <Select label="State" value={state} onChange={setState} options={stateOptions} />
        <span className="ml-auto text-xs text-gray-500">
          {fVolunteers.length} volunteers · {fTeachers.length} teachers
          {state && ` (filtered to ${state})`}
        </span>
      </Toolbar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Volunteers" value={fVolunteers.length.toLocaleString()} />
        <KpiCard label="Teachers" value={fTeachers.length.toLocaleString()} />
        <KpiCard
          label="Cadetship records"
          value={cadetship.length.toLocaleString()}
          sub="not state-filtered"
        />
        <KpiCard
          label="Volunteer cities"
          value={String(byLocation.length)}
          sub="distinct locations"
        />
      </div>

      <Section
        title="Volunteer application status"
        subtitle="Where volunteers are in the pipeline (multi-select)"
        exportData={byStatus}
        exportName="volunteer-application-status"
      >
        {byStatus.length > 0 ? (
          <HBarChart data={byStatus.slice(0, 15)} color="#06b6d4" nameWidth={200} />
        ) : (
          <EmptyHint>No status data.</EmptyHint>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section title="Volunteer activation" subtitle="Single-select pipeline stage" exportData={byActivation} exportName="volunteer-activation">
          {byActivation.length > 0 ? (
            <HBarChart data={byActivation} color="#3b82f6" nameWidth={160} />
          ) : (
            <EmptyHint>No data.</EmptyHint>
          )}
        </Section>

        <Section title="Teachers by state" subtitle="Geographic spread" exportData={teachersByState} exportName="teachers-by-state">
          {teachersByState.length > 0 ? (
            <HBarChart data={teachersByState} color="#22c55e" nameWidth={80} />
          ) : (
            <EmptyHint>No data.</EmptyHint>
          )}
        </Section>
      </div>

      <Section title="Cadetship by year" subtitle="EOI → Applications → Cadets" exportData={cadetshipSeries} exportName="cadetship-by-year">
        {cadetshipSeries.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cadetshipSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="eoi" stackId="a" fill="#fbbf24" name="EOI" />
                <Bar dataKey="applications" stackId="a" fill="#8b5cf6" name="Applications" />
                <Bar dataKey="cadets" stackId="a" fill="#22c55e" name="Cadets" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No cadetship year data.</EmptyHint>
        )}
      </Section>

      <Section
        title="Teachers — years participated"
        subtitle="Chronological — earliest year on the left"
        exportData={teachersYears}
        exportName="teachers-years-participated"
      >
        {teachersYears.length > 0 ? (
          <HBarChart data={teachersYears} color="#ec4899" nameWidth={80} />
        ) : (
          <EmptyHint>No data.</EmptyHint>
        )}
      </Section>
    </>
  );
}
