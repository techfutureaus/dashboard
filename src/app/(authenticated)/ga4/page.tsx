"use client";

import { useEffect, useMemo, useState } from "react";
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
import { format } from "date-fns";
import { useGa4Properties, useGa4Dashboard } from "@/hooks/useGa4Data";
import type { Property, Ga4DashboardData } from "@/lib/ga4";
import { DateRangeControl } from "@/components/DateRangeControl";
import { Section } from "@/components/dashboard-bits";
import { LastRefreshedBadge } from "@/components/LastRefreshedBadge";
import { defaultRange, PRESETS, matchesPreset, type DateRange } from "@/lib/date-presets";

export default function Ga4Page() {
  const {
    properties,
    loading: propsLoading,
    error: propsError,
  } = useGa4Properties();
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(defaultRange());

  useEffect(() => {
    if (!propertyId && properties && properties.length > 0) {
      setPropertyId(properties[0].id);
    }
  }, [properties, propertyId]);

  const { data, loading, error, fetchedAt, refreshing, refresh } = useGa4Dashboard(propertyId, range);

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Google Analytics</h1>
          <p className="text-sm text-gray-500">
            {data?.property.displayName ?? "Users, sessions, page views, traffic sources."}
          </p>
          <div className="mt-1">
            <LastRefreshedBadge fetchedAt={fetchedAt} refreshing={refreshing} onRefresh={refresh} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PropertyPicker
            properties={properties ?? []}
            value={propertyId}
            onChange={setPropertyId}
            disabled={propsLoading}
          />
          <DateRangeControl value={range} onChange={setRange} />
        </div>
      </div>

      {propsError && (
        <Banner tone="error">
          <strong>Couldn&apos;t list properties:</strong> {propsError}
          <p className="mt-1 text-xs">
            Check that GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY are set and the service account has
            Viewer access on at least one property.
          </p>
        </Banner>
      )}

      {!propsLoading && !propsError && properties?.length === 0 && (
        <Banner tone="warn">
          No GA4 properties visible to the service account. In each property → Admin → Property
          access management, add the service account email as a Viewer.
        </Banner>
      )}

      {propertyId && loading && <div className="text-gray-500">Loading…</div>}
      {propertyId && error && <Banner tone="error">{error}</Banner>}
      {data && <Dashboard data={data} range={range} />}
    </div>
  );
}

function Dashboard({ data, range }: { data: Ga4DashboardData; range: DateRange }) {
  const rangeLabel = useMemo(() => describeRange(range), [range]);

  const timeSeries = useMemo(
    () =>
      data.dailyMetrics.map((d) => ({
        date: d.date,
        label: formatGaDate(d.date),
        Users: d.activeUsers,
        Sessions: d.sessions,
        "Page views": d.screenPageViews,
      })),
    [data.dailyMetrics]
  );

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Active users" value={data.totals.activeUsers.toLocaleString()} sub={rangeLabel} />
        <KpiCard label="Sessions" value={data.totals.sessions.toLocaleString()} sub={rangeLabel} />
        <KpiCard label="Page views" value={data.totals.screenPageViews.toLocaleString()} sub={rangeLabel} />
        <KpiCard
          label="Avg. session duration"
          value={formatDuration(data.totals.averageSessionDuration)}
          sub={rangeLabel}
        />
      </div>

      {/* Traffic over time */}
      <Section
        title="Traffic over time"
        subtitle={`Daily users, sessions, page views · ${rangeLabel}`}
        exportData={timeSeries}
        exportName={`ga4-traffic-${data.property.id}`}
      >
        {timeSeries.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Users" stroke="#3b82f6" dot={false} />
                <Line type="monotone" dataKey="Sessions" stroke="#22c55e" dot={false} />
                <Line type="monotone" dataKey="Page views" stroke="#f59e0b" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No daily traffic in this range.</EmptyHint>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Top channels"
          subtitle="By sessions"
          exportData={data.topSources}
          exportName={`ga4-top-channels-${data.property.id}`}
        >
          {data.topSources.length > 0 ? (
            <HBarChart
              data={data.topSources.map((s) => ({ name: s.channelGroup, value: s.sessions }))}
              color="#06b6d4"
            />
          ) : (
            <EmptyHint>No channel data.</EmptyHint>
          )}
        </Section>

        <Section
          title="Top pages"
          subtitle="By page views"
          exportData={data.topPages}
          exportName={`ga4-top-pages-${data.property.id}`}
        >
          {data.topPages.length > 0 ? (
            <HBarChart
              data={data.topPages.slice(0, 10).map((p) => ({
                name: truncate(p.pageTitle || p.pagePath, 50),
                value: p.screenPageViews,
              }))}
              color="#8b5cf6"
            />
          ) : (
            <EmptyHint>No page data.</EmptyHint>
          )}
        </Section>
      </div>
    </>
  );
}

// ── Property picker ───────────────────────────────────────────────────

function PropertyPicker({
  properties,
  value,
  onChange,
  disabled,
}: {
  properties: Property[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  if (properties.length === 0) {
    return (
      <div className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-400">
        {disabled ? "Loading properties…" : "No properties"}
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-4 pr-10 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
      <svg
        className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function describeRange(range: DateRange): string {
  if (!range.start && !range.end) return "Last 365 days";
  const matched = PRESETS.find((p) => matchesPreset(range, p));
  if (matched && matched.id !== "all") return matched.label;
  if (range.start && range.end) {
    return `${format(range.start, "MMM d, yyyy")} – ${format(range.end, "MMM d, yyyy")}`;
  }
  return "Custom";
}

function formatGaDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return format(new Date(y, m - 1, d), "MMM d");
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Presentational ───────────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1 text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function HBarChart({ data, color }: { data: { name: string; value: number }[]; color: string }) {
  return (
    <div style={{ height: Math.max(200, data.length * 32) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} />
          <Tooltip />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-gray-400 py-6 text-center">{children}</div>;
}

function Banner({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "bg-red-50 border-red-200 text-red-700"
      : "bg-yellow-50 border-yellow-200 text-yellow-800";
  return <div className={`rounded-lg border p-4 text-sm mb-6 ${cls}`}>{children}</div>;
}
