import mailchimpRaw from "@mailchimp/mailchimp_marketing";

const apiKey = process.env.MAILCHIMP_API_KEY;
const server =
  process.env.MAILCHIMP_SERVER_PREFIX ||
  (apiKey?.includes("-") ? apiKey.split("-")[1] : undefined);

if (apiKey && server) {
  mailchimpRaw.setConfig({ apiKey, server });
}

// ── Types ─────────────────────────────────────────────────────────────
// Narrowed to fields we actually use. Mailchimp returns much more.

export interface Audience {
  id: string;
  name: string;
  // Some Mailchimp endpoints expose this at top-level, others under stats.
  // The dashboard normalizes; consumers should prefer the helper below.
  member_count?: number;
  stats?: {
    member_count?: number;
    unsubscribe_count?: number;
    cleaned_count?: number;
    open_rate?: number;
    click_rate?: number;
    avg_sub_rate?: number;
    avg_unsub_rate?: number;
    target_sub_rate?: number;
  };
  date_created?: string;
}

export function audienceMemberCount(a: Audience): number {
  return a.stats?.member_count ?? a.member_count ?? 0;
}

export interface GrowthHistoryItem {
  month: string; // "YYYY-MM"
  existing: number;
  imports: number;
  optins: number;
  subscribed?: number;
  unsubscribed?: number;
  cleaned?: number;
  pending?: number;
  deleted?: number;
}

export interface SegmentItem {
  id: number;
  name: string;
  member_count: number;
  type: "saved" | "static" | "fuzzy";
  created_at?: string;
  updated_at?: string;
}

export interface CampaignReport {
  id: string;
  campaign_title: string;
  type?: string;
  send_time: string; // ISO
  emails_sent: number;
  abuse_reports?: number;
  unsubscribed?: number;
  bounces?: { hard_bounces: number; soft_bounces: number; syntax_errors: number };
  opens?: {
    opens_total: number;
    unique_opens: number;
    open_rate: number;
    last_open?: string;
  };
  clicks?: {
    clicks_total: number;
    unique_clicks: number;
    click_rate: number;
    last_click?: string;
  };
}

// ── Extended SDK surface for methods missing from @types ──────────────
// The @types/mailchimp__mailchimp_marketing package is admittedly incomplete
// (the package itself says so). We wrap the runtime client with the surface
// we actually use.

interface ListsApi {
  getAllLists: (opts?: { count?: number; offset?: number }) => Promise<{
    lists: Audience[];
    total_items: number;
  }>;
  getList: (listId: string) => Promise<Audience>;
  getListGrowthHistory: (
    listId: string,
    opts?: { count?: number; offset?: number }
  ) => Promise<{ history: GrowthHistoryItem[]; total_items: number }>;
  listSegments: (
    listId: string,
    opts?: { count?: number; offset?: number; type?: SegmentItem["type"] }
  ) => Promise<{ segments: SegmentItem[]; total_items: number }>;
}

interface ReportsApi {
  getAllCampaignReports: (opts?: {
    count?: number;
    offset?: number;
    type?: string;
    since_send_time?: string;
  }) => Promise<{ reports: CampaignReport[]; total_items: number }>;
}

interface MailchimpClient {
  lists: ListsApi;
  reports: ReportsApi;
}

const mailchimp = mailchimpRaw as unknown as MailchimpClient;

// ── Fetchers ──────────────────────────────────────────────────────────

export { mailchimp };

export async function getAudiences(): Promise<Audience[]> {
  const res = await mailchimp.lists.getAllLists({ count: 1000 });
  return res.lists;
}

export async function getDefaultListId(): Promise<string> {
  const override = process.env.MAILCHIMP_LIST_ID;
  if (override) return override;
  const audiences = await getAudiences();
  if (!audiences.length) {
    throw new Error("No Mailchimp audiences found. Set MAILCHIMP_LIST_ID or create an audience.");
  }
  return audiences[0].id;
}

export async function getAudience(listId: string): Promise<Audience> {
  return await mailchimp.lists.getList(listId);
}

export async function getGrowthHistory(listId: string): Promise<GrowthHistoryItem[]> {
  const res = await mailchimp.lists.getListGrowthHistory(listId, { count: 1000 });
  return res.history;
}

// Generic paginator for Mailchimp endpoints that return { items, total_items }.
// Stops when we've fetched every record, or hits the safety cap (50 pages /
// 50,000 records) to guard against runaway loops.
async function paginateAll<T>(
  fetchPage: (count: number, offset: number) => Promise<{ items: T[]; total: number }>,
  pageSize = 1000
): Promise<T[]> {
  const MAX_PAGES = 50;
  const all: T[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, total } = await fetchPage(pageSize, offset);
    all.push(...items);
    offset += items.length;
    if (items.length === 0 || all.length >= total) break;
  }
  return all;
}

export async function getSegmentsAndTags(listId: string): Promise<SegmentItem[]> {
  return paginateAll<SegmentItem>(async (count, offset) => {
    const res = await mailchimp.lists.listSegments(listId, { count, offset });
    return { items: res.segments, total: res.total_items };
  });
}

export async function getCampaignReports(): Promise<CampaignReport[]> {
  return paginateAll<CampaignReport>(async (count, offset) => {
    const res = await mailchimp.reports.getAllCampaignReports({
      count,
      offset,
      type: "regular",
    });
    return { items: res.reports, total: res.total_items };
  });
}

// ── Audience summary (for the picker) ────────────────────────────────

export interface AudienceSummary {
  id: string;
  name: string;
  member_count: number;
}

export async function listAudiencesSummary(): Promise<AudienceSummary[]> {
  const audiences = await getAudiences();
  return audiences.map((a) => ({
    id: a.id,
    name: a.name,
    member_count: audienceMemberCount(a),
  }));
}

// ── Combined dashboard (sum across all audiences) ────────────────────

export interface DashboardData {
  audience: Audience;
  growth: GrowthHistoryItem[];
  segments: SegmentItem[];
  reports: CampaignReport[];
}

export async function getDashboardForList(listId: string): Promise<DashboardData> {
  const [audience, growth, segments, reports] = await Promise.all([
    getAudience(listId),
    getGrowthHistory(listId),
    getSegmentsAndTags(listId),
    getCampaignReports(),
  ]);
  return { audience, growth, segments, reports };
}

export async function getCombinedDashboardData(): Promise<DashboardData> {
  const audiences = await getAudiences();
  if (audiences.length === 0) {
    throw new Error("No Mailchimp audiences found.");
  }

  // Campaign reports are account-wide → fetch once, not per-audience.
  const [reports, perList] = await Promise.all([
    getCampaignReports(),
    Promise.all(
      audiences.map(async (a) => ({
        audience: await getAudience(a.id),
        growth: await getGrowthHistory(a.id),
        segments: await getSegmentsAndTags(a.id),
      }))
    ),
  ]);

  const totalMembers = perList.reduce((sum, p) => sum + audienceMemberCount(p.audience), 0);
  const totalUnsub = perList.reduce(
    (sum, p) => sum + (p.audience.stats?.unsubscribe_count ?? 0),
    0
  );
  const totalCleaned = perList.reduce(
    (sum, p) => sum + (p.audience.stats?.cleaned_count ?? 0),
    0
  );

  const combinedAudience: Audience = {
    id: "combined",
    name: "All audiences",
    stats: {
      member_count: totalMembers,
      unsubscribe_count: totalUnsub,
      cleaned_count: totalCleaned,
    },
  };

  // Merge growth history: sum per-month counts across audiences.
  const growthByMonth = new Map<string, GrowthHistoryItem>();
  for (const p of perList) {
    for (const g of p.growth) {
      const existing = growthByMonth.get(g.month);
      if (!existing) {
        growthByMonth.set(g.month, { ...g });
      } else {
        existing.existing += g.existing;
        existing.imports += g.imports;
        existing.optins += g.optins;
        existing.subscribed = (existing.subscribed ?? 0) + (g.subscribed ?? 0);
        existing.unsubscribed = (existing.unsubscribed ?? 0) + (g.unsubscribed ?? 0);
        existing.cleaned = (existing.cleaned ?? 0) + (g.cleaned ?? 0);
        existing.pending = (existing.pending ?? 0) + (g.pending ?? 0);
        existing.deleted = (existing.deleted ?? 0) + (g.deleted ?? 0);
      }
    }
  }
  // Sort newest-first to match per-list response shape.
  const combinedGrowth = Array.from(growthByMonth.values()).sort((a, b) =>
    b.month.localeCompare(a.month)
  );

  // Segments: prefix with audience name so duplicates across lists are distinguishable.
  const combinedSegments: SegmentItem[] = perList.flatMap((p) =>
    p.segments.map((s) => ({
      ...s,
      name: `${p.audience.name}: ${s.name}`,
    }))
  );

  return {
    audience: combinedAudience,
    growth: combinedGrowth,
    segments: combinedSegments,
    reports,
  };
}
