import { protos as dataProtos } from "@google-analytics/data";
import { runReport, type DateRangeInput, type Property } from "./ga4";
import { cached } from "./api-response";
import { TAGS } from "./cache-tags";

// Reports for the TFA LMS + Lumen (AI editor) custom events. These read GA4
// custom dimensions/metrics (registered as customEvent:<param>) that the site
// and the Lumen iframe push via GTM. See the main app's docs/analytics.md.

const TOTAL = dataProtos.google.analytics.data.v1beta.MetricAggregation.TOTAL;

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// --- filter helpers ---------------------------------------------------------
const eventIn = (values: string[]) => ({
  filter: { fieldName: "eventName", inListFilter: { values } },
});
const eventIs = (value: string) => ({
  filter: { fieldName: "eventName", stringFilter: { value } },
});

const NOT_SET = "(not set)";

// Event groupings (mirror src/lib/analytics.ts in the main app).
const ENGAGEMENT_EVENTS = [
  "course_view", "lesson_view", "lesson_page_view", "teacher_content_view",
  "quiz_complete", "lesson_complete", "course_complete", "certificate_generated",
  "accordion_open", "reveal_open", "tab_switch", "audio_play", "video_start",
  "video_complete", "resource_click", "lesson_feedback_submit",
];
const INTERACTION_EVENTS = [
  "accordion_open", "reveal_open", "tab_switch", "audio_play", "video_start",
  "video_complete", "resource_click",
];
const FUNNEL_STEPS = [
  "course_view", "lesson_view", "lesson_page_view", "quiz_complete",
  "lesson_complete", "course_complete",
];
const AI_EVENTS = ["ai_session_start", "ai_prompt_click", "ai_prompt_response"];

export type NameCount = { name: string; count: number };

// ── Lumen (AI editor) ───────────────────────────────────────────────────────

export interface LumenReport {
  property: Property;
  totals: {
    sessions: number;
    promptClicks: number;
    responses: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    avgTokensPerResponse: number;
  };
  byScenario: {
    scenario: string;
    sessions: number;
    promptClicks: number;
    totalTokens: number;
  }[];
  topPrompts: NameCount[];
  tokensDaily: { date: string; totalTokens: number }[];
}

async function _getLumenReport(
  propertyId: string,
  property: Property,
  range: DateRangeInput
): Promise<LumenReport> {
  const dateRanges = [{ startDate: range.start, endDate: range.end }];

  const [pivot, tokens, prompts] = await Promise.all([
    // Per-scenario × event pivot: eventCount + total_tokens.
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "customEvent:session_type" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "customEvent:total_tokens" }],
      dimensionFilter: eventIn(AI_EVENTS),
      limit: 200,
    }),
    // Tokens over time + totals (responses carry the token params).
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "customEvent:total_tokens" },
        { name: "customEvent:input_tokens" },
        { name: "customEvent:output_tokens" },
      ],
      dimensionFilter: eventIs("ai_prompt_response"),
      metricAggregations: [TOTAL],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 1000,
    }),
    // Most-clicked prompts.
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "customEvent:prompt_label" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: eventIs("ai_prompt_click"),
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 25,
    }),
  ]);

  // Pivot rows → per-scenario map.
  const scenarios = new Map<
    string,
    { sessions: number; promptClicks: number; totalTokens: number }
  >();
  let sessions = 0;
  let promptClicks = 0;
  let responses = 0;
  for (const r of pivot.rows ?? []) {
    const scenario = r.dimensionValues?.[0]?.value || NOT_SET;
    const eventName = r.dimensionValues?.[1]?.value || "";
    const count = num(r.metricValues?.[0]?.value);
    const tok = num(r.metricValues?.[1]?.value);
    const entry =
      scenarios.get(scenario) ??
      { sessions: 0, promptClicks: 0, totalTokens: 0 };
    if (eventName === "ai_session_start") {
      entry.sessions += count;
      sessions += count;
    } else if (eventName === "ai_prompt_click") {
      entry.promptClicks += count;
      promptClicks += count;
    } else if (eventName === "ai_prompt_response") {
      entry.totalTokens += tok;
      responses += count;
    }
    scenarios.set(scenario, entry);
  }

  const tokensTotals = tokens.totals?.[0]?.metricValues;
  const totalTokens = num(tokensTotals?.[0]?.value);
  const inputTokens = num(tokensTotals?.[1]?.value);
  const outputTokens = num(tokensTotals?.[2]?.value);

  return {
    property,
    totals: {
      sessions,
      promptClicks,
      responses,
      totalTokens,
      inputTokens,
      outputTokens,
      avgTokensPerResponse: responses > 0 ? Math.round(totalTokens / responses) : 0,
    },
    byScenario: [...scenarios.entries()]
      .map(([scenario, v]) => ({ scenario, ...v }))
      .sort((a, b) => b.sessions - a.sessions),
    topPrompts:
      prompts.rows?.map((r) => ({
        name: r.dimensionValues?.[0]?.value || NOT_SET,
        count: num(r.metricValues?.[0]?.value),
      })) ?? [],
    tokensDaily:
      tokens.rows?.map((r) => ({
        date: r.dimensionValues?.[0]?.value ?? "",
        totalTokens: num(r.metricValues?.[0]?.value),
      })) ?? [],
  };
}
export const getLumenReport = cached(_getLumenReport, "ga4-lumen", {
  revalidate: 43200,
  tags: [TAGS.ga4Lumen],
});

// ── Engagement ───────────────────────────────────────────────────────────────

export interface EngagementReport {
  property: Property;
  totals: { totalEvents: number };
  byType: NameCount[];
  topLessons: NameCount[];
  topInteractions: NameCount[];
  eventsDaily: { date: string; count: number }[];
}

async function _getEngagementReport(
  propertyId: string,
  property: Property,
  range: DateRangeInput
): Promise<EngagementReport> {
  const dateRanges = [{ startDate: range.start, endDate: range.end }];

  const [byType, lessons, interactions, daily] = await Promise.all([
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "customEvent:engagement_type" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: eventIn(ENGAGEMENT_EVENTS),
      metricAggregations: [TOTAL],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 25,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "customEvent:lesson_slug" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: eventIn(ENGAGEMENT_EVENTS),
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 20,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: eventIn(INTERACTION_EVENTS),
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 25,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: eventIn(ENGAGEMENT_EVENTS),
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 1000,
    }),
  ]);

  const rowsToNameCount = (
    resp: Awaited<ReturnType<typeof runReport>>
  ): NameCount[] =>
    (resp.rows ?? [])
      .map((r) => ({
        name: r.dimensionValues?.[0]?.value || NOT_SET,
        count: num(r.metricValues?.[0]?.value),
      }))
      .filter((r) => r.name !== NOT_SET);

  return {
    property,
    totals: { totalEvents: num(byType.totals?.[0]?.metricValues?.[0]?.value) },
    byType: rowsToNameCount(byType),
    topLessons: rowsToNameCount(lessons).slice(0, 15),
    topInteractions: rowsToNameCount(interactions),
    eventsDaily:
      daily.rows?.map((r) => ({
        date: r.dimensionValues?.[0]?.value ?? "",
        count: num(r.metricValues?.[0]?.value),
      })) ?? [],
  };
}
export const getEngagementReport = cached(_getEngagementReport, "ga4-engagement", {
  revalidate: 43200,
  tags: [TAGS.ga4Engagement],
});

// ── Course funnel & completion ───────────────────────────────────────────────

export interface FunnelReport {
  property: Property;
  steps: NameCount[]; // ordered course_view → … → course_complete
  completionsByCourse: NameCount[];
  completionsByLesson: NameCount[];
}

async function _getFunnelReport(
  propertyId: string,
  property: Property,
  range: DateRangeInput
): Promise<FunnelReport> {
  const dateRanges = [{ startDate: range.start, endDate: range.end }];

  const [steps, byCourse, byLesson] = await Promise.all([
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: eventIn(FUNNEL_STEPS),
      limit: 10,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "customEvent:course_slug" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: eventIs("course_complete"),
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 25,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "customEvent:lesson_slug" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: eventIs("lesson_complete"),
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 20,
    }),
  ]);

  const counts = new Map<string, number>();
  for (const r of steps.rows ?? []) {
    counts.set(
      r.dimensionValues?.[0]?.value || "",
      num(r.metricValues?.[0]?.value)
    );
  }

  const toNameCount = (
    resp: Awaited<ReturnType<typeof runReport>>
  ): NameCount[] =>
    (resp.rows ?? [])
      .map((r) => ({
        name: r.dimensionValues?.[0]?.value || NOT_SET,
        count: num(r.metricValues?.[0]?.value),
      }))
      .filter((r) => r.name !== NOT_SET);

  return {
    property,
    steps: FUNNEL_STEPS.map((step) => ({ name: step, count: counts.get(step) ?? 0 })),
    completionsByCourse: toNameCount(byCourse),
    completionsByLesson: toNameCount(byLesson).slice(0, 15),
  };
}
export const getFunnelReport = cached(_getFunnelReport, "ga4-funnel", {
  revalidate: 43200,
  tags: [TAGS.ga4Funnel],
});
