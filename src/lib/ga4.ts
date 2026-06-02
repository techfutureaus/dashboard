import { BetaAnalyticsDataClient, protos as dataProtos } from "@google-analytics/data";
import { AnalyticsAdminServiceClient } from "@google-analytics/admin";
import { cached } from "./api-response";
import { TAGS } from "./cache-tags";

let dataClient: BetaAnalyticsDataClient | null = null;
let adminClient: AnalyticsAdminServiceClient | null = null;

function credentials() {
  const client_email = process.env.GA4_CLIENT_EMAIL;
  const private_key = process.env.GA4_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!client_email || !private_key) {
    throw new Error(
      "GA4 service account not configured. Set GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY."
    );
  }
  return { client_email, private_key };
}

export function getDataClient(): BetaAnalyticsDataClient {
  if (!dataClient) {
    dataClient = new BetaAnalyticsDataClient({ credentials: credentials() });
  }
  return dataClient;
}

export function getAdminClient(): AnalyticsAdminServiceClient {
  if (!adminClient) {
    adminClient = new AnalyticsAdminServiceClient({ credentials: credentials() });
  }
  return adminClient;
}

export interface Property {
  id: string; // "123456789"
  resourceName: string; // "properties/123456789"
  displayName: string;
  parent?: string; // account display name, for grouping
}

/**
 * Auto-discover all GA4 properties the service account can access.
 * Falls back to a single pinned property if GA4_PROPERTY_ID is set.
 */
async function _listProperties(): Promise<Property[]> {
  const pinned = process.env.GA4_PROPERTY_ID;
  if (pinned) {
    return [
      {
        id: pinned,
        resourceName: `properties/${pinned}`,
        displayName: `Property ${pinned}`,
      },
    ];
  }

  const properties: Property[] = [];
  const iterable = getAdminClient().listAccountSummariesAsync({ pageSize: 200 });
  for await (const account of iterable) {
    const accountName = account.displayName ?? undefined;
    for (const p of account.propertySummaries ?? []) {
      if (!p.property) continue;
      const id = p.property.replace(/^properties\//, "");
      properties.push({
        id,
        resourceName: p.property,
        displayName: p.displayName ?? `Property ${id}`,
        parent: accountName,
      });
    }
  }
  properties.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return properties;
}
export const listProperties = cached(_listProperties, "ga4-properties", {
  revalidate: 86400,
  tags: [TAGS.ga4Properties],
});

// ── Reports ─────────────────────────────────────────────────────────

export interface DateRangeInput {
  start: string; // "YYYY-MM-DD" or "30daysAgo"
  end: string; // "YYYY-MM-DD" or "today"
}

type RunReportRequest = dataProtos.google.analytics.data.v1beta.IRunReportRequest;
type RunReportResponse = dataProtos.google.analytics.data.v1beta.IRunReportResponse;

export async function runReport(
  propertyId: string,
  request: Omit<RunReportRequest, "property">
): Promise<RunReportResponse> {
  const [resp] = await getDataClient().runReport({
    property: `properties/${propertyId}`,
    ...request,
  });
  return resp;
}

// Pulled out so charts can describe themselves consistently.
export type DailyMetric = {
  date: string; // "YYYYMMDD" from GA4
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
  averageSessionDuration: number;
};

export type SourceBreakdown = {
  channelGroup: string;
  sessions: number;
  activeUsers: number;
};

export type PageBreakdown = {
  pageTitle: string;
  pagePath: string;
  screenPageViews: number;
  activeUsers: number;
};

export interface Ga4DashboardData {
  property: Property;
  dailyMetrics: DailyMetric[];
  totals: {
    activeUsers: number;
    sessions: number;
    screenPageViews: number;
    averageSessionDuration: number;
  };
  topSources: SourceBreakdown[];
  topPages: PageBreakdown[];
}

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function _getDashboard(
  propertyId: string,
  property: Property,
  range: DateRangeInput
): Promise<Ga4DashboardData> {
  const dateRanges = [{ startDate: range.start, endDate: range.end }];

  const [daily, sources, pages] = await Promise.all([
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "averageSessionDuration" },
      ],
      // Without this, the totals[] array comes back empty even though rows
      // contain the data. We need it for the KPI cards.
      metricAggregations: [
        dataProtos.google.analytics.data.v1beta.MetricAggregation.TOTAL,
      ],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 1000,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 25,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "pageTitle" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 250,
    }),
  ]);

  const dailyMetrics: DailyMetric[] =
    daily.rows?.map((r) => ({
      date: r.dimensionValues?.[0]?.value ?? "",
      activeUsers: num(r.metricValues?.[0]?.value),
      sessions: num(r.metricValues?.[1]?.value),
      screenPageViews: num(r.metricValues?.[2]?.value),
      averageSessionDuration: num(r.metricValues?.[3]?.value),
    })) ?? [];

  const totalsRow = daily.totals?.[0]?.metricValues;
  const totals = {
    activeUsers: num(totalsRow?.[0]?.value),
    sessions: num(totalsRow?.[1]?.value),
    screenPageViews: num(totalsRow?.[2]?.value),
    averageSessionDuration: num(totalsRow?.[3]?.value),
  };

  const topSources: SourceBreakdown[] =
    sources.rows?.map((r) => ({
      channelGroup: r.dimensionValues?.[0]?.value ?? "(unknown)",
      sessions: num(r.metricValues?.[0]?.value),
      activeUsers: num(r.metricValues?.[1]?.value),
    })) ?? [];

  const topPages: PageBreakdown[] =
    pages.rows?.map((r) => ({
      pageTitle: r.dimensionValues?.[0]?.value ?? "(no title)",
      pagePath: r.dimensionValues?.[1]?.value ?? "",
      screenPageViews: num(r.metricValues?.[0]?.value),
      activeUsers: num(r.metricValues?.[1]?.value),
    })) ?? [];

  return { property, dailyMetrics, totals, topSources, topPages };
}
export const getDashboard = cached(_getDashboard, "ga4-dashboard", {
  revalidate: 43200,
  tags: [TAGS.ga4Dashboard],
});
