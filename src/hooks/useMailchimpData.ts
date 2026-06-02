"use client";

import { useFreshFetch } from "./useFreshFetch";
import { TAGS } from "@/lib/cache-tags";
import type {
  Audience,
  AudienceSummary,
  GrowthHistoryItem,
  SegmentItem,
  CampaignReport,
} from "@/lib/mailchimp";

export interface MailchimpDashboardData {
  audience: Audience;
  growth: GrowthHistoryItem[];
  segments: SegmentItem[];
  reports: CampaignReport[];
}

export function useMailchimpData(listId: string = "") {
  const url = listId
    ? `/api/mailchimp/dashboard?listId=${encodeURIComponent(listId)}`
    : "/api/mailchimp/dashboard";
  return useFreshFetch<MailchimpDashboardData>(url, TAGS.mailchimpDashboard);
}

export function useMailchimpAudiences() {
  const res = useFreshFetch<{ audiences: AudienceSummary[] }>(
    "/api/mailchimp/audiences",
    TAGS.mailchimpAudiences
  );
  return {
    ...res,
    audiences: res.data?.audiences ?? null,
  };
}
