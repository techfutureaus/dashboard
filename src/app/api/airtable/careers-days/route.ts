import { NextRequest, NextResponse } from "next/server";
import { getCareersDaysAgg } from "@/lib/airtable";
import { jsonWithTimestamp } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const event = searchParams.get("event") || undefined;
    const { data, fetchedAt } = await getCareersDaysAgg({ event });
    return jsonWithTimestamp(data, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable careers-days fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
