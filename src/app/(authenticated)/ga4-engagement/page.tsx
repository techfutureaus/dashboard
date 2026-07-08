"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Ga4ReportPage, formatGaDate } from "@/components/Ga4ReportPage";
import { useGa4Engagement } from "@/hooks/useGa4Data";
import { Section, KpiCard, HBarChart, EmptyHint } from "@/components/dashboard-bits";
import type { EngagementReport } from "@/lib/ga4-lms";

export default function EngagementPage() {
  return (
    <Ga4ReportPage
      title="Engagement"
      subtitleFallback="Content views, interactions, media, and progress events."
      useData={useGa4Engagement}
    >
      {(data, rangeLabel) => <EngagementBody data={data} rangeLabel={rangeLabel} />}
    </Ga4ReportPage>
  );
}

function EngagementBody({
  data,
  rangeLabel,
}: {
  data: EngagementReport;
  rangeLabel: string;
}) {
  const series = useMemo(
    () =>
      data.eventsDaily.map((d) => ({
        label: formatGaDate(d.date),
        Events: d.count,
      })),
    [data.eventsDaily]
  );
  const propId = data.property.id;
  const typeCount = (name: string) =>
    data.byType.find((t) => t.name === name)?.count ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Total events"
          value={data.totals.totalEvents.toLocaleString()}
          sub={rangeLabel}
        />
        <KpiCard label="Content views" value={typeCount("content_view").toLocaleString()} sub={rangeLabel} />
        <KpiCard
          label="Interactions"
          value={typeCount("content_interaction").toLocaleString()}
          sub={rangeLabel}
        />
        <KpiCard label="Progress" value={typeCount("progress").toLocaleString()} sub={rangeLabel} />
      </div>

      <Section
        title="Events over time"
        subtitle={`Daily engagement events · ${rangeLabel}`}
        exportData={series}
        exportName={`engagement-daily-${propId}`}
      >
        {series.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="Events" stroke="#22c55e" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No engagement events in this range yet.</EmptyHint>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Events by type"
          subtitle="engagement_type buckets"
          exportData={data.byType}
          exportName={`engagement-by-type-${propId}`}
        >
          {data.byType.length > 0 ? (
            <HBarChart data={data.byType} color="#3b82f6" />
          ) : (
            <EmptyHint>No typed events in this range.</EmptyHint>
          )}
        </Section>

        <Section
          title="Top interaction events"
          subtitle="Accordions, reveals, tabs, media, resource clicks"
          exportData={data.topInteractions}
          exportName={`engagement-interactions-${propId}`}
        >
          {data.topInteractions.length > 0 ? (
            <HBarChart data={data.topInteractions} color="#06b6d4" />
          ) : (
            <EmptyHint>No interactions in this range.</EmptyHint>
          )}
        </Section>
      </div>

      <Section
        title="Top lessons by engagement"
        subtitle="Events grouped by lesson_slug"
        exportData={data.topLessons}
        exportName={`engagement-top-lessons-${propId}`}
      >
        {data.topLessons.length > 0 ? (
          <HBarChart data={data.topLessons} color="#8b5cf6" nameWidth={220} />
        ) : (
          <EmptyHint>No lesson-level engagement in this range.</EmptyHint>
        )}
      </Section>
    </>
  );
}
