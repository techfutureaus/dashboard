import { NextResponse } from "next/server";
import { listProperties } from "@/lib/ga4";

// Properties rarely change — cache for 24h.
export const revalidate = 86400;

export async function GET() {
  try {
    const properties = await listProperties();
    return NextResponse.json({ properties });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GA4 properties fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
