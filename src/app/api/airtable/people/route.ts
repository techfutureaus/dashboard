import { NextResponse } from "next/server";
import { getPeopleRecords } from "@/lib/airtable";

export const revalidate = 86400;

export async function GET() {
  try {
    const records = await getPeopleRecords();
    return NextResponse.json(records);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable people fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
