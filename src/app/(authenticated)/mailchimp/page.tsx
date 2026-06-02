"use client";

import { useMemo, useState } from "react";
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
import { format, parseISO, endOfMonth } from "date-fns";
import { useMailchimpData, useMailchimpAudiences, type MailchimpDashboardData } from "@/hooks/useMailchimpData";
import { audienceMemberCount, type AudienceSummary, type SegmentItem } from "@/lib/mailchimp";
import { DateRangeControl } from "@/components/DateRangeControl";
import { Section } from "@/components/dashboard-bits";
import { defaultRange, PRESETS, matchesPreset, type DateRange } from "@/lib/date-presets";

export default function MailchimpPage() {
  // "" / "combined" → All audiences; otherwise a specific listId
  const [audienceId, setAudienceId] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange());

  const { audiences } = useMailchimpAudiences();
  const { data, loading, error } = useMailchimpData(audienceId);

  const shellProps = {
    range: dateRange,
    onRangeChange: setDateRange,
    audiences: audiences ?? [],
    audienceId,
    onAudienceChange: setAudienceId,
  };

  if (loading) {
    return (
      <PageShell {...shellProps}>
        <div className="text-gray-500">Loading…</div>
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell {...shellProps}>
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      </PageShell>
    );
  }
  if (!data) {
    return (
      <PageShell {...shellProps}>
        <div className="text-gray-500">No data.</div>
      </PageShell>
    );
  }

  return <Dashboard data={data} range={dateRange} onRangeChange={setDateRange} shellProps={shellProps} />;
}

interface ShellProps {
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  audiences: AudienceSummary[];
  audienceId: string;
  onAudienceChange: (id: string) => void;
}

function PageShell({
  range,
  onRangeChange,
  audiences,
  audienceId,
  onAudienceChange,
  audienceName,
  children,
}: ShellProps & {
  audienceName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-8 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mailchimp</h1>
          <p className="text-sm text-gray-500">
            {audienceName ?? "Subscribers, growth, tags, segments, opens & clicks."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <AudiencePicker
            audiences={audiences}
            value={audienceId}
            onChange={onAudienceChange}
          />
          <DateRangeControl value={range} onChange={onRangeChange} />
        </div>
      </div>
      {children}
    </div>
  );
}

function AudiencePicker({
  audiences,
  value,
  onChange,
}: {
  audiences: AudienceSummary[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-4 pr-10 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
      >
        <option value="">All audiences</option>
        {audiences.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.member_count.toLocaleString()})
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

function Dashboard({
  data,
  range,
  onRangeChange,
  shellProps,
}: {
  data: MailchimpDashboardData;
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  shellProps: ShellProps;
}) {
  const { audience, growth, segments, reports } = data;

  // Growth history is newest-first → reverse to chronological, then keep raw date.
  const growthAll = useMemo(() => {
    return [...growth].reverse().map((g) => {
      const monthDate = parseMonth(g.month);
      return {
        month: g.month,
        monthDate,
        monthLabel: format(monthDate, "MMM yy"),
        subscribed: g.subscribed ?? g.optins ?? 0,
        unsubscribed: -(g.unsubscribed ?? 0),
        net: (g.subscribed ?? g.optins ?? 0) - (g.unsubscribed ?? 0),
      };
    });
  }, [growth]);

  const growthInRange = useMemo(() => {
    if (!range.start && !range.end) return growthAll;
    return growthAll.filter((g) => {
      const monthEndDate = endOfMonth(g.monthDate);
      if (range.start && monthEndDate < range.start) return false;
      if (range.end && g.monthDate > range.end) return false;
      return true;
    });
  }, [growthAll, range]);

  const netChange = useMemo(
    () => growthInRange.reduce((sum, g) => sum + g.net, 0),
    [growthInRange]
  );

  const tags = useMemo(
    () =>
      segments
        .filter((s: SegmentItem) => s.type === "static")
        .sort((a, b) => b.member_count - a.member_count)
        .slice(0, 10)
        .map((s) => ({ name: s.name, members: s.member_count })),
    [segments]
  );

  const savedSegments = useMemo(
    () =>
      segments
        .filter((s: SegmentItem) => s.type === "saved")
        .sort((a, b) => b.member_count - a.member_count)
        .slice(0, 10)
        .map((s) => ({ name: s.name, members: s.member_count })),
    [segments]
  );

  const campaignsAll = useMemo(() => {
    return [...reports]
      .filter((r) => r.send_time && r.opens && r.clicks)
      .map((r) => {
        const sendDate = parseISO(r.send_time);
        return {
          sendDate,
          sendDateLabel: format(sendDate, "MMM d, yy"),
          title: r.campaign_title,
          openRate: Math.round((r.opens?.open_rate ?? 0) * 1000) / 10,
          clickRate: Math.round((r.clicks?.click_rate ?? 0) * 1000) / 10,
        };
      })
      .sort((a, b) => a.sendDate.getTime() - b.sendDate.getTime());
  }, [reports]);

  const campaignsInRange = useMemo(() => {
    if (!range.start && !range.end) return campaignsAll;
    return campaignsAll.filter((c) => {
      if (range.start && c.sendDate < range.start) return false;
      if (range.end && c.sendDate > range.end) return false;
      return true;
    });
  }, [campaignsAll, range]);

  const avgOpenRate =
    campaignsInRange.length > 0
      ? campaignsInRange.reduce((s, c) => s + c.openRate, 0) / campaignsInRange.length
      : null;
  const avgClickRate =
    campaignsInRange.length > 0
      ? campaignsInRange.reduce((s, c) => s + c.clickRate, 0) / campaignsInRange.length
      : null;

  const rangeLabel = useMemo(() => describeRange(range), [range]);

  return (
    <PageShell {...shellProps} audienceName={audience.name}>
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Total subscribers"
          value={audienceMemberCount(audience).toLocaleString()}
          sub="Current"
        />
        <KpiCard
          label="Net change"
          value={netChange.toLocaleString()}
          sub={rangeLabel}
          tone={netChange >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Avg open rate"
          value={avgOpenRate !== null ? `${avgOpenRate.toFixed(1)}%` : "—"}
          sub={`${campaignsInRange.length} campaign${campaignsInRange.length === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Avg click rate"
          value={avgClickRate !== null ? `${avgClickRate.toFixed(1)}%` : "—"}
          sub={`${campaignsInRange.length} campaign${campaignsInRange.length === 1 ? "" : "s"}`}
        />
      </div>

      {/* Growth chart */}
      <Section
        title="Subscriber growth"
        subtitle={`Net subscribers per month • ${rangeLabel}`}
        exportData={growthInRange}
        exportName="mailchimp-subscriber-growth"
      >
        {growthInRange.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growthInRange} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="subscribed" stroke="#22c55e" name="Subscribed" dot={false} />
                <Line type="monotone" dataKey="unsubscribed" stroke="#ef4444" name="Unsubscribed" dot={false} />
                <Line type="monotone" dataKey="net" stroke="#3b82f6" name="Net" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No growth history in this range.</EmptyHint>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Section
          title="Top tags"
          subtitle={`${tags.length} of ${segments.filter((s) => s.type === "static").length} shown · current snapshot`}
          exportData={tags}
          exportName="mailchimp-top-tags"
        >
          {tags.length > 0 ? <HBarChart data={tags} color="#8b5cf6" /> : <EmptyHint>No tags yet.</EmptyHint>}
        </Section>
        <Section
          title="Saved segments"
          subtitle={`${savedSegments.length} of ${segments.filter((s) => s.type === "saved").length} shown · current snapshot`}
          exportData={savedSegments}
          exportName="mailchimp-saved-segments"
        >
          {savedSegments.length > 0 ? (
            <HBarChart data={savedSegments} color="#06b6d4" />
          ) : (
            <EmptyHint>No saved segments yet.</EmptyHint>
          )}
        </Section>
      </div>

      <Section
        title="Campaign performance over time"
        subtitle={`Open rate vs click rate • ${rangeLabel}`}
        exportData={campaignsInRange.map((c) => ({
          sendDate: c.sendDate.toISOString(),
          campaign: c.title,
          openRate: c.openRate,
          clickRate: c.clickRate,
        }))}
        exportName="mailchimp-campaign-performance"
      >
        {campaignsInRange.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={campaignsInRange} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="sendDateLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip
                  formatter={(value) => {
                    const n = typeof value === "number" ? value : Number(value);
                    return `${n.toFixed(1)}%`;
                  }}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { title?: string; sendDateLabel?: string };
                    return p?.title ? `${p.title} — ${p.sendDateLabel}` : "";
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="openRate" stroke="#f59e0b" name="Open rate" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="clickRate" stroke="#ec4899" name="Click rate" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyHint>No campaigns in this range.</EmptyHint>
        )}
      </Section>
    </PageShell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseMonth(month: string): Date {
  // Accepts "YYYY-MM" or "YYYY-MM-DD"
  const [y, m, d] = month.split("-");
  return new Date(Number(y), Number(m) - 1, d ? Number(d) : 1);
}

function describeRange(range: DateRange): string {
  if (!range.start && !range.end) return "All time";
  const matched = PRESETS.find((p) => matchesPreset(range, p));
  if (matched) return matched.label;
  if (range.start && range.end) {
    return `${format(range.start, "MMM d, yyyy")} – ${format(range.end, "MMM d, yyyy")}`;
  }
  return "Custom";
}

// ── Small presentational pieces ──────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive" ? "text-green-600" : tone === "negative" ? "text-red-600" : "text-gray-900";
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function HBarChart({ data, color }: { data: { name: string; members: number }[]; color: string }) {
  return (
    <div style={{ height: Math.max(200, data.length * 32) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
          <Tooltip />
          <Bar dataKey="members" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-gray-400 py-6 text-center">{children}</div>;
}
