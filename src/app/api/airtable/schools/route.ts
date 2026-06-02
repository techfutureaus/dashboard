import { getSchoolsRecords } from "@/lib/airtable";
import { jsonWithTimestamp } from "@/lib/api-response";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { data: records, fetchedAt } = await getSchoolsRecords();
    return jsonWithTimestamp({ records }, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable schools fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
