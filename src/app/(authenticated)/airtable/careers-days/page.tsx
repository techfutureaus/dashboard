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
import { useCareersDaysAgg, type UpliftPair } from "@/hooks/useAirtableData";
import {
  Section,
  KpiCard,
  HBarChart,
  EmptyHint,
  Banner,
  Select,
  Toolbar,
} from "@/components/dashboard-bits";

export default function CareersDaysPage() {
  const [event, setEvent] = useState("");
  const { data, loading, error } = useCareersDaysAgg({ event });

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <div className="text-gray-500">No data.</div>;

  const topPerception = data.studentPerceptions[0]?.name ?? "—";
  const avgUplift = avgOfUplifts([
    data.understandingUplift,
    data.confidenceCareersUplift,
    data.confidenceImpactUplift,
    data.confidenceAIUplift,
  ]);

  return (
    <>
      <Toolbar>
        <Select
          label="Event"
          value={event}
          onChange={setEvent}
          options={data.facets.events}
          allLabel="All events"
        />
        <span className="ml-auto text-xs text-gray-500">
          {data.total} attendees{event ? ` at ${event}` : ""}
        </span>
      </Toolbar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Teachers attended" value={data.total.toLocaleString()} />
        <KpiCard
          label="Events shown"
          value={String(event ? 1 : data.byEvent.length)}
          sub={event ? "filtered" : "all"}
        />
        <KpiCard
          label="Avg confidence uplift"
          value={avgUplift !== null ? `+${avgUplift.toFixed(2)}` : "—"}
          sub="across all 4 measures"
          tone={avgUplift !== null && avgUplift >= 0 ? "positive" : "neutral"}
        />
        <KpiCard label="Top reported student view" value="" sub={topPerception} />
      </div>

      {!event && (
        <Section
          title="Attendees per careers day event"
          subtitle='From "TF Careers day" field'
          exportData={data.byEvent}
          exportName="careers-days-attendees-per-event"
        >
          {data.byEvent.length > 0 ? (
            <HBarChart data={data.byEvent} color="#3b82f6" nameWidth={260} />
          ) : (
            <EmptyHint>No careers day attendance data.</EmptyHint>
          )}
        </Section>
      )}

      <Section
        title="Before vs after — across 4 confidence/understanding measures"
        subtitle="1–5 scale"
        exportData={[
          { measure: "Understanding of tech careers", ...data.understandingUplift },
          { measure: "Confidence: discussing tech careers", ...data.confidenceCareersUplift },
          { measure: "Confidence: discussing tech impact", ...data.confidenceImpactUplift },
          { measure: "Confidence: discussing AI impact", ...data.confidenceAIUplift },
        ]}
        exportName="careers-days-uplift"
      >
        <UpliftQuad
          items={[
            { label: "Understanding of tech careers", v: data.understandingUplift },
            { label: "Confidence: discussing tech careers", v: data.confidenceCareersUplift },
            { label: "Confidence: discussing tech impact", v: data.confidenceImpactUplift },
            { label: "Confidence: discussing AI impact", v: data.confidenceAIUplift },
          ]}
        />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="How students view tech careers"
          subtitle="Teacher-reported perceptions (closest to “biggest challenge”)"
          exportData={data.studentPerceptions}
          exportName="careers-days-student-perceptions"
        >
          {data.studentPerceptions.length > 0 ? (
            <HBarChart data={data.studentPerceptions} color="#ec4899" nameWidth={260} />
          ) : (
            <EmptyHint>No perception data.</EmptyHint>
          )}
        </Section>

        <Section
          title="Why teachers attended"
          subtitle="Motivations (multi-select)"
          exportData={data.whyAttending}
          exportName="careers-days-why-attending"
        >
          {data.whyAttending.length > 0 ? (
            <HBarChart data={data.whyAttending} color="#f59e0b" nameWidth={260} />
          ) : (
            <EmptyHint>No motivation data.</EmptyHint>
          )}
        </Section>

        <Section
          title="What they want from us in 2026"
          subtitle='"2026 careers support" multi-select'
          exportData={data.wantedSupport}
          exportName="careers-days-wanted-2026-support"
        >
          {data.wantedSupport.length > 0 ? (
            <HBarChart data={data.wantedSupport} color="#22c55e" nameWidth={260} />
          ) : (
            <EmptyHint>No 2026 support preference data.</EmptyHint>
          )}
        </Section>
      </div>
    </>
  );
}

function avgOfUplifts(uplifts: UpliftPair[]): number | null {
  const valid = uplifts.filter((u) => u.uplift !== null).map((u) => u.uplift as number);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function UpliftQuad({ items }: { items: { label: string; v: UpliftPair }[] }) {
  const rows = items.map((i) => ({
    name: i.label,
    before: i.v.before ?? 0,
    after: i.v.after ?? 0,
  }));
  const hasAny = items.some((i) => i.v.before !== null || i.v.after !== null);
  if (!hasAny) return <EmptyHint>No survey responses yet.</EmptyHint>;

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={240} />
          <Tooltip
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              return n.toFixed(2);
            }}
          />
          <Legend />
          <Bar dataKey="before" name="Before" fill="#94a3b8" radius={[0, 4, 4, 0]} />
          <Bar dataKey="after" name="After" fill="#3b82f6" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
