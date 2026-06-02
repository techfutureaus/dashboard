import { listProperties } from "@/lib/ga4";
import { jsonWithTimestamp } from "@/lib/api-response";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { data: properties, fetchedAt } = await listProperties();
    return jsonWithTimestamp({ properties }, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GA4 properties fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
