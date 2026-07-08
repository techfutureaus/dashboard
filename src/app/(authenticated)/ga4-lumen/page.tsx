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
import { useGa4Lumen } from "@/hooks/useGa4Data";
import { Section, KpiCard, HBarChart, EmptyHint } from "@/components/dashboard-bits";
import type { LumenReport } from "@/lib/ga4-lms";

export default function LumenPage() {
  return (
    <Ga4ReportPage
      title="Lumen (AI editor)"
      subtitleFallback="Scenario usage, prompt clicks, and token consumption."
      useData={useGa4Lumen}
    >
      {(data, rangeLabel) => <LumenBody data={data} rangeLabel={rangeLabel} />}
    </Ga4ReportPage>
  );
}

function LumenBody({ data, rangeLabel }: { data: LumenReport; rangeLabel: string }) {
  const t = data.totals;
  const tokenSeries = useMemo(
    () =>
      data.tokensDaily.map((d) => ({
        label: formatGaDate(d.date),
        Tokens: d.totalTokens,
      })),
    [data.tokensDaily]
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
        title="Tokens over time"
        subtitle={`Total tokens per day · ${rangeLabel}`}
        exportData={tokenSeries}
        exportName={`lumen-tokens-${propId}`}
      >
        {tokenSeries.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tokenSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="Tokens" stroke="#8b5cf6" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No token usage in this range yet.</EmptyHint>
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
          title="Tokens by scenario"
          subtitle="Token consumption per activity"
          exportData={data.byScenario}
          exportName={`lumen-scenario-tokens-${propId}`}
        >
          {data.byScenario.some((s) => s.totalTokens > 0) ? (
            <HBarChart
              data={data.byScenario.map((s) => ({ name: s.scenario, count: s.totalTokens }))}
              color="#8b5cf6"
            />
          ) : (
            <EmptyHint>No token data in this range.</EmptyHint>
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
