"use client";

import { UmamiReportPage } from "@/components/UmamiReportPage";
import { useUmamiFunnel } from "@/hooks/useUmamiData";
import { Section, KpiCard, HBarChart, EmptyHint } from "@/components/dashboard-bits";
import type { FunnelReport } from "@/lib/umami";

const STEP_LABELS: Record<string, string> = {
  course_view: "Course view",
  lesson_view: "Lesson view",
  lesson_page_view: "Lesson page view",
  quiz_complete: "Quiz complete",
  lesson_complete: "Lesson complete",
  course_complete: "Course complete",
};

export default function FunnelPage() {
  return (
    <UmamiReportPage
      title="Course funnel & completion"
      subtitleFallback="View → lesson → quiz → completion, and completions by course/lesson."
      useData={useUmamiFunnel}
    >
      {(data, rangeLabel) => <FunnelBody data={data} rangeLabel={rangeLabel} />}
    </UmamiReportPage>
  );
}

function FunnelBody({ data, rangeLabel }: { data: FunnelReport; rangeLabel: string }) {
  const step = (name: string) => data.steps.find((s) => s.name === name)?.count ?? 0;
  const courseViews = step("course_view");
  const courseCompletions = step("course_complete");
  const completionRate =
    courseViews > 0 ? Math.round((courseCompletions / courseViews) * 100) : 0;
  const propId = data.property.id;

  const funnelData = data.steps.map((s) => ({
    name: STEP_LABELS[s.name] ?? s.name,
    count: s.count,
  }));

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Course views" value={courseViews.toLocaleString()} sub={rangeLabel} />
        <KpiCard label="Quiz completions" value={step("quiz_complete").toLocaleString()} sub={rangeLabel} />
        <KpiCard
          label="Lesson completions"
          value={step("lesson_complete").toLocaleString()}
          sub={rangeLabel}
        />
        <KpiCard
          label="Course completion rate"
          value={`${completionRate}%`}
          sub={`${courseCompletions.toLocaleString()} of ${courseViews.toLocaleString()}`}
        />
      </div>

      <Section
        title="Funnel"
        subtitle={`Step counts, course view → completion · ${rangeLabel}`}
        exportData={funnelData}
        exportName={`funnel-steps-${propId}`}
      >
        {funnelData.some((s) => s.count > 0) ? (
          <HBarChart data={funnelData} color="#3b82f6" nameWidth={140} />
        ) : (
          <EmptyHint>No funnel events in this range yet.</EmptyHint>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Section
          title="Completions by course"
          subtitle="course_complete events"
          exportData={data.completionsByCourse}
          exportName={`funnel-course-completions-${propId}`}
        >
          {data.completionsByCourse.length > 0 ? (
            <HBarChart data={data.completionsByCourse} color="#22c55e" nameWidth={200} />
          ) : (
            <EmptyHint>No course completions in this range.</EmptyHint>
          )}
        </Section>

        <Section
          title="Completions by lesson"
          subtitle="lesson_complete events"
          exportData={data.completionsByLesson}
          exportName={`funnel-lesson-completions-${propId}`}
        >
          {data.completionsByLesson.length > 0 ? (
            <HBarChart data={data.completionsByLesson} color="#8b5cf6" nameWidth={200} />
          ) : (
            <EmptyHint>No lesson completions in this range.</EmptyHint>
          )}
        </Section>
      </div>
    </>
  );
}
