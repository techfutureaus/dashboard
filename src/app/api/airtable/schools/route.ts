import { NextResponse } from "next/server";
import { getSchoolsRecords } from "@/lib/airtable";

export const revalidate = 86400;

export async function GET() {
  try {
    const records = await getSchoolsRecords();
    return NextResponse.json({ records });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable schools fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
