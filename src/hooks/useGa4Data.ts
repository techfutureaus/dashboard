"use client";

import { format } from "date-fns";
import { useFreshFetch } from "./useFreshFetch";
import { TAGS } from "@/lib/cache-tags";
import type { Ga4DashboardData, Property } from "@/lib/ga4";
import type {
  LumenReport,
  EngagementReport,
  FunnelReport,
} from "@/lib/ga4-lms";
import type { DateRange } from "@/lib/date-presets";

// Build a `/api/ga4/<report>` URL with the selected property + date range, or
// null while no property is chosen (which pauses the fetch).
function ga4Url(
  path: string,
  propertyId: string | null,
  range: DateRange
): string | null {
  if (!propertyId) return null;
  const params = new URLSearchParams({ propertyId });
  if (range.start) params.set("start", format(range.start, "yyyy-MM-dd"));
  if (range.end) params.set("end", format(range.end, "yyyy-MM-dd"));
  return `${path}?${params.toString()}`;
}

export function useGa4Properties() {
  const res = useFreshFetch<{ properties: Property[] }>(
    "/api/ga4/properties",
    TAGS.ga4Properties
  );
  return {
    ...res,
    properties: res.data?.properties ?? null,
  };
}

export function useGa4Dashboard(propertyId: string | null, range: DateRange) {
  return useFreshFetch<Ga4DashboardData>(
    ga4Url("/api/ga4/dashboard", propertyId, range),
    TAGS.ga4Dashboard
  );
}

export function useGa4Lumen(propertyId: string | null, range: DateRange) {
  return useFreshFetch<LumenReport>(
    ga4Url("/api/ga4/lumen", propertyId, range),
    TAGS.ga4Lumen
  );
}

export function useGa4Engagement(propertyId: string | null, range: DateRange) {
  return useFreshFetch<EngagementReport>(
    ga4Url("/api/ga4/engagement", propertyId, range),
    TAGS.ga4Engagement
  );
}

export function useGa4Funnel(propertyId: string | null, range: DateRange) {
  return useFreshFetch<FunnelReport>(
    ga4Url("/api/ga4/funnel", propertyId, range),
    TAGS.ga4Funnel
  );
}
