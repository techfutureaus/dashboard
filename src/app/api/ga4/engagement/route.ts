import { NextRequest, NextResponse } from "next/server";
import { listProperties } from "@/lib/ga4";
import { getEngagementReport } from "@/lib/ga4-lms";
import { jsonWithTimestamp } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const start = searchParams.get("start") || "365daysAgo";
    const end = searchParams.get("end") || "today";

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId required" }, { status: 400 });
    }

    const { data: properties } = await listProperties();
    const property = properties.find((p) => p.id === propertyId);
    if (!property) {
      return NextResponse.json({ error: "property not found" }, { status: 404 });
    }

    const { data, fetchedAt } = await getEngagementReport(propertyId, property, { start, end });
    return jsonWithTimestamp(data, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GA4 engagement report fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
