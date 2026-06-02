import { NextRequest, NextResponse } from "next/server";
import { getCareersDaysAgg } from "@/lib/airtable";

export const revalidate = 86400;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const event = searchParams.get("event") || undefined;
    const data = await getCareersDaysAgg({ event });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable careers-days fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
