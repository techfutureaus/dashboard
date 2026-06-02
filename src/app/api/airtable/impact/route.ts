import { NextResponse } from "next/server";
import { getImpactAgg } from "@/lib/airtable";

export const revalidate = 86400;

export async function GET() {
  try {
    const data = await getImpactAgg();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable impact fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
