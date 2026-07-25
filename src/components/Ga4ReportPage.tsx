"use client";

import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { useGa4Properties } from "@/hooks/useGa4Data";
import type { Property } from "@/lib/ga4";
import { DateRangeControl } from "@/components/DateRangeControl";
import { Banner } from "@/components/dashboard-bits";
import {
  defaultRange,
  PRESETS,
  matchesPreset,
  type DateRange,
} from "@/lib/date-presets";

type FetchState<T> = {
  data: T | null | undefined;
  loading: boolean;
  error: string | null;
};

// Shared chrome for the LMS/Lumen GA4 report pages: loads properties, renders the
// property picker + date-range control, handles loading/error/empty states, and
// hands the report data (+ a human range label) to `children`.
export function Ga4ReportPage<T extends { property: Property }>({
  title,
  subtitleFallback,
  useData,
  children,
}: {
  title: string;
  subtitleFallback: string;
  useData: (propertyId: string | null, range: DateRange) => FetchState<T>;
  children: (data: T, rangeLabel: string) => ReactNode;
}) {
  const {
    properties,
    loading: propsLoading,
    error: propsError,
  } = useGa4Properties();
  const [chosenPropertyId, setPropertyId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(defaultRange());

  // Derive the effective selection instead of syncing it into state via an
  // effect: default to the first property until the user picks one.
  const propertyId = chosenPropertyId ?? properties?.[0]?.id ?? null;

  const { data, loading, error } = useData(propertyId, range);
  const rangeLabel = describeRange(range);

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">
            {data?.property.displayName ?? subtitleFallback}
          </p>
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
        </Banner>
      )}

      {!propsLoading && !propsError && properties?.length === 0 && (
        <Banner tone="warn">
          No GA4 properties visible to the service account. Add the service-account
          email as a Viewer in the property&apos;s access management.
        </Banner>
      )}

      {propertyId && loading && <div className="text-gray-500">Loading…</div>}
      {propertyId && error && <Banner tone="error">{error}</Banner>}
      {data && children(data, rangeLabel)}
    </div>
  );
}

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

export function describeRange(range: DateRange): string {
  if (!range.start && !range.end) return "Last 365 days";
  const matched = PRESETS.find((p) => matchesPreset(range, p));
  if (matched && matched.id !== "all") return matched.label;
  if (range.start && range.end) {
    return `${format(range.start, "MMM d, yyyy")} – ${format(range.end, "MMM d, yyyy")}`;
  }
  return "Custom";
}

// GA4 returns dates as YYYYMMDD; format for axis labels.
export function formatGaDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return format(new Date(y, m - 1, d), "MMM d");
}
