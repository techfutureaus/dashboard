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
import { formatGaDate } from "@/components/Ga4ReportPage";
import { UmamiReportPage } from "@/components/UmamiReportPage";
import { useUmamiLumen } from "@/hooks/useUmamiData";
import { Section, KpiCard, HBarChart, EmptyHint } from "@/components/dashboard-bits";
import type { LumenReport } from "@/lib/umami";

export default function LumenPage() {
  return (
    <UmamiReportPage
      title="Lumen (AI editor)"
      subtitleFallback="Scenario usage, prompt clicks, and token consumption."
      useData={useUmamiLumen}
    >
      {(data, rangeLabel) => <LumenBody data={data} rangeLabel={rangeLabel} />}
    </UmamiReportPage>
  );
}

function LumenBody({ data, rangeLabel }: { data: LumenReport; rangeLabel: string }) {
  const t = data.totals;
  const responseSeries = useMemo(
    () =>
      data.responsesDaily.map((d) => ({
        label: formatGaDate(d.date),
        Responses: d.count,
      })),
    [data.responsesDaily]
  );
  const propId = data.property.id;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Sessions" value={t.sessions.toLocaleString()} sub={rangeLabel} />
        <KpiCard label="Prompt clicks" value={t.promptClicks.toLocaleString()} sub={rangeLabel} />
        <KpiCard label="Total tokens" value={t.totalTokens.toLocaleString()} sub={rangeLabel} />
        <KpiCard
          label="Avg tokens / response"
          value={t.avgTokensPerResponse.toLocaleString()}
          sub={`${t.responses.toLocaleString()} responses`}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Input tokens" value={t.inputTokens.toLocaleString()} sub={rangeLabel} />
        <KpiCard label="Output tokens" value={t.outputTokens.toLocaleString()} sub={rangeLabel} />
      </div>

      <Section
        title="AI responses over time"
        subtitle={`Prompt responses per day · ${rangeLabel}`}
        exportData={responseSeries}
        exportName={`lumen-responses-${propId}`}
      >
        {responseSeries.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={responseSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="Responses" stroke="#8b5cf6" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No AI activity in this range yet.</EmptyHint>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Sessions by scenario"
          subtitle="Which Lumen activities get opened"
          exportData={data.byScenario}
          exportName={`lumen-scenarios-${propId}`}
        >
          {data.byScenario.length > 0 ? (
            <HBarChart
              data={data.byScenario.map((s) => ({ name: s.scenario, count: s.sessions }))}
              color="#3b82f6"
            />
          ) : (
            <EmptyHint>No sessions in this range.</EmptyHint>
          )}
        </Section>

        <Section
          title="Responses by scenario"
          subtitle="AI responses per activity"
          exportData={data.byScenario}
          exportName={`lumen-scenario-responses-${propId}`}
        >
          {data.byScenario.some((s) => s.responses > 0) ? (
            <HBarChart
              data={data.byScenario.map((s) => ({ name: s.scenario, count: s.responses }))}
              color="#8b5cf6"
            />
          ) : (
            <EmptyHint>No responses in this range.</EmptyHint>
          )}
        </Section>
      </div>

      <Section
        title="Most-clicked prompts"
        subtitle="Predefined prompts by click count"
        exportData={data.topPrompts}
        exportName={`lumen-prompts-${propId}`}
      >
        {data.topPrompts.length > 0 ? (
          <HBarChart data={data.topPrompts} color="#06b6d4" nameWidth={220} />
        ) : (
          <EmptyHint>No prompt clicks in this range.</EmptyHint>
        )}
      </Section>
    </>
  );
}
