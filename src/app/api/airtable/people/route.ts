import { getPeopleRecords } from "@/lib/airtable";
import { jsonWithTimestamp } from "@/lib/api-response";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { data, fetchedAt } = await getPeopleRecords();
    return jsonWithTimestamp(data, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable people fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
