import { NextRequest, NextResponse } from "next/server";
import { getTeacherTrainingAgg, type TrainingCohort } from "@/lib/airtable";

export const revalidate = 86400;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const event = searchParams.get("event") || undefined;
    const cohortParam = searchParams.get("cohort");
    const cohort: TrainingCohort =
      cohortParam === "primary" || cohortParam === "secondary" ? cohortParam : "all";
    const data = await getTeacherTrainingAgg({ event, cohort });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Airtable teacher-training fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
