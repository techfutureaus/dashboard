import { getImpactAgg } from "@/lib/airtable";
import { jsonWithTimestamp } from "@/lib/api-response";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { data, fetchedAt } = await getImpactAgg();
    return jsonWithTimestamp(data, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable impact fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
