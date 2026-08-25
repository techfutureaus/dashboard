"use client";

import { format } from "date-fns";
import { useFreshFetch } from "./useFreshFetch";
import { TAGS } from "@/lib/cache-tags";
import type {
  EngagementReport,
  FunnelReport,
  LumenReport,
} from "@/lib/umami";
import type { WebsiteReport } from "@/lib/website";
import type { DateRange } from "@/lib/date-presets";

// Build a `/api/umami/<report>` URL with the selected date range. Unlike GA4
// there is no property to pick — one Umami website covers the LMS + Lumen.
function umamiUrl(path: string, range: DateRange): string {
  const params = new URLSearchParams();
  if (range.start) params.set("start", format(range.start, "yyyy-MM-dd"));
  if (range.end) params.set("end", format(range.end, "yyyy-MM-dd"));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function useUmamiEngagement(range: DateRange) {
  return useFreshFetch<EngagementReport>(
    umamiUrl("/api/umami/engagement", range),
    TAGS.umamiEngagement
  );
}

export function useUmamiFunnel(range: DateRange) {
  return useFreshFetch<FunnelReport>(
    umamiUrl("/api/umami/funnel", range),
    TAGS.umamiFunnel
  );
}

export function useUmamiLumen(range: DateRange) {
  return useFreshFetch<LumenReport>(
    umamiUrl("/api/umami/lumen", range),
    TAGS.umamiLumen
  );
}

export function useUmamiWebsite(range: DateRange) {
  return useFreshFetch<WebsiteReport>(
    umamiUrl("/api/umami/website", range),
    TAGS.umamiWebsite
  );
}
