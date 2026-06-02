"use client";

import { useState } from "react";
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
import { useTeacherTrainingAgg, type UpliftPair } from "@/hooks/useAirtableData";
import {
  Section,
  KpiCard,
  HBarChart,
  EmptyHint,
  Banner,
  Select,
  SegmentedControl,
  Toolbar,
} from "@/components/dashboard-bits";
import { LastRefreshedBadge } from "@/components/LastRefreshedBadge";

type Cohort = "all" | "primary" | "secondary";

export default function TeacherTrainingPage() {
  const [event, setEvent] = useState("");
  const [cohort, setCohort] = useState<Cohort>("all");
  const { data, loading, error, fetchedAt, refreshing, refresh } = useTeacherTrainingAgg({
    event,
    cohort: cohort === "all" ? undefined : cohort,
  });

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <div className="text-gray-500">No data.</div>;

  const npsLabel = data.avgRecommend !== null ? `${data.avgRecommend.toFixed(2)} / 5` : "—";
  const satLabel = data.avgSatisfaction !== null ? `${data.avgSatisfaction.toFixed(2)} / 5` : "—";

  return (
    <>
      <div className="mb-3">
        <LastRefreshedBadge fetchedAt={fetchedAt} refreshing={refreshing} onRefresh={refresh} />
      </div>
      <Toolbar>
        <Select
          label="Session"
          value={event}
          onChange={setEvent}
          options={data.facets.events}
          allLabel="All sessions"
        />
        <SegmentedControl
          value={cohort}
          onChange={setCohort}
          options={[
            { value: "all", label: "All" },
            { value: "primary", label: "Primary" },
            { value: "secondary", label: "Secondary" },
          ]}
        />
        <span className="ml-auto text-xs text-gray-500">
          {data.total} teachers{event ? ` at ${event}` : ""}
        </span>
      </Toolbar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Teachers with training data"
          value={data.total.toLocaleString()}
          sub={event ? "in selected session" : "across all sessions"}
        />
        <KpiCard label="Avg satisfaction" value={satLabel} sub={`n=${data.satN}`} />
        <KpiCard label="Avg recommendation" value={npsLabel} sub={`n=${data.recommendN}`} />
        <KpiCard
          label="Sessions in view"
          value={String(data.byEvent.length)}
          sub="distinct trainings"
        />
      </div>

      {!event && (
        <Section
          title="Attendees per training session"
          subtitle="From “I attended:” multi-select"
          exportData={data.byEvent}
          exportName="training-attendees-per-session"
        >
          {data.byEvent.length > 0 ? (
            <HBarChart data={data.byEvent} color="#8b5cf6" nameWidth={240} />
          ) : (
            <EmptyHint>No session attendance data.</EmptyHint>
          )}
        </Section>
      )}

      <Section
        title="Training format preference"
        subtitle="In-person vs Zoom vs pre-recorded"
        exportData={data.byFormat}
        exportName="training-format-preference"
      >
        {data.byFormat.length > 0 ? (
          <HBarChart data={data.byFormat} color="#06b6d4" nameWidth={280} />
        ) : (
          <EmptyHint>No format data.</EmptyHint>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Confidence: teaching coding"
          subtitle="Before vs after training (1–5 scale)"
          exportData={upliftRows(cohort, data.confidenceUplift)}
          exportName="training-confidence-coding"
        >
          <UpliftChart cohort={cohort} pair={data.confidenceUplift} />
        </Section>

        <Section
          title="Competence: coding concepts"
          subtitle="Before vs after training (1–5 scale)"
          exportData={upliftRows(cohort, data.competenceCodingUplift)}
          exportName="training-competence-coding"
        >
          <UpliftChart cohort={cohort} pair={data.competenceCodingUplift} />
        </Section>

        <Section
          title="Competence: computational thinking"
          subtitle="Before vs after training (1–5 scale)"
          exportData={upliftRows(cohort, data.competenceThinkingUplift)}
          exportName="training-competence-thinking"
        >
          <UpliftChart cohort={cohort} pair={data.competenceThinkingUplift} />
        </Section>

        <Section
          title="Summary uplifts"
          subtitle="Average net change (after − before)"
          exportData={summaryRows(cohort, [
            { label: "Confidence", primary: data.confidenceUplift.primary, secondary: data.confidenceUplift.secondary },
            { label: "Coding competence", primary: data.competenceCodingUplift.primary, secondary: data.competenceCodingUplift.secondary },
            { label: "Computational thinking", primary: data.competenceThinkingUplift.primary, secondary: data.competenceThinkingUplift.secondary },
          ])}
          exportName="training-summary-uplifts"
        >
          <UpliftSummary
            cohort={cohort}
            rows={[
              { label: "Confidence", primary: data.confidenceUplift.primary, secondary: data.confidenceUplift.secondary },
              {
                label: "Coding competence",
                primary: data.competenceCodingUplift.primary,
                secondary: data.competenceCodingUplift.secondary,
              },
              {
                label: "Computational thinking",
                primary: data.competenceThinkingUplift.primary,
                secondary: data.competenceThinkingUplift.secondary,
              },
            ]}
          />
        </Section>
      </div>
    </>
  );
}

function upliftRows(cohort: Cohort, pair: { primary: UpliftPair; secondary: UpliftPair }) {
  const out: Record<string, unknown>[] = [];
  if (cohort !== "secondary") {
    out.push({ cohort: "Primary", before: pair.primary.before, after: pair.primary.after, uplift: pair.primary.uplift, n: pair.primary.n });
  }
  if (cohort !== "primary") {
    out.push({ cohort: "Secondary", before: pair.secondary.before, after: pair.secondary.after, uplift: pair.secondary.uplift, n: pair.secondary.n });
  }
  return out;
}

function summaryRows(
  cohort: Cohort,
  rows: { label: string; primary: UpliftPair; secondary: UpliftPair }[]
) {
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (cohort !== "secondary") {
      out.push({ measure: `${r.label} — primary`, before: r.primary.before, after: r.primary.after, uplift: r.primary.uplift, n: r.primary.n });
    }
    if (cohort !== "primary") {
      out.push({ measure: `${r.label} — secondary`, before: r.secondary.before, after: r.secondary.after, uplift: r.secondary.uplift, n: r.secondary.n });
    }
  }
  return out;
}

function UpliftChart({
  cohort,
  pair,
}: {
  cohort: Cohort;
  pair: { primary: UpliftPair; secondary: UpliftPair };
}) {
  const rows: { name: string; before: number; after: number }[] = [];
  if (cohort !== "secondary") {
    rows.push({ name: "Primary", before: pair.primary.before ?? 0, after: pair.primary.after ?? 0 });
  }
  if (cohort !== "primary") {
    rows.push({
      name: "Secondary",
      before: pair.secondary.before ?? 0,
      after: pair.secondary.after ?? 0,
    });
  }
  const hasAny =
    (cohort !== "secondary" && (pair.primary.before !== null || pair.primary.after !== null)) ||
    (cohort !== "primary" && (pair.secondary.before !== null || pair.secondary.after !== null));
  if (!hasAny) return <EmptyHint>No matching survey responses.</EmptyHint>;

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              return n.toFixed(2);
            }}
          />
          <Legend />
          <Bar dataKey="before" name="Before" fill="#94a3b8" radius={[4, 4, 0, 0]} />
          <Bar dataKey="after" name="After" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function UpliftSummary({
  cohort,
  rows,
}: {
  cohort: Cohort;
  rows: { label: string; primary: UpliftPair; secondary: UpliftPair }[];
}) {
  const flat: { label: string; v: UpliftPair }[] = [];
  for (const row of rows) {
    if (cohort !== "secondary") flat.push({ label: `${row.label} — primary`, v: row.primary });
    if (cohort !== "primary") flat.push({ label: `${row.label} — secondary`, v: row.secondary });
  }
  return (
    <div className="space-y-2 text-sm">
      {flat.map((r) => (
        <div
          key={r.label}
          className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0"
        >
          <span className="text-gray-700">{r.label}</span>
          <span className="font-mono text-xs text-gray-500">
            {r.v.before !== null && r.v.after !== null ? (
              <>
                {r.v.before.toFixed(2)} → {r.v.after.toFixed(2)}{" "}
                <span
                  className={
                    (r.v.uplift ?? 0) >= 0
                      ? "text-green-600 font-semibold"
                      : "text-red-600 font-semibold"
                  }
                >
                  ({(r.v.uplift ?? 0) >= 0 ? "+" : ""}
                  {(r.v.uplift ?? 0).toFixed(2)})
                </span>
                <span className="text-gray-400 ml-2">n={r.v.n}</span>
              </>
            ) : (
              <span className="text-gray-400">no data</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
