import { NextRequest, NextResponse } from "next/server";
import { getFunnelReport } from "@/lib/umami";
import { jsonWithTimestamp } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const { data, fetchedAt } = await getFunnelReport({
      start: searchParams.get("start"),
      end: searchParams.get("end"),
    });
    return jsonWithTimestamp(data, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Umami funnel report fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
